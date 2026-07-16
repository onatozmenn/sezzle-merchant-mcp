import { z } from 'zod';

import { SezzleOpsError } from '../api/errors.js';

export const currencySchema = z.enum(['USD', 'CAD']);
export type Currency = z.infer<typeof currencySchema>;

export const moneyInputSchema = z
  .object({
    amount_in_cents: z.number().int(),
    currency: currencySchema,
  })
  .strict();

export type MoneyInput = z.infer<typeof moneyInputSchema>;

export interface Money {
  readonly minorUnits: bigint;
  readonly currency: Currency;
}

export interface MoneyJson {
  readonly amount_in_cents: number;
  readonly currency: Currency;
}

export const moneyFromInput = (input: MoneyInput, allowZero = false): Money => {
  const parsed = moneyInputSchema.parse(input);
  const minorUnits = BigInt(parsed.amount_in_cents);
  if (minorUnits < 0n || (!allowZero && minorUnits === 0n)) {
    throw new SezzleOpsError({
      code: 'INVALID_MONEY_AMOUNT',
      message: allowZero
        ? 'Money amount must not be negative.'
        : 'Money amount must be greater than zero.',
      retryable: false,
      httpStatus: 400,
      details: { field: 'amount_in_cents' },
    });
  }
  return { minorUnits, currency: parsed.currency };
};

const assertSameCurrency = (left: Money, right: Money): void => {
  if (left.currency !== right.currency) {
    throw new SezzleOpsError({
      code: 'CURRENCY_MISMATCH',
      message: `Currency mismatch: expected ${left.currency}, received ${right.currency}.`,
      retryable: false,
      httpStatus: 400,
      details: { expectedCurrency: left.currency, receivedCurrency: right.currency },
    });
  }
};

export const addMoney = (left: Money, right: Money): Money => {
  assertSameCurrency(left, right);
  return { minorUnits: left.minorUnits + right.minorUnits, currency: left.currency };
};

export const subtractMoney = (left: Money, right: Money): Money => {
  assertSameCurrency(left, right);
  const minorUnits = left.minorUnits - right.minorUnits;
  if (minorUnits < 0n) {
    throw new SezzleOpsError({
      code: 'MONEY_UNDERFLOW',
      message: 'Money subtraction would produce a negative amount.',
      retryable: false,
      httpStatus: 400,
      details: {},
    });
  }
  return { minorUnits, currency: left.currency };
};

export const compareMoney = (left: Money, right: Money): -1 | 0 | 1 => {
  assertSameCurrency(left, right);
  if (left.minorUnits < right.minorUnits) return -1;
  if (left.minorUnits > right.minorUnits) return 1;
  return 0;
};

export const sumMoney = (values: readonly Money[], currency: Currency): Money => {
  let total = 0n;
  for (const value of values) {
    if (value.currency !== currency) {
      assertSameCurrency({ minorUnits: total, currency }, value);
    }
    total += value.minorUnits;
  }
  return { minorUnits: total, currency };
};

export const moneyToJson = (money: Money): MoneyJson => {
  if (money.minorUnits > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new SezzleOpsError({
      code: 'MONEY_OUT_OF_RANGE',
      message: 'Money amount exceeds the supported JSON safe-integer range.',
      retryable: false,
      httpStatus: 400,
      details: {},
    });
  }
  return { amount_in_cents: Number(money.minorUnits), currency: money.currency };
};
