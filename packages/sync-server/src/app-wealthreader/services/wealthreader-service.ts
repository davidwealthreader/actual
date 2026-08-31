import createDebug from 'debug';

import { SecretName, secretsService } from '#services/secrets-service';

import { generatePkce, type WealthReaderPkce } from '../pkce';

const debug = createDebug('actual:wealthreader:service');

export const AUTH_ERROR_CODES = new Set([1010, 1020, 2010, 2020]);
const API_BASE = 'https://api.wealthreader.com';
const OAUTH_BASE = 'https://oauth.wealthreader.com';

export type WealthReaderEntity = {
  code: string;
  name: string;
  country: string;
  logo?: string | null;
};

export type WealthReaderAccount = {
  uuid?: string;
  code?: string;
  name?: string;
  subtype?: string;
  currency?: string;
  balances?: { available?: number; current?: number };
  transactions?: WealthReaderTransaction[];
};

export type WealthReaderTransaction = {
  uuid?: string;
  operation_date?: string;
  value_date?: string;
  amount?: number | string;
  description?: string;
  currency?: string;
  transfer_details?: { concept?: string; sender_receiver?: string };
};

export type BankSyncTransaction = {
  transactionId: string;
  date: string;
  bookingDate: string;
  valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  payeeName: string;
  notes?: string;
  booked: boolean;
};

export type BankSyncBalance = {
  balanceAmount: { amount: number; currency: string };
  balanceType: string;
};

export type NormalizedAccount = {
  account_id: string;
  name: string;
  institution: string;
  currency?: string;
  iban?: string;
};

export type PendingPkce = WealthReaderPkce & {
  redirectUri: string;
  entityCode: string;
};

const pendingPkce = new Map<string, PendingPkce>();

export function isConfigured(): boolean {
  return Boolean(secretsService.get(SecretName.wealthreader_api_key));
}

export function storePkce(keys: string[], payload: PendingPkce): void {
  for (const key of keys) {
    if (key) pendingPkce.set(key, payload);
  }
}

export function loadPkce(...keys: Array<string | undefined>): PendingPkce | null {
  for (const key of keys) {
    if (!key) continue;
    const payload = pendingPkce.get(key);
    if (payload) return payload;
  }
  return null;
}

export class WealthReaderError extends Error {
  constructor(
    public error_code: string,
    message: string,
  ) {
    super(message);
    this.name = 'WealthReaderError';
  }
}

function getApiKey(): string {
  const apiKey = secretsService.get(SecretName.wealthreader_api_key);
  if (!apiKey) {
    throw new WealthReaderError('NOT_CONFIGURED', 'Wealth Reader is not configured');
  }
  return apiKey;
}

async function interpret(res: Response, path: string): Promise<Record<string, unknown>> {
  if (res.status === 429) {
    throw new WealthReaderError('RATE_LIMITED', `Wealth Reader ${path} → 429`);
  }
  if (res.status === 401 || res.status === 410) {
    throw new WealthReaderError('INVALID_ACCESS_TOKEN', `Wealth Reader ${path} → ${res.status}`);
  }
  if (!res.ok) {
    const text = await res.text();
    throw new WealthReaderError('INTERNAL_ERROR', `Wealth Reader ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  if (data.success === false) {
    const error = (data.error || {}) as { code?: number; message?: string };
    const code = Number(error.code || 0);
    const message = error.message || 'success=false';
    if (AUTH_ERROR_CODES.has(code)) {
      throw new WealthReaderError('INVALID_ACCESS_TOKEN', `Wealth Reader error ${code}: ${message}`);
    }
    throw new WealthReaderError('INTERNAL_ERROR', `Wealth Reader error ${code}: ${message}`);
  }
  return data;
}

export async function listEntities(country?: string): Promise<WealthReaderEntity[]> {
  const url = new URL(`${API_BASE}/entities/`);
  if (country) url.searchParams.set('country_code', country.toUpperCase());
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await interpret(res, 'GET /entities/');
  const raw = (data.payload || data.entities || []) as Array<Record<string, unknown>>;
  return raw
    .filter(item => typeof item.code === 'string' && item.code)
    .map(item => ({
      code: String(item.code),
      name: String(item.name || item.code),
      country: String(item.country_code || item.country || '').toUpperCase(),
      logo: typeof item.logo === 'string' ? item.logo : null,
    }));
}

export function buildAuthorizeUrl(
  redirectUri: string,
  state: string,
  entityCode: string,
): { url: string; nonce: string } {
  const challenge = generatePkce(entityCode);
  storePkce([state, challenge.nonce], {
    ...challenge,
    redirectUri,
    entityCode,
  });
  const query = new URLSearchParams({
    challenge_code: challenge.challenge,
    code_challenge_method: 'S256',
    redirect_uri: redirectUri,
    response_type: 'code',
    state,
    nonce: challenge.nonce,
    wr_conf: challenge.wrConf,
  });
  return { url: `${OAUTH_BASE}/oauth2/?${query}`, nonce: challenge.nonce };
}

export async function exchangeCode(
  code: string,
  state?: string,
  nonce?: string,
): Promise<Record<string, unknown>> {
  const challenge = loadPkce(state, nonce);
  if (!challenge) {
    throw new WealthReaderError(
      'INVALID_INPUT',
      'Wealth Reader PKCE challenge missing or expired. Restart the bank link.',
    );
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    redirect_uri: challenge.redirectUri,
    code,
    code_verifier: challenge.codeVerifier,
  });
  const res = await fetch(`${OAUTH_BASE}/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
  });
  return interpret(res, 'POST /token/');
}

export async function refresh(
  token: string,
  entityCode: string,
  dateFrom?: string,
): Promise<Record<string, unknown>> {
  const form = new URLSearchParams({
    api_key: getApiKey(),
    code: entityCode,
    token,
    product_types: 'accounts',
  });
  if (dateFrom) form.set('date_from', dateFrom);
  const res = await fetch(`${API_BASE}/entities/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form,
  });
  return interpret(res, 'POST /entities/');
}

export function normalizeAccount(
  raw: WealthReaderAccount,
  institution: string,
): NormalizedAccount | null {
  const account_id = raw.uuid || raw.code || '';
  if (!account_id) return null;
  return {
    account_id,
    name: raw.name || 'Account',
    institution,
    currency: raw.currency || 'EUR',
    iban: raw.code,
  };
}

export function accountBalance(raw: WealthReaderAccount): number {
  const balances = raw.balances || {};
  const value = balances.available ?? balances.current;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeTransaction(
  raw: WealthReaderTransaction,
  fallbackCurrency: string,
): BankSyncTransaction | null {
  if (raw.amount === undefined || raw.amount === null || raw.amount === '') {
    return null;
  }
  const parsed = Number(raw.amount);
  if (!Number.isFinite(parsed)) return null;
  const date = (raw.operation_date || raw.value_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const concept = raw.transfer_details?.concept?.trim();
  return {
    transactionId: raw.uuid || `${date}:${parsed}`,
    date,
    bookingDate: date,
    valueDate: raw.value_date?.slice(0, 10),
    transactionAmount: {
      amount: String(parsed),
      currency: raw.currency || fallbackCurrency,
    },
    payeeName: (raw.description || raw.transfer_details?.sender_receiver || '').trim(),
    notes: concept,
    booked: true,
  };
}

export function payloadAccounts(data: Record<string, unknown>): WealthReaderAccount[] {
  const payload = (data.payload || {}) as { accounts?: WealthReaderAccount[] };
  return Array.isArray(payload.accounts) ? payload.accounts : [];
}

export function payloadToken(data: Record<string, unknown>): { token: string; code: string } {
  const stats = (data.statistics || {}) as { token?: string; code?: string };
  if (!stats.token) {
    throw new WealthReaderError(
      'INVALID_INPUT',
      'Wealth Reader token exchange returned no statistics.token — register the redirect with tokenize=1',
    );
  }
  return { token: stats.token, code: stats.code || '' };
}

debug('Wealth Reader service loaded');
