import { z } from 'zod';

export const webhookEventTypeSchema = z.enum([
  'customer.tokenized',
  'order.authorized',
  'order.captured',
  'order.refunded',
  'dispute.merchant_input_requested',
  'dispute.deadline_approaching',
  'dispute.closed.customer_win',
  'dispute.closed.merchant_win',
  'dispute.closed.neutral',
]);

export type WebhookEventType = z.infer<typeof webhookEventTypeSchema>;

export const webhookPayloadSchema = z.looseObject({
  uuid: z.string().trim().min(1).max(255),
  created_at: z.iso.datetime({ offset: true }),
  event: webhookEventTypeSchema,
  data_type: z.string().trim().min(1).max(100),
  data: z.looseObject({}),
});

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;

export interface WebhookRelatedIds {
  readonly orderUuid?: string;
  readonly sessionUuid?: string;
  readonly disputeId?: string;
  readonly merchantUuid?: string;
  readonly customerUuid?: string;
}
