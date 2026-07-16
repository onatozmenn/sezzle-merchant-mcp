import { createSezzleClient } from './api/sezzle-client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AppConfig } from './config/env.js';
import { ReconciliationEngine } from './domain/reconciliation.js';
import { createLogger, type Logger } from './logging/logger.js';
import { createMcpServer } from './server/create-server.js';
import { AuditLog } from './services/audit-log.js';
import { MerchantOperations } from './services/merchant-operations.js';
import { MutationGuard } from './services/mutation-guard.js';
import { EventStore } from './services/event-store.js';
import { WebhookOperations } from './services/webhook-operations.js';
import { WebhookVerifier } from './services/webhook-verifier.js';
import { DiagnosticsEngine } from './services/diagnostics-engine.js';
import { SupportPolicyEngine } from './services/support-policy-engine.js';
import { SupportService } from './services/support-service.js';
import { MemoryStore } from './storage/memory-store.js';
import { SqliteStore } from './storage/sqlite-store.js';
import type { Storage } from './storage/interface.js';

export interface Application {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly storage: Storage;
  readonly audit: AuditLog;
  readonly operations: MerchantOperations;
  readonly reconciliation: ReconciliationEngine;
  readonly webhooks: WebhookOperations;
  readonly diagnostics: DiagnosticsEngine;
  readonly support: SupportService;
  readonly server: ReturnType<typeof createMcpServer>;
  readonly createServer: () => McpServer;
}

export const createApplication = (config: AppConfig): Application => {
  const logger = createLogger(config);
  const storage: Storage =
    config.storage.kind === 'sqlite'
      ? new SqliteStore(config.storage.sqlitePath)
      : new MemoryStore();
  const audit = new AuditLog(storage);
  const client = createSezzleClient(config, logger);
  const mutations = new MutationGuard(storage, audit, config.preview.ttlSeconds);
  const operations = new MerchantOperations(config, client, mutations);
  const reconciliation = new ReconciliationEngine();
  const events = new EventStore(storage, new WebhookVerifier(config.sezzle.webhookSecret));
  const webhooks = new WebhookOperations(config, client, mutations, audit, events);
  const diagnostics = new DiagnosticsEngine();
  const support = new SupportService(
    client,
    new SupportPolicyEngine(),
    audit,
    config.sezzle.environment,
  );
  const createServer = () =>
    createMcpServer({
      config,
      operations,
      reconciliation,
      webhooks,
      diagnostics,
      support,
      audit,
    });
  const server = createServer();
  return {
    config,
    logger,
    storage,
    audit,
    operations,
    reconciliation,
    webhooks,
    diagnostics,
    support,
    server,
    createServer,
  };
};
