import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AppConfig } from '../../config/env.js';
import { shouldRegisterTool } from '../../config/permissions.js';
import { executeTool } from '../../server/tool-result.js';
import type { MerchantOperations } from '../../services/merchant-operations.js';
import { amountInput, orderUuidInput, previewIdInput, requirePreviewId } from '../shared.js';

const referenceIdInput = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9_-]+$/)
  .describe('Merchant reference ID.');

export const registerOrderTools = (
  server: McpServer,
  operations: MerchantOperations,
  config: AppConfig,
): void => {
  if (shouldRegisterTool({ capability: 'read', mutation: false, dangerous: false }, config)) {
    server.registerTool(
      'sezzle_get_order',
      {
        title: 'Get Sezzle Order',
        description:
          'Read a documented Sezzle v2 order and return a minimized financial projection without customer PII.',
        inputSchema: { order_uuid: orderUuidInput },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ order_uuid }) => executeTool(() => operations.getOrder(order_uuid)),
    );
  }

  if (!shouldRegisterTool({ capability: 'finance', mutation: true, dangerous: true }, config)) {
    return;
  }

  server.registerTool(
    'sezzle_update_order_reference',
    {
      title: 'Update Sezzle Order Reference',
      description:
        'Two-step update of merchant tracking metadata. Call with confirm=false, then repeat unchanged with preview_id and confirm=true.',
      inputSchema: {
        order_uuid: orderUuidInput,
        reference_id: referenceIdInput,
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
    async ({ order_uuid, reference_id, confirm, preview_id }) =>
      executeTool(() =>
        confirm
          ? operations.updateOrderReference({
              orderUuid: order_uuid,
              referenceId: reference_id,
              confirm: true,
              previewId: requirePreviewId(preview_id),
            })
          : operations.previewUpdateOrderReference(order_uuid, reference_id),
      ),
  );

  server.registerTool(
    'sezzle_reauthorize_order',
    {
      title: 'Reauthorize Sezzle Order',
      description:
        'Two-step reauthorization for an expired authorization. HTTP success is not treated as approval unless authorization.approved is true.',
      inputSchema: {
        order_uuid: orderUuidInput,
        amount: amountInput,
        confirm: z.boolean().default(false),
        preview_id: previewIdInput.optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_uuid, amount, confirm, preview_id }) =>
      executeTool(() =>
        confirm
          ? operations.reauthorizeOrder({
              orderUuid: order_uuid,
              amount,
              confirm: true,
              previewId: requirePreviewId(preview_id),
            })
          : operations.previewReauthorize(order_uuid, amount),
      ),
  );
};
