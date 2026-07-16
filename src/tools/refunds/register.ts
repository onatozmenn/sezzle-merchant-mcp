import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AppConfig } from '../../config/env.js';
import { shouldRegisterTool } from '../../config/permissions.js';
import { executeTool } from '../../server/tool-result.js';
import type { MerchantOperations } from '../../services/merchant-operations.js';
import { amountInput, orderUuidInput, previewIdInput } from '../shared.js';

export const registerRefundTools = (
  server: McpServer,
  operations: MerchantOperations,
  config: AppConfig,
): void => {
  if (!shouldRegisterTool({ capability: 'finance', mutation: false, dangerous: false }, config)) {
    return;
  }
  server.registerTool(
    'sezzle_preview_refund',
    {
      title: 'Preview Sezzle Refund',
      description:
        'Read captures and prior refunds, then deterministically preview a refund without moving funds.',
      inputSchema: { order_uuid: orderUuidInput, amount: amountInput },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_uuid, amount }) =>
      executeTool(() => operations.previewRefund(order_uuid, amount)),
  );

  if (!shouldRegisterTool({ capability: 'finance', mutation: true, dangerous: true }, config)) {
    return;
  }
  server.registerTool(
    'sezzle_refund_order',
    {
      title: 'Refund Sezzle Order',
      description:
        'Execute exactly the matching refund preview. Requires preview_id and literal confirm=true.',
      inputSchema: {
        order_uuid: orderUuidInput,
        amount: amountInput,
        preview_id: previewIdInput,
        confirm: z.literal(true),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_uuid, amount, preview_id, confirm }) =>
      executeTool(() =>
        operations.refundOrder({
          orderUuid: order_uuid,
          amount,
          previewId: preview_id,
          confirm,
        }),
      ),
  );
};
