import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AppConfig } from '../../config/env.js';
import { shouldRegisterTool } from '../../config/permissions.js';
import { executeTool } from '../../server/tool-result.js';
import type { MerchantOperations } from '../../services/merchant-operations.js';
import { amountInput, orderUuidInput, previewIdInput } from '../shared.js';

export const registerReleaseTools = (
  server: McpServer,
  operations: MerchantOperations,
  config: AppConfig,
): void => {
  if (!shouldRegisterTool({ capability: 'finance', mutation: false, dangerous: false }, config)) {
    return;
  }
  server.registerTool(
    'sezzle_preview_release_authorization',
    {
      title: 'Preview Sezzle Authorization Release',
      description:
        'Read uncaptured authorization state and preview a release without changing the order.',
      inputSchema: { order_uuid: orderUuidInput, amount: amountInput },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ order_uuid, amount }) =>
      executeTool(() => operations.previewRelease(order_uuid, amount)),
  );

  if (!shouldRegisterTool({ capability: 'finance', mutation: true, dangerous: true }, config)) {
    return;
  }
  server.registerTool(
    'sezzle_release_authorization',
    {
      title: 'Release Sezzle Authorization',
      description:
        'Execute exactly the matching authorization-release preview. Requires preview_id and literal confirm=true.',
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
        operations.releaseAuthorization({
          orderUuid: order_uuid,
          amount,
          previewId: preview_id,
          confirm,
        }),
      ),
  );
};
