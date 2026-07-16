import { z } from 'zod';

import { moneyInputSchema } from '../../domain/money.js';
import { resourceIdSchema } from './common.js';

const referenceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(
    /^[A-Za-z0-9_-]+$/,
    'Reference IDs may contain letters, numbers, dashes, and underscores.',
  );

const redirectSchema = z
  .object({
    href: z.url(),
    method: z.literal('GET').default('GET'),
  })
  .strict();

const addressSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    street: z.string().trim().min(1).max(200).optional(),
    street2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(100).optional(),
    state: z.string().trim().min(1).max(100).optional(),
    postal_code: z.string().trim().min(1).max(20).optional(),
    country_code: z.string().trim().length(2).toUpperCase().optional(),
    phone: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const customerSchema = z
  .object({
    email: z.email().optional(),
    first_name: z.string().trim().min(1).max(100).optional(),
    last_name: z.string().trim().min(1).max(100).optional(),
    phone: z.string().trim().min(1).max(40).optional(),
    dob: z.iso.date().optional(),
    billing_address: addressSchema.optional(),
    shipping_address: addressSchema.optional(),
    tokenize: z.boolean().optional(),
    recurring: z.boolean().optional(),
    recurring_metadata: z
      .object({ name: z.string().trim().min(1).max(200) })
      .strict()
      .optional(),
  })
  .strict();

const lineItemSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    sku: z.string().trim().min(1).max(255).optional(),
    quantity: z.number().int().positive(),
    price: moneyInputSchema,
    category_path: z.string().trim().min(1).max(500).optional(),
    brand: z.string().trim().min(1).max(200).optional(),
    image_url: z.url().optional(),
    product_url: z.url().optional(),
    global_trade_item_number: z.string().trim().min(1).max(50).optional(),
    manufacturer_part_number: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

const discountSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    amount: moneyInputSchema,
  })
  .strict();

const orderSchema = z
  .object({
    intent: z.enum(['AUTH', 'CAPTURE']),
    reference_id: referenceIdSchema,
    description: z.string().trim().min(1).max(500),
    order_amount: moneyInputSchema,
    items: z.array(lineItemSchema).max(500).optional(),
    discounts: z.array(discountSchema).max(100).optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    shipping_amount: moneyInputSchema.optional(),
    tax_amount: moneyInputSchema.optional(),
    requires_shipping_info: z.boolean().optional(),
    checkout_mode: z.enum(['iframe', 'popup', 'redirect']).optional(),
    locale: z.enum(['en-US', 'en-CA', 'fr-CA']).optional(),
    checkout_financing_options: z
      .array(z.enum(['4-pay-biweekly', '4-pay-monthly', '6-pay-monthly']))
      .max(1)
      .optional(),
  })
  .strict();

export const createSessionRequestSchema = z
  .object({
    cancel_url: redirectSchema,
    complete_url: redirectSchema,
    customer: customerSchema.optional(),
    order: orderSchema,
    express_checkout_type: z.enum(['single-step', 'multi-step', 'no-shipping']).optional(),
  })
  .strict()
  .superRefine((session, context) => {
    const orderCurrency = session.order.order_amount.currency;
    const moneyFields = [
      session.order.shipping_amount,
      session.order.tax_amount,
      ...(session.order.items?.map((item) => item.price) ?? []),
      ...(session.order.discounts?.map((discount) => discount.amount) ?? []),
    ].filter((money) => money !== undefined);
    for (const money of moneyFields) {
      if (money.currency !== orderCurrency) {
        context.addIssue({
          code: 'custom',
          message: `All order money must use ${orderCurrency}.`,
          path: ['order'],
        });
      }
    }

    if (session.order.items !== undefined) {
      let expected = 0n;
      for (const item of session.order.items) {
        expected += BigInt(item.price.amount_in_cents) * BigInt(item.quantity);
      }
      expected += BigInt(session.order.shipping_amount?.amount_in_cents ?? 0);
      expected += BigInt(session.order.tax_amount?.amount_in_cents ?? 0);
      for (const discount of session.order.discounts ?? []) {
        expected -= BigInt(discount.amount.amount_in_cents);
      }
      if (expected !== BigInt(session.order.order_amount.amount_in_cents)) {
        context.addIssue({
          code: 'custom',
          message: 'Order total does not match items, shipping, tax, and discounts.',
          path: ['order', 'order_amount'],
        });
      }
    }
  });

export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;

export const updateReferenceRequestSchema = z.object({ reference_id: referenceIdSchema }).strict();

export type UpdateReferenceRequest = z.infer<typeof updateReferenceRequestSchema>;

export const resourceInputSchema = z.object({ id: resourceIdSchema }).strict();
