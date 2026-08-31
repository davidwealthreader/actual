import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { generatePkce, hexAlnum } from './pkce';

describe('Wealth Reader PKCE', () => {
  it('matches the documented non-RFC7636 contract', () => {
    const challenge = generatePkce('bbva');
    expect(challenge.nonce).toHaveLength(82);
    expect(challenge.codeVerifier).toHaveLength(82);
    expect(challenge.nonce).toMatch(/^[0-9a-f]{82}$/);
    expect(challenge.challenge).toBe(
      createHash('sha256').update(challenge.codeVerifier).digest('hex'),
    );
    const raw = Buffer.from(challenge.wrConf, 'hex').toString('utf8');
    expect(raw).toContain('"bbva"');
    expect(raw).toContain('wait_full_response');
  });

  it('hexAlnum is 82 hex chars', () => {
    expect(hexAlnum()).toMatch(/^[0-9a-f]{82}$/);
  });
});
