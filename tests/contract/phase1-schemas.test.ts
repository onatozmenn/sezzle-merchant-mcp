import { describe, expect, it } from 'vitest';

import { orderSnapshotSchema } from '../../src/api/schemas/phase1.js';

describe('Phase 1 OpenAPI contract adapters', () => {
  it('normalizes the nested authorization-event representation from OpenAPI examples', () => {
    const order = orderSnapshotSchema.parse({
      uuid: 'order-1',
      order_amount: { amount_in_cents: 10_000, currency: 'USD' },
      authorization: {
        authorization_amount: { amount_in_cents: 10_000, currency: 'USD' },
        approved: true,
        expiration: '2026-07-17T00:00:00Z',
        captures: [
          {
            uuid: 'capture-1',
            amount: { amount_in_cents: 7_000, currency: 'USD' },
          },
        ],
      },
      customer: { email: 'not-returned@example.com' },
    });

    expect(order.authorization?.captures[0]).toEqual({
      uuid: 'capture-1',
      amount: { amount_in_cents: 7_000, currency: 'USD' },
    });
    expect(order).not.toHaveProperty('customer');
  });

  it('normalizes the flat authorization-event representation from the component schema', () => {
    const order = orderSnapshotSchema.parse({
      uuid: 'order-2',
      authorization: {
        authorization_amount: { amount_in_cents: 5_000, currency: 'CAD' },
        approved: true,
        expiration: '2026-07-17T00:00:00Z',
        refunds: [{ amount_in_cents: 500, currency_code: 'CAD' }],
      },
    });

    expect(order.authorization?.refunds[0]).toEqual({
      amount: { amount_in_cents: 500, currency: 'CAD' },
    });
  });
});
