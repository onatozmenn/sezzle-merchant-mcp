import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AppConfig } from '../../config/env.js';
import { shouldRegisterTool } from '../../config/permissions.js';
import { executeTool } from '../../server/tool-result.js';
import {
  diagnosticOrderSchema,
  integrationDiagnosticSchema,
  redirectDiagnosticSchema,
  webhookDiagnosticSchema,
  type DiagnosticsEngine,
} from '../../services/diagnostics-engine.js';

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const registerDiagnosticTools = (
  server: McpServer,
  engine: DiagnosticsEngine,
  config: AppConfig,
): void => {
  if (!shouldRegisterTool({ capability: 'read', mutation: false, dangerous: false }, config)) {
    return;
  }

  server.registerTool(
    'sezzle_diagnose_integration',
    {
      description:
        'Run deterministic Integration Doctor checks over supplied configuration, order, webhook, and reconciliation evidence.',
      inputSchema: { input: integrationDiagnosticSchema },
      annotations,
    },
    async ({ input }) => executeTool(() => Promise.resolve(engine.diagnoseIntegration(input))),
  );
  server.registerTool(
    'sezzle_validate_session_payload',
    {
      description:
        'Validate a proposed Sezzle session payload deterministically without sending customer or order data to Sezzle.',
      inputSchema: { session_payload: z.unknown() },
      annotations,
    },
    async ({ session_payload }) =>
      executeTool(() => Promise.resolve(engine.validateSessionPayload(session_payload))),
  );
  server.registerTool(
    'sezzle_validate_redirect_urls',
    {
      description:
        'Validate cancel and complete redirects against HTTPS and supplied merchant hosts.',
      inputSchema: { redirects: redirectDiagnosticSchema },
      annotations,
    },
    async ({ redirects }) =>
      executeTool(() => Promise.resolve(engine.validateRedirectUrls(redirects))),
  );
  server.registerTool(
    'sezzle_audit_auth_capture_flow',
    {
      description:
        'Audit supplied authorization, capture, refund, reference, and currency state for deterministic flow defects.',
      inputSchema: {
        orders: z.array(diagnosticOrderSchema).max(25_000),
        now: z.iso.datetime({ offset: true }),
      },
      annotations,
    },
    async ({ orders, now }) =>
      executeTool(() => Promise.resolve(engine.auditAuthCaptureFlow(orders, now))),
  );
  server.registerTool(
    'sezzle_detect_stuck_authorizations',
    {
      description:
        'Find approved uncaptured authorizations that have not progressed within a threshold.',
      inputSchema: {
        orders: z.array(diagnosticOrderSchema).max(25_000),
        now: z.iso.datetime({ offset: true }),
        threshold_minutes: z.number().int().positive().max(43_200).default(60),
      },
      annotations,
    },
    async ({ orders, now, threshold_minutes }) =>
      executeTool(() =>
        Promise.resolve(engine.detectStuckAuthorizations(orders, now, threshold_minutes)),
      ),
  );
  server.registerTool(
    'sezzle_detect_uncaptured_orders',
    {
      description: 'Find approved orders whose captured amount remains below authorization.',
      inputSchema: {
        orders: z.array(diagnosticOrderSchema).max(25_000),
        now: z.iso.datetime({ offset: true }),
      },
      annotations,
    },
    async ({ orders, now }) =>
      executeTool(() => Promise.resolve(engine.detectUncapturedOrders(orders, now))),
  );
  server.registerTool(
    'sezzle_detect_duplicate_refunds',
    {
      description:
        'Detect duplicate refund IDs or repeated amount/time fingerprints in supplied order evidence.',
      inputSchema: { orders: z.array(diagnosticOrderSchema).max(25_000) },
      annotations,
    },
    async ({ orders }) => executeTool(() => Promise.resolve(engine.detectDuplicateRefunds(orders))),
  );
  server.registerTool(
    'sezzle_test_webhook_configuration',
    {
      description:
        'Evaluate webhook subscriptions, invalid signatures, missing events, and out-of-order evidence without sending a test event.',
      inputSchema: { webhooks: webhookDiagnosticSchema },
      annotations,
    },
    async ({ webhooks }) =>
      executeTool(() => Promise.resolve(engine.testWebhookConfiguration(webhooks))),
  );
  server.registerTool(
    'sezzle_generate_go_live_checklist',
    {
      description:
        'Generate a deterministic production-readiness checklist and blocking findings from supplied evidence.',
      inputSchema: { input: integrationDiagnosticSchema },
      annotations,
    },
    async ({ input }) => executeTool(() => Promise.resolve(engine.generateGoLiveChecklist(input))),
  );
};
