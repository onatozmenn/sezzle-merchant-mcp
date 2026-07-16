import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { createSessionRequestSchema } from '../../api/schemas/requests.js';
import type { AppConfig } from '../../config/env.js';
import { shouldRegisterTool } from '../../config/permissions.js';
import { executeTool } from '../../server/tool-result.js';
import type { MerchantOperations } from '../../services/merchant-operations.js';
import { orderUuidInput, previewIdInput, requirePreviewId, sessionUuidInput } from '../shared.js';

export const registerSessionTools = (
  server: McpServer,
  operations: MerchantOperations,
  config: AppConfig,
): void => {
  if (shouldRegisterTool({ capability: 'read', mutation: false, dangerous: false }, config)) {
    server.registerTool(
      'sezzle_get_payment_session',
      {
        title: 'Get Sezzle Payment Session',
        description: 'Read a documented Sezzle v2 payment session by UUID.',
        inputSchema: { session_uuid: sessionUuidInput },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ session_uuid }) => executeTool(() => operations.getPaymentSession(session_uuid)),
    );
  }

  if (!shouldRegisterTool({ capability: 'finance', mutation: true, dangerous: true }, config)) {
    return;
  }

  server.registerTool(
    'sezzle_create_payment_session',
    {
      title: 'Create Sezzle Payment Session',
      description:
        'Two-step session creation. Call with confirm=false for a safe preview, then repeat unchanged with preview_id and confirm=true.',
      inputSchema: {
        session: createSessionRequestSchema,
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
    async ({ session, confirm, preview_id }) =>
      executeTool(() =>
        confirm
          ? operations.createPaymentSession({
              session,
              confirm: true,
              previewId: requirePreviewId(preview_id),
            })
          : operations.previewCreatePaymentSession(session),
      ),
  );

  server.registerTool(
    'sezzle_cancel_active_checkout',
    {
      title: 'Cancel Active Sezzle Checkout',
      description:
        'Two-step irreversible deletion of an active incomplete checkout. Call first with confirm=false.',
      inputSchema: {
        order_uuid: orderUuidInput,
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
    async ({ order_uuid, confirm, preview_id }) =>
      executeTool(() =>
        confirm
          ? operations.cancelActiveCheckout({
              orderUuid: order_uuid,
              confirm: true,
              previewId: requirePreviewId(preview_id),
            })
          : operations.previewCancelActiveCheckout(order_uuid),
      ),
  );
};
