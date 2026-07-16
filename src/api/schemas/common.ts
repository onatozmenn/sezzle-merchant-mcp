import { z } from 'zod';

import { currencySchema } from '../../domain/money.js';

export const resourceIdSchema = z.string().trim().min(1).max(255);
export const dateTimeSchema = z.iso.datetime({ offset: true });

export const priceWireSchema = z
  .object({
    amount_in_cents: z.number().int(),
    currency: currencySchema,
  })
  .strict();

export type PriceWire = z.infer<typeof priceWireSchema>;

export const linkSchema = z
  .object({
    href: z.url(),
    method: z.enum(['GET', 'POST', 'PATCH', 'DELETE']).optional(),
    rel: z.string().optional(),
  })
  .strip();

// OpenAPI examples nest transaction amounts under `amount`, while the published
// AuthorizationEvent component uses flat amount_in_cents/currency_code fields.
// Accept only those two documented forms until real sandbox responses confirm one.
export const transactionEventSchema = z
  .union([
    z
      .looseObject({
        uuid: resourceIdSchema.optional(),
        amount: priceWireSchema,
      })
      .transform((event) => ({ uuid: event.uuid, amount: event.amount })),
    z
      .looseObject({
        uuid: resourceIdSchema.optional(),
        amount_in_cents: z.number().int(),
        currency_code: currencySchema,
      })
      .transform((event) => ({
        uuid: event.uuid,
        amount: {
          amount_in_cents: event.amount_in_cents,
          currency: event.currency_code,
        },
      })),
  ])
  .transform((event) =>
    event.uuid === undefined
      ? { amount: event.amount }
      : { uuid: event.uuid, amount: event.amount },
  );
