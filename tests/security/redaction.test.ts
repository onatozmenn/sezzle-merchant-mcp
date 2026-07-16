import { describe, expect, it } from 'vitest';

import { SecretValue } from '../../src/config/env.js';
import { redactForLogging } from '../../src/logging/redaction.js';

describe('log redaction', () => {
  it('redacts sensitive keys and configured secret values recursively', () => {
    const secret = new SecretValue('sz_pr_do-not-log');
    const redacted = redactForLogging(
      {
        apiSecret: 'literal',
        nested: {
          note: 'request used sz_pr_do-not-log',
          signature: 'full-signature',
        },
      },
      [secret],
    );

    expect(redacted).toEqual({
      apiSecret: '[REDACTED]',
      nested: {
        note: 'request used [REDACTED]',
        signature: '[REDACTED]',
      },
    });
  });

  it('does not expose customer personal information in nested objects', () => {
    const redacted = redactForLogging({
      orderUuid: 'order-1',
      customer: { email: 'person@example.com' },
    });

    expect(redacted).toEqual({ orderUuid: 'order-1', customer: '[REDACTED]' });
  });
});
