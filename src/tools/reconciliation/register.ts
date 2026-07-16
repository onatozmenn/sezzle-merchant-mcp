import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AppConfig } from '../../config/env.js';
import { shouldRegisterTool } from '../../config/permissions.js';
import {
  reconciliationInputSchema,
  type ReconciliationEngine,
} from '../../domain/reconciliation.js';
import { executeTool } from '../../server/tool-result.js';

const annotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const registerReconciliationTools = (
  server: McpServer,
  engine: ReconciliationEngine,
  config: AppConfig,
): void => {
  if (!shouldRegisterTool({ capability: 'finance', mutation: false, dangerous: false }, config)) {
    return;
  }
  const inputSchema = { input: reconciliationInputSchema } as const;

  server.registerTool(
    'sezzle_reconcile_settlement',
    {
      description:
        'Deterministically reconcile structured merchant orders with Sezzle settlement records and payout evidence.',
      inputSchema,
      annotations,
    },
    async ({ input }) => executeTool(() => Promise.resolve(engine.reconcile(input))),
  );
  server.registerTool(
    'sezzle_find_unmatched_orders',
    {
      description: 'Find merchant and Sezzle order records without a deterministic match.',
      inputSchema,
      annotations,
    },
    async ({ input }) => executeTool(() => Promise.resolve(engine.findUnmatchedOrders(input))),
  );
  server.registerTool(
    'sezzle_detect_refund_mismatches',
    {
      description: 'Compare merchant and Sezzle refund totals using integer minor units.',
      inputSchema,
      annotations,
    },
    async ({ input }) => executeTool(() => Promise.resolve(engine.detectRefundMismatches(input))),
  );
  server.registerTool(
    'sezzle_detect_capture_mismatches',
    {
      description: 'Compare merchant and Sezzle capture totals using integer minor units.',
      inputSchema,
      annotations,
    },
    async ({ input }) => executeTool(() => Promise.resolve(engine.detectCaptureMismatches(input))),
  );
  server.registerTool(
    'sezzle_detect_fee_anomalies',
    {
      description: 'Compare expected fees with net Sezzle fees and returned fees.',
      inputSchema,
      annotations,
    },
    async ({ input }) => executeTool(() => Promise.resolve(engine.detectFeeAnomalies(input))),
  );
  server.registerTool(
    'sezzle_explain_payout_difference',
    {
      description:
        'Explain actual versus expected payout from traceable deterministic evidence; no LLM arithmetic is used.',
      inputSchema,
      annotations,
    },
    async ({ input }) => executeTool(() => Promise.resolve(engine.explainPayoutDifference(input))),
  );
  server.registerTool(
    'sezzle_generate_finance_daily_brief',
    {
      description:
        'Generate a deterministic finance brief of payout balance, unmatched records, duplicates, and high-priority mismatches.',
      inputSchema,
      annotations,
    },
    async ({ input }) =>
      executeTool(() => Promise.resolve(engine.generateFinanceDailyBrief(input))),
  );
};
