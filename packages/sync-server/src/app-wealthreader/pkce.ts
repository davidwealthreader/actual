/**
 * Wealth Reader PKCE is not RFC 7636.
 * nonce / state / code_verifier = hex(randomAlnum(41)).
 * challenge_code = SHA-256 hex of the already-hex verifier.
 * wr_conf is JSON encoded as hex.
 * @see https://www.wealthreader.com/docs/en/oauth-backend/
 */

import { createHash, randomBytes, randomInt } from 'node:crypto';

const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const ALNUM_LENGTH = 41;

export function randomAlnum(length = ALNUM_LENGTH): string {
  let value = '';
  for (let i = 0; i < length; i++) {
    value += ALPHABET[randomInt(0, ALPHABET.length)];
  }
  return value;
}

export function hexAlnum(length = ALNUM_LENGTH): string {
  return Buffer.from(randomAlnum(length), 'ascii').toString('hex');
}

export type WealthReaderPkce = {
  nonce: string;
  wrState: string;
  codeVerifier: string;
  challenge: string;
  wrConf: string;
};

export function generatePkce(entityCode: string): WealthReaderPkce {
  const nonce = hexAlnum();
  const wrState = hexAlnum();
  const codeVerifier = hexAlnum();
  const challenge = createHash('sha256').update(codeVerifier).digest('hex');
  const wrConf = Buffer.from(
    JSON.stringify({
      operation_id: 'op_' + randomBytes(8).toString('hex'),
      entities_to_display: entityCode ? [entityCode] : [],
      wait_full_response: true,
    }),
    'utf8',
  ).toString('hex');

  return { nonce, wrState, codeVerifier, challenge, wrConf };
}
