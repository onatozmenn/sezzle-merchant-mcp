import { describe, expect, it } from 'vitest';

import type { OrderSnapshot } from '../../src/api/schemas/phase1.js';
import {
  calculateOrderFinancialState,
  previewCapture,
  previewReauthorization,
  previewRefund,
  previewRelease,
} from '../../src/domain/order.js';

const order: OrderSnapshot = {
  uuid: 'order-1',
  intent: 'AUTH',
  authorization: {
    authorization_amount: { amount_in_cents: 10_000, currency: 'USD' },
    approved: true,
    expiration: '2026-07-17T00:00:00Z',
    captures: [{ uuid: 'capture-1', amount: { amount_in_cents: 6_000, currency: 'USD' } }],
    refunds: [{ uuid: 'refund-1', amount: { amount_in_cents: 1_500, currency: 'USD' } }],
    releases: [{ uuid: 'release-1', amount: { amount_in_cents: 1_000, currency: 'USD' } }],
  },
};

describe('order financial state', () => {
  it('computes remaining capture and refund amounts deterministically', () => {
    expect(calculateOrderFinancialState(order)).toEqual({
      authorized: { amount_in_cents: 10_000, currency: 'USD' },
      captured: { amount_in_cents: 6_000, currency: 'USD' },
      refunded: { amount_in_cents: 1_500, currency: 'USD' },
      released: { amount_in_cents: 1_000, currency: 'USD' },
      remainingCapturable: { amount_in_cents: 3_000, currency: 'USD' },
      remainingRefundable: { amount_in_cents: 4_500, currency: 'USD' },
    });
  });

  it('rejects a capture above the remaining authorization', () => {
    const preview = previewCapture(
      order,
      { amount_in_cents: 3_001, currency: 'USD' },
      new Date('2026-07-16T12:00:00Z'),
    );

    expect(preview.validation).toMatchObject({
      valid: false,
      code: 'CAPTURE_EXCEEDS_AUTHORIZED_AMOUNT',
    });
  });

  it('rejects a refund above the remaining refundable amount', () => {
    const preview = previewRefund(order, { amount_in_cents: 4_501, currency: 'USD' });

    expect(preview.validation).toMatchObject({
      valid: false,
      code: 'REFUND_EXCEEDS_AVAILABLE_AMOUNT',
    });
  });

  it('calculates release impact against uncaptured and unreleased authorization', () => {
    const preview = previewRelease(order, { amount_in_cents: 500, currency: 'USD' });

    expect(preview.validation.valid).toBe(true);
    expect(preview.remainingAfter).toEqual({ amount_in_cents: 2_500, currency: 'USD' });
  });

  it('permits reauthorization only after expiration', () => {
    const preview = previewReauthorization(
      order,
      { amount_in_cents: 1_000, currency: 'USD' },
      new Date('2026-07-16T12:00:00Z'),
    );

    expect(preview.validation.code).toBe('AUTHORIZATION_NOT_EXPIRED');
  });
});
