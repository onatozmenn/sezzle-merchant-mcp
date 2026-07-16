import { describe, expect, it } from 'vitest';

import { formatScaledUnits, parseDecimalToScaledUnits } from '../../src/domain/decimal.js';

describe('exact decimal scaling', () => {
  it('converts decimal and exponent forms without floating-point arithmetic', () => {
    expect(parseDecimalToScaledUnits('703.20', 2)).toBe(70_320n);
    expect(parseDecimalToScaledUnits('.30', 2)).toBe(30n);
    expect(parseDecimalToScaledUnits('1.2e2', 2)).toBe(12_000n);
    expect(parseDecimalToScaledUnits('-4.3000', 4)).toBe(-43_000n);
  });

  it('rejects precision that cannot be represented exactly', () => {
    expect(() => parseDecimalToScaledUnits('1.001', 2)).toThrow('more than 2 decimal places');
  });

  it('formats scaled integers deterministically', () => {
    expect(formatScaledUnits(51_834_624n, 4)).toBe('5183.4624');
    expect(formatScaledUnits(-430n, 2)).toBe('-4.30');
  });
});
