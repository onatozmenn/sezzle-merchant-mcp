import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { AppConfig } from '../config/env.js';
import { profileHasCapability, type Capability } from '../config/permissions.js';

const registerEvidencePrompt = (
  server: McpServer,
  config: AppConfig,
  capability: Capability,
  name: string,
  title: string,
  workflow: string,
): void => {
  if (!profileHasCapability(config.sezzle.permissionProfile, capability)) return;
  server.registerPrompt(
    name,
    {
      title,
      description: `${title} using evidence-first, non-executing SezzleOps workflows.`,
      argsSchema: {
        context: z.string().max(10_000).optional().describe('Non-secret case or review context.'),
      },
    },
    ({ context }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: [
              workflow,
              'Gather current evidence before drawing conclusions.',
              'Use deterministic tools for all money arithmetic and comparisons.',
              'Separate known facts from interpretation and recommendations.',
              'Do not claim an action succeeded without API evidence.',
              'Prepare previews only; never execute a mutation unless the user separately supplies explicit confirmation.',
              context === undefined ? '' : `Context: ${context}`,
            ]
              .filter((line) => line !== '')
              .join('\n'),
          },
        },
      ],
    }),
  );
};

export const registerPrompts = (server: McpServer, config: AppConfig): void => {
  registerEvidencePrompt(
    server,
    config,
    'read',
    'sezzle_daily_operations_review',
    'Sezzle Daily Operations Review',
    'Review current orders, uncaptured authorizations, refunds, settlements, and diagnostics.',
  );
  registerEvidencePrompt(
    server,
    config,
    'finance',
    'sezzle_settlement_reconciliation',
    'Sezzle Settlement Reconciliation',
    'Collect merchant and Sezzle records, run deterministic reconciliation, and cite evidence for every difference.',
  );
  registerEvidencePrompt(
    server,
    config,
    'read',
    'sezzle_integration_go_live_review',
    'Sezzle Integration Go-Live Review',
    'Run Integration Doctor checks and produce a blocking, evidence-based go-live checklist.',
  );
  registerEvidencePrompt(
    server,
    config,
    'webhooks',
    'sezzle_webhook_incident_investigation',
    'Sezzle Webhook Incident Investigation',
    'Inspect signature verification, duplicate delivery, missing events, subscriptions, and occurrence-time timelines.',
  );
  registerEvidencePrompt(
    server,
    config,
    'support',
    'sezzle_support_case_review',
    'Sezzle Support Case Review',
    'Verify merchant order ownership, minimize order data, classify the request, and identify required escalation.',
  );
};
