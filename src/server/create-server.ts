import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AppConfig } from '../config/env.js';
import type { MerchantOperations } from '../services/merchant-operations.js';
import type { ReconciliationEngine } from '../domain/reconciliation.js';
import type { WebhookOperations } from '../services/webhook-operations.js';
import type { DiagnosticsEngine } from '../services/diagnostics-engine.js';
import type { SupportService } from '../services/support-service.js';
import type { AuditLog } from '../services/audit-log.js';
import { registerPhase1Tools } from '../tools/phase1.js';
import { registerReportTools } from '../tools/reports/register.js';
import { registerReconciliationTools } from '../tools/reconciliation/register.js';
import { registerWebhookTools } from '../tools/webhooks/register.js';
import { registerDiagnosticTools } from '../tools/diagnostics/register.js';
import { registerSupportTools } from '../tools/support/register.js';
import { registerAuditTools } from '../tools/audit/register.js';
import { registerResources } from '../resources/register.js';
import { registerPrompts } from '../prompts/register.js';

export interface ServerDependencies {
  readonly config: AppConfig;
  readonly operations: MerchantOperations;
  readonly reconciliation: ReconciliationEngine;
  readonly webhooks: WebhookOperations;
  readonly diagnostics: DiagnosticsEngine;
  readonly support: SupportService;
  readonly audit: AuditLog;
}

export const createMcpServer = ({
  config,
  operations,
  reconciliation,
  webhooks,
  diagnostics,
  support,
  audit,
}: ServerDependencies): McpServer => {
  const server = new McpServer({
    name: 'sezzle-ops',
    version: '0.1.0',
  });
  registerPhase1Tools(server, operations, config);
  registerReportTools(server, operations, config);
  registerReconciliationTools(server, reconciliation, config);
  registerWebhookTools(server, webhooks, config);
  registerDiagnosticTools(server, diagnostics, config);
  registerSupportTools(server, support, config);
  registerAuditTools(server, audit, config);
  registerResources(server, config, audit, webhooks);
  registerPrompts(server, config);
  return server;
};
