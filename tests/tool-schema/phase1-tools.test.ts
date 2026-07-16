import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type { SezzleClient } from '../../src/api/sezzle-client.js';
import { loadConfig, type AppConfig } from '../../src/config/env.js';
import { createMcpServer } from '../../src/server/create-server.js';
import { ReconciliationEngine } from '../../src/domain/reconciliation.js';
import { EventStore } from '../../src/services/event-store.js';
import { WebhookOperations } from '../../src/services/webhook-operations.js';
import { WebhookVerifier } from '../../src/services/webhook-verifier.js';
import { DiagnosticsEngine } from '../../src/services/diagnostics-engine.js';
import { SupportPolicyEngine } from '../../src/services/support-policy-engine.js';
import { SupportService } from '../../src/services/support-service.js';
import { AuditLog } from '../../src/services/audit-log.js';
import { MerchantOperations } from '../../src/services/merchant-operations.js';
import { MutationGuard } from '../../src/services/mutation-guard.js';
import { MemoryStore } from '../../src/storage/memory-store.js';

const openServers: McpServer[] = [];
const openClients: Client[] = [];

afterEach(async () => {
  await Promise.all(openClients.splice(0).map(async (client) => client.close()));
  await Promise.all(openServers.splice(0).map(async (server) => server.close()));
});

const fakeClient = (): SezzleClient => ({
  authenticateMerchant: vi.fn().mockResolvedValue({
    merchantUuid: 'merchant-1',
    expiresAt: '2026-07-16T15:00:00Z',
    requestId: 'request-auth',
  }),
  getMerchantContext: vi.fn().mockReturnValue({
    environment: 'sandbox',
    apiBaseUrl: 'https://sandbox.gateway.sezzle.com',
    configuredMerchantUuid: 'merchant-1',
    authenticatedMerchantUuid: 'merchant-1',
    tokenExpiresAt: '2026-07-16T15:00:00Z',
    readOnly: true,
    requireConfirmation: true,
    permissionProfile: 'read',
  }),
  createPaymentSession: vi.fn(),
  getPaymentSession: vi.fn(),
  cancelActiveCheckout: vi.fn(),
  getOrder: vi.fn(),
  updateOrderReference: vi.fn(),
  captureOrder: vi.fn(),
  refundOrder: vi.fn(),
  releaseAuthorization: vi.fn(),
  reauthorizeOrder: vi.fn(),
  listSettlementSummaries: vi.fn(),
  getSettlementDetails: vi.fn(),
  getOrderReport: vi.fn(),
  getInterestBalance: vi.fn(),
  getInterestActivity: vi.fn(),
  listWebhooks: vi.fn(),
  getWebhook: vi.fn(),
  createWebhook: vi.fn(),
  updateWebhook: vi.fn(),
  deleteWebhook: vi.fn(),
  sendTestWebhook: vi.fn(),
});

const connect = async (config: AppConfig) => {
  const storage = new MemoryStore();
  const now = () => new Date('2026-07-16T12:00:00Z');
  const operations = new MerchantOperations(
    config,
    fakeClient(),
    new MutationGuard(storage, new AuditLog(storage, now), config.preview.ttlSeconds, now),
    now,
  );
  const audit = new AuditLog(storage, now);
  const webhookOperations = new WebhookOperations(
    config,
    fakeClient(),
    new MutationGuard(storage, audit, config.preview.ttlSeconds, now),
    audit,
    new EventStore(storage, new WebhookVerifier(config.sezzle.webhookSecret), now),
  );
  const server = createMcpServer({
    config,
    operations,
    reconciliation: new ReconciliationEngine(),
    webhooks: webhookOperations,
    diagnostics: new DiagnosticsEngine(),
    support: new SupportService(
      fakeClient(),
      new SupportPolicyEngine(),
      audit,
      config.sezzle.environment,
    ),
    audit,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'sezzle-ops-test', version: '1.0.0' });
  await client.connect(clientTransport);
  openServers.push(server);
  openClients.push(client);
  return client;
};

describe('Phase 1 MCP tool registration', () => {
  it('registers only read tools for the default profile', async () => {
    const client = await connect(loadConfig({}));
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();

    expect(names).toEqual(
      expect.arrayContaining([
        'sezzle_authenticate_merchant',
        'sezzle_get_merchant_context',
        'sezzle_get_order',
        'sezzle_get_payment_session',
      ]),
    );
  });

  it('keeps execution tools absent in read-only finance mode', async () => {
    const client = await connect(loadConfig({ SEZZLE_PERMISSION_PROFILE: 'finance' }));
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();

    expect(names).toContain('sezzle_preview_capture');
    expect(names).toContain('sezzle_preview_refund');
    expect(names).toContain('sezzle_preview_release_authorization');
    expect(names).not.toContain('sezzle_capture_order');
    expect(names).not.toContain('sezzle_refund_order');
    expect(names).not.toContain('sezzle_create_payment_session');
  });

  it('registers all fourteen Phase 1 tools only in confirmed finance write mode', async () => {
    const client = await connect(
      loadConfig({
        SEZZLE_PERMISSION_PROFILE: 'finance',
        SEZZLE_READ_ONLY: 'false',
        SEZZLE_REQUIRE_CONFIRMATION: 'true',
      }),
    );
    const tools = (await client.listTools()).tools;

    const phase1Names = new Set([
      'sezzle_authenticate_merchant',
      'sezzle_get_merchant_context',
      'sezzle_create_payment_session',
      'sezzle_get_payment_session',
      'sezzle_cancel_active_checkout',
      'sezzle_get_order',
      'sezzle_update_order_reference',
      'sezzle_preview_capture',
      'sezzle_capture_order',
      'sezzle_preview_refund',
      'sezzle_refund_order',
      'sezzle_preview_release_authorization',
      'sezzle_release_authorization',
      'sezzle_reauthorize_order',
    ]);
    expect(tools.filter((tool) => phase1Names.has(tool.name))).toHaveLength(14);
    const capture = tools.find((tool) => tool.name === 'sezzle_capture_order');
    expect(capture?.inputSchema).toMatchObject({
      type: 'object',
      properties: { confirm: { const: true } },
    });
    expect(capture?.inputSchema.required).toContain('confirm');
    expect(capture?.inputSchema.required).toContain('preview_id');

    const financeWriteTools = tools
      .filter((tool) => tool.annotations?.readOnlyHint === false)
      .map((tool) => tool.name)
      .sort();
    expect(financeWriteTools).toEqual([
      'sezzle_cancel_active_checkout',
      'sezzle_capture_order',
      'sezzle_create_payment_session',
      'sezzle_reauthorize_order',
      'sezzle_refund_order',
      'sezzle_release_authorization',
      'sezzle_update_order_reference',
    ]);
    for (const tool of tools.filter((candidate) => financeWriteTools.includes(candidate.name))) {
      expect(tool.inputSchema.properties).toHaveProperty('confirm');
    }
  });

  it('rejects an execution call that omits confirm before reaching business logic', async () => {
    const client = await connect(
      loadConfig({
        SEZZLE_PERMISSION_PROFILE: 'finance',
        SEZZLE_READ_ONLY: 'false',
        SEZZLE_REQUIRE_CONFIRMATION: 'true',
      }),
    );

    const result = await client.callTool({
      name: 'sezzle_capture_order',
      arguments: {
        order_uuid: 'order-1',
        amount: { amount_in_cents: 500, currency: 'USD' },
        preview_id: 'preview-1',
      },
    });

    expect(result.isError).toBe(true);
  });

  it('returns the required reconciliation structure over MCP without API calls', async () => {
    const client = await connect(loadConfig({ SEZZLE_PERMISSION_PROFILE: 'finance' }));
    const result = CallToolResultSchema.parse(
      await client.callTool({
        name: 'sezzle_reconcile_settlement',
        arguments: {
          input: {
            currency: 'USD',
            merchant_orders: [],
            sezzle_records: [],
            actual_settlement: { amount_in_cents: 0, currency: 'USD' },
            fee_tolerance_in_cents: 0,
          },
        },
      }),
    );
    const content = result.content[0];
    if (content?.type !== 'text') throw new Error('Expected text tool result.');
    const parsed = z
      .looseObject({
        summary: z.looseObject({}),
        matched: z.array(z.unknown()),
        unmatchedMerchantRecords: z.array(z.unknown()),
        unmatchedSezzleRecords: z.array(z.unknown()),
        amountMismatches: z.array(z.unknown()),
        feeAnomalies: z.array(z.unknown()),
        confidence: z.number(),
        evidence: z.array(z.unknown()),
      })
      .parse(JSON.parse(content.text) as unknown);

    expect(parsed).toMatchObject({
      summary: {},
      matched: [],
      unmatchedMerchantRecords: [],
      unmatchedSezzleRecords: [],
      amountMismatches: [],
      feeAnomalies: [],
      confidence: 1,
    });
    expect(Array.isArray(parsed.evidence)).toBe(true);
  });

  it('filters webhook mutation tools from read-only mode before registration', async () => {
    const readOnly = await connect(loadConfig({ SEZZLE_PERMISSION_PROFILE: 'webhooks' }));
    const readOnlyNames = (await readOnly.listTools()).tools.map((tool) => tool.name);
    expect(readOnlyNames).toContain('sezzle_verify_webhook_signature');
    expect(readOnlyNames).toContain('sezzle_inspect_webhook_health');
    expect(readOnlyNames).not.toContain('sezzle_ingest_webhook_event');
    expect(readOnlyNames).not.toContain('sezzle_create_webhook');
  });

  it('registers all webhook operations only in explicit webhooks write mode', async () => {
    const writeClient = await connect(
      loadConfig({
        SEZZLE_PERMISSION_PROFILE: 'webhooks',
        SEZZLE_READ_ONLY: 'false',
        SEZZLE_REQUIRE_CONFIRMATION: 'true',
        SEZZLE_WEBHOOK_SECRET: 'test-secret',
      }),
    );
    const names = (await writeClient.listTools()).tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'sezzle_list_webhooks',
        'sezzle_create_webhook',
        'sezzle_update_webhook',
        'sezzle_delete_webhook',
        'sezzle_send_test_webhook',
        'sezzle_verify_webhook_signature',
        'sezzle_ingest_webhook_event',
        'sezzle_list_webhook_events',
        'sezzle_get_webhook_event',
        'sezzle_inspect_webhook_health',
        'sezzle_find_missing_order_events',
        'sezzle_detect_out_of_order_events',
        'sezzle_detect_duplicate_webhook_events',
      ]),
    );
  });

  it('registers all nine deterministic Integration Doctor tools in the read profile', async () => {
    const client = await connect(loadConfig({}));
    const names = (await client.listTools()).tools.map((tool) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'sezzle_diagnose_integration',
        'sezzle_validate_session_payload',
        'sezzle_validate_redirect_urls',
        'sezzle_audit_auth_capture_flow',
        'sezzle_detect_stuck_authorizations',
        'sezzle_detect_uncaptured_orders',
        'sezzle_detect_duplicate_refunds',
        'sezzle_test_webhook_configuration',
        'sezzle_generate_go_live_checklist',
      ]),
    );
  });

  it('isolates all five support tools in the support profile', async () => {
    const client = await connect(loadConfig({ SEZZLE_PERMISSION_PROFILE: 'support' }));
    const names = (await client.listTools()).tools.map((tool) => tool.name).sort();

    expect(names).toEqual([
      'sezzle_classify_support_request',
      'sezzle_determine_safe_support_route',
      'sezzle_draft_customer_response',
      'sezzle_explain_order_status_for_support',
      'sezzle_identify_required_escalation',
    ]);
    expect(names).not.toContain('sezzle_get_order');
  });

  it('exposes secret-free resources and profile-aware prompts', async () => {
    const client = await connect(loadConfig({ SEZZLE_API_SECRET: 'must-never-appear' }));
    const resources = await client.listResources();
    expect(resources.resources.map((resource) => resource.uri)).toEqual(
      expect.arrayContaining([
        'sezzle://config',
        'sezzle://permissions',
        'sezzle://capabilities',
        'sezzle://diagnostic-codes',
      ]),
    );
    const configResource = await client.readResource({ uri: 'sezzle://config' });
    expect(JSON.stringify(configResource)).not.toContain('must-never-appear');

    const prompts = await client.listPrompts();
    expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(
      expect.arrayContaining([
        'sezzle_daily_operations_review',
        'sezzle_integration_go_live_review',
      ]),
    );
  });

  it('registers audit inspection only for admin', async () => {
    const readClient = await connect(loadConfig({}));
    expect((await readClient.listTools()).tools.map((tool) => tool.name)).not.toContain(
      'sezzle_list_audit_events',
    );

    const adminClient = await connect(loadConfig({ SEZZLE_PERMISSION_PROFILE: 'admin' }));
    const names = (await adminClient.listTools()).tools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(['sezzle_list_audit_events', 'sezzle_get_audit_event']),
    );
    expect((await adminClient.listResources()).resources.map((resource) => resource.uri)).toContain(
      'sezzle://audit-summary',
    );
  });
});
