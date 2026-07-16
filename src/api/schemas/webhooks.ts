import { z } from 'zod';

import { webhookEventTypeSchema } from '../../domain/webhook.js';
import { linkSchema, resourceIdSchema } from './common.js';

const callbackUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === 'https:' ||
    (url.protocol === 'http:' &&
      (url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === 'localhost'))
  );
}, 'Webhook URL must use HTTPS, except for loopback testing.');

export const webhookRequestSchema = z
  .object({
    url: callbackUrlSchema,
    events: z.array(webhookEventTypeSchema).min(1).max(20),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.events).size !== request.events.length) {
      context.addIssue({
        code: 'custom',
        path: ['events'],
        message: 'Webhook events must be unique.',
      });
    }
  });

export type WebhookRequest = z.infer<typeof webhookRequestSchema>;

export const webhookSubscriptionSchema = z
  .object({
    uuid: resourceIdSchema,
    url: callbackUrlSchema.optional(),
    events: z.array(webhookEventTypeSchema).optional(),
    links: z.array(linkSchema).optional(),
  })
  .strip();

export type WebhookSubscription = z.infer<typeof webhookSubscriptionSchema>;

export const webhookListSchema = z.array(webhookSubscriptionSchema);

export const webhookTestRequestSchema = z
  .object({
    url: callbackUrlSchema,
    event: webhookEventTypeSchema,
  })
  .strict();

export type WebhookTestRequest = z.infer<typeof webhookTestRequestSchema>;
