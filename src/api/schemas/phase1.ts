import { z } from 'zod';

import {
  dateTimeSchema,
  linkSchema,
  priceWireSchema,
  resourceIdSchema,
  transactionEventSchema,
} from './common.js';

export const authenticationResponseSchema = z
  .object({
    token: z.string().min(1),
    expiration_date: dateTimeSchema,
    merchant_uuid: resourceIdSchema,
  })
  .strip();

export type AuthenticationResponse = z.infer<typeof authenticationResponseSchema>;

const sessionOrderSchema = z
  .object({
    uuid: resourceIdSchema,
    intent: z.enum(['AUTH', 'CAPTURE']).optional(),
    checkout_url: z.url().optional(),
    links: z.array(linkSchema).optional(),
  })
  .strip();

export const sessionResponseSchema = z
  .object({
    uuid: resourceIdSchema,
    links: z.array(linkSchema).optional(),
    order: sessionOrderSchema.optional(),
    tokenize: z
      .object({
        token: z.string().min(1).optional(),
        expiration: dateTimeSchema.optional(),
        approval_url: z.url().optional(),
      })
      .strip()
      .optional(),
  })
  .strip();

export type SessionResponse = z.infer<typeof sessionResponseSchema>;

const authorizationSchema = z
  .object({
    authorization_amount: priceWireSchema,
    authorization_amount_in_user_currency: priceWireSchema.optional(),
    approved: z.boolean(),
    expiration: dateTimeSchema,
    financing_option: z.string().optional(),
    sezzle_order_id: z.string().optional(),
    captures: z.array(transactionEventSchema).default([]),
    refunds: z.array(transactionEventSchema).default([]),
    releases: z.array(transactionEventSchema).default([]),
  })
  .strip();

export const orderSnapshotSchema = z
  .object({
    uuid: resourceIdSchema,
    intent: z.enum(['AUTH', 'CAPTURE']).optional(),
    reference_id: z.string().optional(),
    description: z.string().optional(),
    checkout_expiration: dateTimeSchema.optional(),
    checkout_status: z.enum(['active', 'complete', 'denied', 'deleted']).optional(),
    order_amount: priceWireSchema.optional(),
    authorization: authorizationSchema.optional(),
  })
  .strip();

export type OrderSnapshot = z.infer<typeof orderSnapshotSchema>;

export const transactionResponseSchema = z
  .object({
    uuid: resourceIdSchema,
  })
  .strip();

export type TransactionResponse = z.infer<typeof transactionResponseSchema>;

export const reauthorizationResponseSchema = z
  .object({
    uuid: resourceIdSchema,
    intent: z.literal('AUTH'),
    reference_id: z.string().optional(),
    order_amount: priceWireSchema,
    authorization: z
      .object({
        authorization_amount: priceWireSchema,
        approved: z.boolean(),
        expiration: dateTimeSchema,
      })
      .strip(),
  })
  .strip();

export type ReauthorizationResponse = z.infer<typeof reauthorizationResponseSchema>;
