import { describe, expect, it } from 'vitest';

import {
  addMoney,
  compareMoney,
  moneyFromInput,
  moneyToJson,
  subtractMoney,
  sumMoney,
} from '../../src/domain/money.js';

describe('integer money arithmetic', () => {
  it('adds and subtracts only integer minor units', () => {
    const first = moneyFromInput({ amount_in_cents: 10_001, currency: 'USD' });
    const second = moneyFromInput({ amount_in_cents: 999, currency: 'USD' });

    expect(addMoney(first, second).minorUnits).toBe(11_000n);
    expect(subtractMoney(first, second).minorUnits).toBe(9_002n);
    expect(moneyToJson(addMoney(first, second))).toEqual({
      amount_in_cents: 11_000,
      currency: 'USD',
    });
  });

  it('rejects floating-point, zero, negative, and unsupported currency inputs', () => {
    expect(() => moneyFromInput({ amount_in_cents: 1.5, currency: 'USD' })).toThrow();
    expect(() => moneyFromInput({ amount_in_cents: 0, currency: 'USD' })).toThrow(
      'greater than zero',
    );
    expect(() => moneyFromInput({ amount_in_cents: -1, currency: 'USD' })).toThrow();
    expect(() => moneyFromInput({ amount_in_cents: 100, currency: 'EUR' as 'USD' })).toThrow();
  });

  it('rejects arithmetic across currencies', () => {
    const usd = moneyFromInput({ amount_in_cents: 100, currency: 'USD' });
    const cad = moneyFromInput({ amount_in_cents: 100, currency: 'CAD' });

    expect(() => addMoney(usd, cad)).toThrow('Currency mismatch');
    expect(() => compareMoney(usd, cad)).toThrow('Currency mismatch');
  });

  it('sums values deterministically with bigint', () => {
    const values = [
      moneyFromInput({ amount_in_cents: 101, currency: 'CAD' }),
      moneyFromInput({ amount_in_cents: 202, currency: 'CAD' }),
    ];

    expect(sumMoney(values, 'CAD')).toEqual({ minorUnits: 303n, currency: 'CAD' });
  });
});
