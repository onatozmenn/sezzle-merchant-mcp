import { describe, expect, it } from 'vitest';

import {
  normalizeSezzleApiError,
  normalizeUnknownError,
  SezzleOpsError,
} from '../../src/api/errors.js';

describe('error normalization', () => {
  it('normalizes Sezzle array errors without exposing unknown payload fields', () => {
    const error = normalizeSezzleApiError(
      422,
      [
        {
          code: 'already_completed',
          message: 'Already completed',
          debug_uuid: 'debug-1',
          private_key: 'must-not-leak',
        },
      ],
      'request-1',
    );

    expect(error.toNormalized()).toEqual({
      code: 'DUPLICATE_OPERATION',
      message: 'Already completed',
      retryable: false,
      httpStatus: 422,
      requestId: 'request-1',
      details: { sezzleCode: 'already_completed', debugUuid: 'debug-1' },
    });
  });

  it('marks rate limits and upstream failures retryable', () => {
    expect(normalizeSezzleApiError(429, {}, 'request-2').retryable).toBe(true);
    expect(normalizeSezzleApiError(503, {}, 'request-3').retryable).toBe(true);
  });

  it('does not expose internal errors or stack traces', () => {
    const normalized = normalizeUnknownError(new Error('secret internal details'), 'request-4');

    expect(normalized.code).toBe('INTERNAL_ERROR');
    expect(normalized.message).toBe('An internal error occurred.');
    expect(JSON.stringify(normalized)).not.toContain('secret internal details');
    expect(JSON.stringify(normalized)).not.toContain('stack');
  });

  it('preserves safe domain errors', () => {
    const source = new SezzleOpsError({
      code: 'REFUND_EXCEEDS_AVAILABLE_AMOUNT',
      message: 'Refund exceeds the available amount.',
      retryable: false,
      httpStatus: 400,
      details: { availableAmountInCents: 500 },
    });

    expect(normalizeUnknownError(source, 'request-5').code).toBe('REFUND_EXCEEDS_AVAILABLE_AMOUNT');
  });
});
