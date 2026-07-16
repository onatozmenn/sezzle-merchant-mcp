import { describe, expect, it } from 'vitest';

import { canonicalJson, sha256Hash } from '../../src/utils/canonical-json.js';

describe('canonical request hashing', () => {
  it('is independent of object key insertion order', () => {
    expect(sha256Hash({ amount: 500, currency: 'USD' })).toBe(
      sha256Hash({ currency: 'USD', amount: 500 }),
    );
  });

  it('preserves integer and bigint distinctions', () => {
    expect(canonicalJson({ amount: 500n })).toContain('$bigint');
    expect(sha256Hash({ amount: 500n })).not.toBe(sha256Hash({ amount: 500 }));
  });
});
