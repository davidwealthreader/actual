import { describe, expect, it } from 'vitest';

import {
  accountBalance,
  normalizeAccount,
  normalizeTransaction,
} from './wealthreader-service';

describe('Wealth Reader normalization', () => {
  it('uses uuid or IBAN code as the account id', () => {
    expect(
      normalizeAccount({ uuid: 'acc-1', code: 'ES00', name: 'Nomina' }, 'bbva')
        ?.account_id,
    ).toBe('acc-1');
    expect(
      normalizeAccount({ code: 'ES00', name: 'Nomina' }, 'bbva')?.account_id,
    ).toBe('ES00');
    expect(normalizeAccount({ name: 'orphan' }, 'bbva')).toBeNull();
  });

  it('prefers available balance', () => {
    expect(accountBalance({ balances: { available: 10.5, current: 1 } })).toBe(
      10.5,
    );
  });

  it('skips transactions without a numeric amount or ISO date', () => {
    expect(
      normalizeTransaction(
        { uuid: 'a', operation_date: '2024-02-01', amount: 'n/a' },
        'EUR',
      ),
    ).toBeNull();
    expect(
      normalizeTransaction({ uuid: 'b', amount: 12 }, 'EUR'),
    ).toBeNull();
    const ok = normalizeTransaction(
      {
        uuid: 'c',
        operation_date: '2024-02-01',
        amount: -27.45,
        description: 'Grocer',
        transfer_details: { concept: 'Card' },
      },
      'EUR',
    );
    expect(ok).toMatchObject({
      transactionId: 'c',
      date: '2024-02-01',
      payeeName: 'Grocer',
      notes: 'Card',
      transactionAmount: { amount: '-27.45', currency: 'EUR' },
    });
  });
});
