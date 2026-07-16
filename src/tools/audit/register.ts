import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AppConfig } from '../../config/env.js';
import { shouldRegisterTool } from '../../config/permissions.js';
import { executeTool } from '../../server/tool-result.js';
import type { AuditLog } from '../../services/audit-log.js';

export const registerAuditTools = (server: McpServer, audit: AuditLog, config: AppConfig): void => {
  if (!shouldRegisterTool({ capability: 'admin', mutation: false, dangerous: false }, config)) {
    return;
  }
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  } as const;

  server.registerTool(
    'sezzle_list_audit_events',
    {
      description:
        'List redacted mutation and ingestion audit metadata. Payloads and secrets are not stored.',
      inputSchema: {
        tool: z.string().trim().min(1).max(255).optional(),
        target_id: z.string().trim().min(1).max(500).optional(),
        result: z.enum(['preview', 'success', 'failure', 'rejected']).optional(),
        limit: z.number().int().min(1).max(1_000).default(100),
      },
      annotations,
    },
    async ({ tool, target_id, result, limit }) =>
      executeTool(() =>
        audit.list({
          ...(tool === undefined ? {} : { tool }),
          ...(target_id === undefined ? {} : { targetId: target_id }),
          ...(result === undefined ? {} : { result }),
          limit,
        }),
      ),
  );

  server.registerTool(
    'sezzle_get_audit_event',
    {
      description: 'Get one redacted audit event by audit ID.',
      inputSchema: { audit_id: z.string().trim().min(1).max(255) },
      annotations,
    },
    async ({ audit_id }) => executeTool(() => audit.get(audit_id)),
  );
};
