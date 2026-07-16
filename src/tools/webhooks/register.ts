import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { webhookRequestSchema, webhookTestRequestSchema } from '../../api/schemas/webhooks.js';
import type { AppConfig } from '../../config/env.js';
import { shouldRegisterTool } from '../../config/permissions.js';
import { webhookEventTypeSchema } from '../../domain/webhook.js';
import { executeTool } from '../../server/tool-result.js';
import type { WebhookOperations } from '../../services/webhook-operations.js';
import { previewIdInput, requirePreviewId } from '../shared.js';

const webhookUuidInput = z.string().trim().min(1).max(255);
const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const registerWebhookTools = (
  server: McpServer,
  operations: WebhookOperations,
  config: AppConfig,
): void => {
  if (!shouldRegisterTool({ capability: 'webhooks', mutation: false, dangerous: false }, config)) {
    return;
  }

  server.registerTool(
    'sezzle_list_webhooks',
    {
      description: 'List documented Sezzle v2 webhook subscriptions.',
      inputSchema: {},
      annotations: { ...readAnnotations, openWorldHint: true },
    },
    async () => executeTool(() => operations.listWebhooks()),
  );
  server.registerTool(
    'sezzle_verify_webhook_signature',
    {
      description:
        'Verify a Sezzle HMAC-SHA256 signature against the exact raw body without parsing or storing it.',
      inputSchema: {
        raw_body: z.string().min(1).max(2_000_000),
        signature: z.string().min(1).max(256),
      },
      annotations: readAnnotations,
    },
    async ({ raw_body, signature }) =>
      executeTool(() => Promise.resolve(operations.verifySignature(raw_body, signature))),
  );
  server.registerTool(
    'sezzle_list_webhook_events',
    {
      description:
        'List verified stored webhook event metadata without raw payload or customer data.',
      inputSchema: {
        correlation_key: z.string().trim().min(1).max(500).optional(),
        event_type: webhookEventTypeSchema.optional(),
        limit: z.number().int().min(1).max(1_000).default(100),
      },
      annotations: readAnnotations,
    },
    async ({ correlation_key, event_type, limit }) =>
      executeTool(() =>
        operations.listEvents({
          ...(correlation_key === undefined ? {} : { correlationKey: correlation_key }),
          ...(event_type === undefined ? {} : { eventType: event_type }),
          limit,
        }),
      ),
  );
  server.registerTool(
    'sezzle_get_webhook_event',
    {
      description: 'Get verified webhook event metadata by event UUID without raw payload.',
      inputSchema: { event_id: z.string().trim().min(1).max(255) },
      annotations: readAnnotations,
    },
    async ({ event_id }) => executeTool(() => operations.getEvent(event_id)),
  );
  server.registerTool(
    'sezzle_inspect_webhook_health',
    {
      description:
        'Inspect verified event, invalid-signature, duplicate-delivery, and correlation health.',
      inputSchema: {},
      annotations: readAnnotations,
    },
    async () => executeTool(() => operations.inspectHealth()),
  );
  server.registerTool(
    'sezzle_find_missing_order_events',
    {
      description:
        'Compare expected webhook event types with verified events observed for each order.',
      inputSchema: {
        orders: z
          .array(
            z
              .object({
                order_uuid: z.string().trim().min(1).max(255),
                expected_events: z.array(webhookEventTypeSchema).min(1),
              })
              .strict(),
          )
          .max(10_000),
      },
      annotations: readAnnotations,
    },
    async ({ orders }) =>
      executeTool(() =>
        operations.findMissingOrderEvents(
          orders.map((order) => ({
            orderUuid: order.order_uuid,
            expectedEvents: order.expected_events,
          })),
        ),
      ),
  );
  server.registerTool(
    'sezzle_detect_out_of_order_events',
    {
      description:
        'Detect correlations where receipt order differs from event occurrence order; no derived order state is mutated.',
      inputSchema: { correlation_key: z.string().trim().min(1).max(500).optional() },
      annotations: readAnnotations,
    },
    async ({ correlation_key }) =>
      executeTool(() => operations.detectOutOfOrderEvents(correlation_key)),
  );
  server.registerTool(
    'sezzle_detect_duplicate_webhook_events',
    {
      description: 'List verified webhook events that were delivered more than once.',
      inputSchema: {},
      annotations: readAnnotations,
    },
    async () => executeTool(() => operations.detectDuplicateEvents()),
  );

  if (!shouldRegisterTool({ capability: 'webhooks', mutation: true, dangerous: false }, config)) {
    return;
  }

  server.registerTool(
    'sezzle_ingest_webhook_event',
    {
      description:
        'Verify then idempotently store a raw webhook event. Requires literal confirm=true; invalid signatures are rejected before parsing.',
      inputSchema: {
        raw_body: z.string().min(1).max(2_000_000),
        signature: z.string().min(1).max(256),
        confirm: z.literal(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ raw_body, signature }) =>
      executeTool(() => operations.ingestEvent(raw_body, signature)),
  );

  if (!shouldRegisterTool({ capability: 'webhooks', mutation: true, dangerous: true }, config)) {
    return;
  }

  server.registerTool(
    'sezzle_create_webhook',
    {
      description:
        'Two-step creation of a documented Sezzle webhook subscription. Call with confirm=false first.',
      inputSchema: {
        webhook: webhookRequestSchema,
        confirm: z.boolean().default(false),
        preview_id: previewIdInput.optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ webhook, confirm, preview_id }) =>
      executeTool(() =>
        confirm
          ? operations.createWebhook({
              request: webhook,
              confirm: true,
              previewId: requirePreviewId(preview_id),
            })
          : operations.previewCreateWebhook(webhook),
      ),
  );
  server.registerTool(
    'sezzle_update_webhook',
    {
      description:
        'Two-step replacement of a webhook URL and complete event set. Call with confirm=false first.',
      inputSchema: {
        webhook_uuid: webhookUuidInput,
        webhook: webhookRequestSchema,
        confirm: z.boolean().default(false),
        preview_id: previewIdInput.optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ webhook_uuid, webhook, confirm, preview_id }) =>
      executeTool(() =>
        confirm
          ? operations.updateWebhook({
              webhookUuid: webhook_uuid,
              request: webhook,
              confirm: true,
              previewId: requirePreviewId(preview_id),
            })
          : operations.previewUpdateWebhook(webhook_uuid, webhook),
      ),
  );
  server.registerTool(
    'sezzle_delete_webhook',
    {
      description: 'Two-step irreversible deletion of a webhook subscription.',
      inputSchema: {
        webhook_uuid: webhookUuidInput,
        confirm: z.boolean().default(false),
        preview_id: previewIdInput.optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ webhook_uuid, confirm, preview_id }) =>
      executeTool(() =>
        confirm
          ? operations.deleteWebhook({
              webhookUuid: webhook_uuid,
              confirm: true,
              previewId: requirePreviewId(preview_id),
            })
          : operations.previewDeleteWebhook(webhook_uuid),
      ),
  );
  server.registerTool(
    'sezzle_send_test_webhook',
    {
      description: 'Two-step request to send a documented Sezzle test webhook to a specified URL.',
      inputSchema: {
        test: webhookTestRequestSchema,
        confirm: z.boolean().default(false),
        preview_id: previewIdInput.optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ test, confirm, preview_id }) =>
      executeTool(() =>
        confirm
          ? operations.sendTestWebhook({
              request: test,
              confirm: true,
              previewId: requirePreviewId(preview_id),
            })
          : operations.previewTestWebhook(test),
      ),
  );
};
