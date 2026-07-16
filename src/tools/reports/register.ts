import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AppConfig } from '../../config/env.js';
import { shouldRegisterTool } from '../../config/permissions.js';
import { currencySchema } from '../../domain/money.js';
import { executeTool } from '../../server/tool-result.js';
import type { MerchantOperations } from '../../services/merchant-operations.js';

const dateInput = z.iso.date();
const readAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const registerReportTools = (
  server: McpServer,
  operations: MerchantOperations,
  config: AppConfig,
): void => {
  if (!shouldRegisterTool({ capability: 'read', mutation: false, dangerous: false }, config)) {
    return;
  }

  server.registerTool(
    'sezzle_list_settlement_summaries',
    {
      description: 'List documented settlement payout summaries with lossless minor-unit amounts.',
      inputSchema: {
        start_date: dateInput,
        end_date: dateInput,
        offset: z.number().int().nonnegative().default(0),
        currency: currencySchema.default('USD'),
      },
      annotations: readAnnotations,
    },
    async ({ start_date, end_date, offset, currency }) =>
      executeTool(() =>
        operations.listSettlementSummaries({
          startDate: start_date,
          endDate: end_date,
          offset,
          currency,
        }),
      ),
  );

  server.registerTool(
    'sezzle_get_settlement_details',
    {
      description: 'Get and parse a documented settlement detail CSV by payout UUID.',
      inputSchema: {
        payout_uuid: z.string().trim().min(1).max(255),
        metadata: z.array(z.string().trim().min(1).max(100)).max(25).default([]),
      },
      annotations: readAnnotations,
    },
    async ({ payout_uuid, metadata }) =>
      executeTool(() => operations.getSettlementDetails({ payoutUuid: payout_uuid, metadata })),
  );

  server.registerTool(
    'sezzle_get_order_report',
    {
      description:
        'Get the allowlisted Sezzle order report for a maximum seven-day range, excluding customer PII.',
      inputSchema: { start_date: dateInput, end_date: dateInput },
      annotations: readAnnotations,
    },
    async ({ start_date, end_date }) =>
      executeTool(() => operations.getOrderReport({ startDate: start_date, endDate: end_date })),
  );

  server.registerTool(
    'sezzle_get_interest_balance',
    {
      description:
        'Get interest-account balance losslessly at four-decimal scale. Enrollment is required by Sezzle.',
      inputSchema: { currency: currencySchema.default('USD') },
      annotations: readAnnotations,
    },
    async ({ currency }) => executeTool(() => operations.getInterestBalance({ currency })),
  );

  server.registerTool(
    'sezzle_get_interest_activity',
    {
      description:
        'Get and parse interest-account activity at four-decimal scale. Enrollment is required by Sezzle.',
      inputSchema: {
        start_date: dateInput,
        end_date: dateInput,
        offset: z.number().int().nonnegative().default(0),
        currency: currencySchema.default('USD'),
      },
      annotations: readAnnotations,
    },
    async ({ start_date, end_date, offset, currency }) =>
      executeTool(() =>
        operations.getInterestActivity({
          startDate: start_date,
          endDate: end_date,
          offset,
          currency,
        }),
      ),
  );
};
