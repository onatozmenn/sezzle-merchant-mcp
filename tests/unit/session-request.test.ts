import { describe, expect, it } from 'vitest';

import { createSessionRequestSchema } from '../../src/api/schemas/requests.js';

const baseRequest = {
  cancel_url: { href: 'https://merchant.example/cart', method: 'GET' as const },
  complete_url: { href: 'https://merchant.example/complete', method: 'GET' as const },
  order: {
    intent: 'AUTH' as const,
    reference_id: 'order_123',
    description: 'Order 123',
    order_amount: { amount_in_cents: 1_100, currency: 'USD' as const },
    items: [
      {
        name: 'Item',
        quantity: 1,
        price: { amount_in_cents: 1_000, currency: 'USD' as const },
      },
    ],
    tax_amount: { amount_in_cents: 100, currency: 'USD' as const },
  },
};

describe('create session request validation', () => {
  it('accepts a balanced integer-minor-unit order', () => {
    expect(createSessionRequestSchema.parse(baseRequest).order.order_amount.amount_in_cents).toBe(
      1_100,
    );
  });

  it('rejects inconsistent totals before calling Sezzle', () => {
    expect(() =>
      createSessionRequestSchema.parse({
        ...baseRequest,
        order: {
          ...baseRequest.order,
          order_amount: { amount_in_cents: 1_101, currency: 'USD' },
        },
      }),
    ).toThrow('Order total does not match');
  });

  it('rejects mixed currencies before calling Sezzle', () => {
    expect(() =>
      createSessionRequestSchema.parse({
        ...baseRequest,
        order: {
          ...baseRequest.order,
          tax_amount: { amount_in_cents: 100, currency: 'CAD' },
        },
      }),
    ).toThrow('All order money must use USD');
  });
});
