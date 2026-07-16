import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AppConfig } from '../../config/env.js';
import { shouldRegisterTool } from '../../config/permissions.js';
import { executeTool } from '../../server/tool-result.js';
import {
  actionEvidenceSchema,
  supportRequestSchema,
} from '../../services/support-policy-engine.js';
import type { SupportService } from '../../services/support-service.js';

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const registerSupportTools = (
  server: McpServer,
  support: SupportService,
  config: AppConfig,
): void => {
  if (!shouldRegisterTool({ capability: 'support', mutation: false, dangerous: false }, config)) {
    return;
  }

  server.registerTool(
    'sezzle_explain_order_status_for_support',
    {
      description:
        'Explain a PII-free order status only after the authenticated Sezzle order reference matches the supplied merchant reference.',
      inputSchema: {
        order_uuid: z.string().trim().min(1).max(255),
        merchant_order_reference: z.string().trim().min(1).max(255),
      },
      annotations,
    },
    async ({ order_uuid, merchant_order_reference }) =>
      executeTool(() => support.explainOrderStatus(order_uuid, merchant_order_reference)),
  );
  server.registerTool(
    'sezzle_classify_support_request',
    {
      description: 'Classify a support request without accessing an order or selecting a route.',
      inputSchema: { request: supportRequestSchema },
      annotations: { ...annotations, openWorldHint: false },
    },
    async ({ request }) => executeTool(() => Promise.resolve(support.classify(request))),
  );
  server.registerTool(
    'sezzle_draft_customer_response',
    {
      description:
        'Draft policy-safe wording. An action is called confirmed only when structured evidence includes a confirmed status and API request ID.',
      inputSchema: {
        request: supportRequestSchema,
        action_evidence: z.array(actionEvidenceSchema).max(20).default([]),
      },
      annotations: { ...annotations, openWorldHint: false },
    },
    async ({ request, action_evidence }) =>
      executeTool(() =>
        Promise.resolve(support.draftCustomerResponse(request, [], action_evidence)),
      ),
  );
  server.registerTool(
    'sezzle_determine_safe_support_route',
    {
      description:
        'Return allowed next steps and whether a human is required for a support request.',
      inputSchema: { request: supportRequestSchema },
      annotations: { ...annotations, openWorldHint: false },
    },
    async ({ request }) => executeTool(() => Promise.resolve(support.determineSafeRoute(request))),
  );
  server.registerTool(
    'sezzle_identify_required_escalation',
    {
      description:
        'Identify required human escalation for financial, dispute, privacy, decline, or ambiguous support requests.',
      inputSchema: { request: supportRequestSchema },
      annotations: { ...annotations, openWorldHint: false },
    },
    async ({ request }) =>
      executeTool(() => Promise.resolve(support.identifyRequiredEscalation(request))),
  );
};
