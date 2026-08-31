import createDebug from 'debug';
import type { Request, Response } from 'express';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { handleError } from '#app-gocardless/util/handle-error';
import { SecretName, secretsService } from '#services/secrets-service';
import {
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from '#util/middlewares';

import {
  accountBalance,
  buildAuthorizeUrl,
  exchangeCode,
  isConfigured,
  listEntities,
  normalizeAccount,
  normalizeTransaction,
  payloadAccounts,
  payloadToken,
  refresh,
  WealthReaderError,
} from './services/wealthreader-service';

const debug = createDebug('actual:wealthreader:app');

const app = express();
export { app as handlers };
app.use(requestLoggerMiddleware);
app.use(express.json());

type PendingAuth = {
  id: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingAuths = new Map<string, PendingAuth>();
const completedAuths = new Map<string, unknown>();
let nextWaiterId = 0;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
const COMPLETED_AUTH_TTL_MS = 30 * 1000;

function cleanupPendingAuth(state: string, waiterId?: string) {
  const entry = pendingAuths.get(state);
  if (entry && (waiterId == null || entry.id === waiterId)) {
    clearTimeout(entry.timer);
    pendingAuths.delete(state);
  }
}

function cacheAuthResult(keys: Array<string | undefined>, result: unknown) {
  for (const key of keys) {
    if (!key) continue;
    completedAuths.set(key, result);
    setTimeout(() => completedAuths.delete(key), COMPLETED_AUTH_TTL_MS);
    const pending = pendingAuths.get(key);
    if (pending) {
      if (result && typeof result === 'object' && 'error' in (result as object)) {
        pending.reject(new Error(String((result as { error: string }).error)));
      } else {
        pending.resolve(result);
      }
      cleanupPendingAuth(key);
    }
  }
}

// Bank redirect — no session cookie. Callback docs: ?nonce=&code= (state optional).
app.get('/auth_callback', async (req: Request, res: Response) => {
  const code = typeof req.query.code === 'string' ? req.query.code : undefined;
  const state = typeof req.query.state === 'string' ? req.query.state : undefined;
  const nonce = typeof req.query.nonce === 'string' ? req.query.nonce : undefined;

  if (!code) {
    res.status(400).send('<html><body><p>Authorization failed: missing code.</p></body></html>');
    return;
  }
  if (!state && !nonce) {
    res.status(400).send('<html><body><p>Authorization failed: missing state and nonce.</p></body></html>');
    return;
  }

  try {
    const data = await exchangeCode(code, state, nonce);
    const { token, code: entityCode } = payloadToken(data);
    const accounts = payloadAccounts(data)
      .map(raw => {
        const normalized = normalizeAccount(raw, entityCode);
        if (!normalized) return null;
        return { ...normalized, balance: accountBalance(raw) };
      })
      .filter(Boolean);

    const result = { token, institution: entityCode, accounts };
    cacheAuthResult([state, nonce], result);
    res.send(
      '<html><body><p>Authorization successful. This window will close.</p>' +
        '<script>setTimeout(function(){window.close()},1000)</script></body></html>',
    );
  } catch (error) {
    const errorResult = { error: error instanceof Error ? error.message : 'unknown error' };
    cacheAuthResult([state, nonce], errorResult);
    debug('Callback auth error: %s', error);
    res.status(500).send(
      '<html><body><p>Authorization failed. You can close this window and try again.</p></body></html>',
    );
  }
});

app.use(validateSessionMiddleware);

app.post(
  '/status',
  handleError(async (_req: Request, res: Response) => {
    res.send({ status: 'ok', data: { configured: isConfigured() } });
  }),
);

app.post(
  '/configure',
  handleError(async (req: Request, res: Response) => {
    const { apiKey } = req.body || {};
    if (!apiKey) {
      res.send({
        status: 'ok',
        data: { error_code: 'INVALID_INPUT', error_type: 'Missing apiKey' },
      });
      return;
    }
    secretsService.set(SecretName.wealthreader_api_key, apiKey);
    res.send({ status: 'ok', data: { configured: true } });
  }),
);

app.post(
  '/entities',
  handleError(async (req: Request, res: Response) => {
    try {
      const entities = await listEntities(req.body?.country);
      res.send({ status: 'ok', data: entities });
    } catch (error) {
      res.send({
        status: 'ok',
        data: { error: error instanceof Error ? error.message : 'unknown error' },
      });
    }
  }),
);

app.post(
  '/start-auth',
  handleError(async (req: Request, res: Response) => {
    const { entityCode, redirectUrl } = req.body || {};
    if (!entityCode || !redirectUrl) {
      res.send({
        status: 'ok',
        data: { error_code: 'INVALID_INPUT', error_type: 'Missing entityCode or redirectUrl' },
      });
      return;
    }
    const state = uuidv4();
    const { url, nonce } = buildAuthorizeUrl(redirectUrl, state, entityCode);
    res.send({ status: 'ok', data: { url, state, nonce } });
  }),
);

app.post(
  '/poll-auth',
  handleError(async (req: Request, res: Response) => {
    const { state } = req.body || {};
    if (!state) {
      res.send({
        status: 'ok',
        data: { error_code: 'INVALID_INPUT', error_type: 'Missing state' },
      });
      return;
    }
    if (completedAuths.has(state)) {
      const result = completedAuths.get(state);
      completedAuths.delete(state);
      res.send({ status: 'ok', data: result });
      return;
    }
    const waiterId = String(++nextWaiterId);
    try {
      const result = await new Promise((resolve, reject) => {
        const existing = pendingAuths.get(state);
        if (existing) {
          clearTimeout(existing.timer);
          existing.reject(new Error('Poll superseded'));
        }
        const timer = setTimeout(() => {
          cleanupPendingAuth(state, waiterId);
          reject(new Error('Polling timed out'));
        }, POLL_TIMEOUT_MS);
        pendingAuths.set(state, { id: waiterId, resolve, reject, timer });
      });
      res.send({ status: 'ok', data: result });
    } catch (error) {
      cleanupPendingAuth(state, waiterId);
      res.send({
        status: 'ok',
        data: { error: error instanceof Error ? error.message : 'unknown error' },
      });
    }
  }),
);

app.post(
  '/transactions',
  handleError(async (req: Request, res: Response) => {
    const { accountId, startDate, token, entityCode } = req.body || {};
    if (!accountId || !startDate || !token || !entityCode) {
      res.send({
        status: 'ok',
        data: { error_code: 'INVALID_INPUT', error_type: 'Missing accountId, startDate, token or entityCode' },
      });
      return;
    }
    try {
      const dateFrom =
        typeof startDate === 'string' ? startDate : new Date(startDate).toISOString().split('T')[0];
      const data = await refresh(token, entityCode, dateFrom);
      const accounts = payloadAccounts(data);
      const account = accounts.find(
        raw => raw.uuid === accountId || raw.code === accountId,
      );
      if (!account) {
        res.send({
          status: 'ok',
          data: { error_type: 'INVALID_INPUT', error_code: 'NOT_FOUND' },
        });
        return;
      }
      const currency = account.currency || 'EUR';
      const all = (account.transactions || [])
        .map(tx => normalizeTransaction(tx, currency))
        .filter((tx): tx is NonNullable<typeof tx> => tx !== null);
      const startingBalance = Math.round(accountBalance(account) * 100);
      res.send({
        status: 'ok',
        data: {
          transactions: { all, booked: all, pending: [] },
          balances: [
            {
              balanceAmount: { amount: startingBalance, currency },
              balanceType: 'CLAV',
            },
          ],
          startingBalance,
        },
      });
    } catch (error) {
      debug('Error fetching transactions: %s', error);
      if (error instanceof WealthReaderError && error.error_code === 'INVALID_ACCESS_TOKEN') {
        res.send({
          status: 'ok',
          data: { error_type: 'ITEM_ERROR', error_code: 'ITEM_LOGIN_REQUIRED' },
        });
        return;
      }
      res.send({
        status: 'ok',
        data: { error_type: 'INTERNAL_ERROR', error_code: 'INTERNAL_ERROR' },
      });
    }
  }),
);
