import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AppConfig } from '../../config/env.js';
import { shouldRegisterTool } from '../../config/permissions.js';
import { executeTool } from '../../server/tool-result.js';
import type { MerchantOperations } from '../../services/merchant-operations.js';

export const registerAuthTools = (
  server: McpServer,
  operations: MerchantOperations,
  config: AppConfig,
): void => {
  const policy = { capability: 'read', mutation: false, dangerous: false } as const;
  if (!shouldRegisterTool(policy, config)) return;

  server.registerTool(
    'sezzle_authenticate_merchant',
    {
      title: 'Authenticate Sezzle Merchant',
      description:
        'Acquire or refresh a merchant bearer token from configured environment credentials. Secrets are never returned.',
      inputSchema: { force: z.boolean().default(false).describe('Force token reacquisition.') },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ force }) => executeTool(() => operations.authenticateMerchant(force)),
  );

  server.registerTool(
    'sezzle_get_merchant_context',
    {
      title: 'Get Sezzle Merchant Context',
      description:
        'Return non-secret environment, merchant, safety, and permission context for this server process.',
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => executeTool(() => Promise.resolve(operations.getMerchantContext())),
  );
};
