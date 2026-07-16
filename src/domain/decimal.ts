import { SezzleOpsError } from '../api/errors.js';

const decimalPattern = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

export const parseDecimalToScaledUnits = (value: string, scale: number): bigint => {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new TypeError('Decimal scale must be an integer from 0 through 18.');
  }
  const normalized = value.trim().replace(/^([+-]?)\./, '$10.');
  const match = decimalPattern.exec(normalized);
  if (match === null) {
    throw new SezzleOpsError({
      code: 'INVALID_DECIMAL_AMOUNT',
      message: 'Amount is not a valid decimal value.',
      retryable: false,
      httpStatus: 400,
      details: {},
    });
  }
  const sign = match[1] === '-' ? -1n : 1n;
  const integer = match[2] ?? '0';
  const fraction = match[3] ?? '';
  const exponentText = match[4] ?? '0';
  const exponent = Number.parseInt(exponentText, 10);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 10_000) {
    throw new SezzleOpsError({
      code: 'DECIMAL_OUT_OF_RANGE',
      message: 'Decimal exponent is outside the supported range.',
      retryable: false,
      httpStatus: 400,
      details: {},
    });
  }

  let digits = `${integer}${fraction}`.replace(/^0+(?=\d)/, '');
  const shift = exponent - fraction.length + scale;
  if (shift >= 0) {
    digits += '0'.repeat(shift);
  } else {
    const remove = -shift;
    if (remove > digits.length) {
      if (/^0+$/.test(digits)) return 0n;
      throw new SezzleOpsError({
        code: 'DECIMAL_PRECISION_EXCEEDED',
        message: `Amount has precision smaller than the supported scale of ${String(scale)}.`,
        retryable: false,
        httpStatus: 400,
        details: {},
      });
    }
    const removed = digits.slice(digits.length - remove);
    if (!/^0*$/.test(removed)) {
      throw new SezzleOpsError({
        code: 'DECIMAL_PRECISION_EXCEEDED',
        message: `Amount has more than ${String(scale)} decimal places.`,
        retryable: false,
        httpStatus: 400,
        details: {},
      });
    }
    digits = digits.slice(0, digits.length - remove) || '0';
  }
  return sign * BigInt(digits);
};

export const formatScaledUnits = (units: bigint, scale: number): string => {
  if (!Number.isInteger(scale) || scale < 0 || scale > 18) {
    throw new TypeError('Decimal scale must be an integer from 0 through 18.');
  }
  const sign = units < 0n ? '-' : '';
  const absolute = (units < 0n ? -units : units).toString().padStart(scale + 1, '0');
  if (scale === 0) return `${sign}${absolute}`;
  const split = absolute.length - scale;
  return `${sign}${absolute.slice(0, split)}.${absolute.slice(split)}`;
};

export const scaledUnitsToSafeNumber = (units: bigint): number => {
  if (units > BigInt(Number.MAX_SAFE_INTEGER) || units < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new SezzleOpsError({
      code: 'AMOUNT_OUT_OF_RANGE',
      message: 'Amount exceeds the supported JSON safe-integer range.',
      retryable: false,
      httpStatus: 400,
      details: {},
    });
  }
  return Number(units);
};
