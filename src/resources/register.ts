import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AppConfig } from '../config/env.js';
import { getGrantedCapabilities, profileHasCapability } from '../config/permissions.js';
import { diagnosticCodeSchema } from '../domain/risk.js';
import type { AuditLog } from '../services/audit-log.js';
import type { WebhookOperations } from '../services/webhook-operations.js';

const jsonContents = (uri: URL, value: unknown) => ({
  contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
});

export const registerResources = (
  server: McpServer,
  config: AppConfig,
  audit: AuditLog,
  webhooks: WebhookOperations,
): void => {
  server.registerResource(
    'sezzle-config',
    'sezzle://config',
    {
      title: 'SezzleOps Configuration',
      description: 'Secret-free runtime safety configuration.',
      mimeType: 'application/json',
    },
    (uri) =>
      Promise.resolve(
        jsonContents(uri, {
          serverName: 'sezzle-ops',
          unofficial: true,
          environment: config.sezzle.environment,
          apiBaseUrl: config.sezzle.apiBaseUrl.origin,
          merchantConfigured: config.sezzle.merchantUuid !== undefined,
          credentialsConfigured:
            config.sezzle.apiKey !== undefined && config.sezzle.apiSecret !== undefined,
          webhookSecretConfigured: config.sezzle.webhookSecret !== undefined,
          readOnly: config.sezzle.readOnly,
          requireConfirmation: config.sezzle.requireConfirmation,
          transport: config.mcp.transport,
          storage: config.storage.kind,
        }),
      ),
  );

  server.registerResource(
    'sezzle-permissions',
    'sezzle://permissions',
    { title: 'SezzleOps Permissions', mimeType: 'application/json' },
    (uri) =>
      Promise.resolve(
        jsonContents(uri, {
          profile: config.sezzle.permissionProfile,
          capabilities: getGrantedCapabilities(config.sezzle.permissionProfile),
          mutationToolsRegistered: !config.sezzle.readOnly,
        }),
      ),
  );

  server.registerResource(
    'sezzle-capabilities',
    'sezzle://capabilities',
    { title: 'SezzleOps Capabilities', mimeType: 'application/json' },
    (uri) =>
      Promise.resolve(
        jsonContents(uri, {
          safeMutationPreviews: true,
          explicitConfirmation: true,
          deterministicMoney: true,
          settlementReconciliation: profileHasCapability(
            config.sezzle.permissionProfile,
            'finance',
          ),
          webhookOperations: profileHasCapability(config.sezzle.permissionProfile, 'webhooks'),
          integrationDoctor: profileHasCapability(config.sezzle.permissionProfile, 'read'),
          supportIntelligence: profileHasCapability(config.sezzle.permissionProfile, 'support'),
          auditInspection: profileHasCapability(config.sezzle.permissionProfile, 'admin'),
        }),
      ),
  );

  server.registerResource(
    'sezzle-diagnostic-codes',
    'sezzle://diagnostic-codes',
    { title: 'SezzleOps Diagnostic Codes', mimeType: 'application/json' },
    (uri) => Promise.resolve(jsonContents(uri, { codes: diagnosticCodeSchema.options })),
  );

  if (profileHasCapability(config.sezzle.permissionProfile, 'admin')) {
    server.registerResource(
      'sezzle-audit-summary',
      'sezzle://audit-summary',
      { title: 'SezzleOps Audit Summary', mimeType: 'application/json' },
      async (uri) => {
        const events = await audit.list({ limit: 10_000 });
        return jsonContents(uri, {
          total: events.length,
          previews: events.filter((event) => event.result === 'preview').length,
          successes: events.filter((event) => event.result === 'success').length,
          failures: events.filter((event) => event.result === 'failure').length,
          rejections: events.filter((event) => event.result === 'rejected').length,
          latestTimestamp: events[0]?.timestamp,
        });
      },
    );
  }

  if (profileHasCapability(config.sezzle.permissionProfile, 'webhooks')) {
    server.registerResource(
      'sezzle-webhook-health',
      'sezzle://webhook-health',
      { title: 'SezzleOps Webhook Health', mimeType: 'application/json' },
      async (uri) => jsonContents(uri, await webhooks.inspectHealth()),
    );
  }
};
