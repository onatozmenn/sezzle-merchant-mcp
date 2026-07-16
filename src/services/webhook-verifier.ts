import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { SezzleOpsError } from '../api/errors.js';
import type { SecretValue } from '../config/env.js';

export interface WebhookVerification {
  readonly signatureVerified: boolean;
  readonly payloadHash: string;
}

const signatureBytes = (signature: string): Buffer | undefined => {
  const normalized = signature
    .trim()
    .replace(/^sha256=/i, '')
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) return undefined;
  return Buffer.from(normalized, 'hex');
};

export class WebhookVerifier {
  // Sezzle documents HMAC-SHA256 with merchant private signing material but
  // does not define a separate secret field. Keep the configured value behind
  // this adapter until real sandbox delivery confirms key and header formatting.
  public constructor(private readonly secret: SecretValue | undefined) {}

  public verify(rawBody: string, signature: string): WebhookVerification {
    if (this.secret === undefined) {
      throw new SezzleOpsError({
        code: 'WEBHOOK_SECRET_NOT_CONFIGURED',
        message: 'SEZZLE_WEBHOOK_SECRET must be configured for webhook verification.',
        retryable: false,
        httpStatus: 503,
        details: {},
      });
    }
    const body = Buffer.from(rawBody, 'utf8');
    const expected = createHmac('sha256', this.secret.reveal()).update(body).digest();
    const received = signatureBytes(signature);
    let signatureVerified = false;
    if (received?.length === expected.length) {
      signatureVerified = timingSafeEqual(expected, received);
    }
    return {
      signatureVerified,
      payloadHash: createHash('sha256').update(body).digest('hex'),
    };
  }
}
