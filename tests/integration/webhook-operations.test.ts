import { describe, expect, it, vi } from 'vitest';

import type { SezzleClient } from '../../src/api/sezzle-client.js';
import { loadConfig } from '../../src/config/env.js';
import { AuditLog } from '../../src/services/audit-log.js';
import { EventStore } from '../../src/services/event-store.js';
import { MutationGuard } from '../../src/services/mutation-guard.js';
import { WebhookOperations } from '../../src/services/webhook-operations.js';
import { WebhookVerifier } from '../../src/services/webhook-verifier.js';
import { MemoryStore } from '../../src/storage/memory-store.js';

const now = () => new Date('2026-07-16T12:00:00Z');

const createHarness = () => {
  const createWebhook = vi.fn<SezzleClient['createWebhook']>().mockResolvedValue({
    data: {
      uuid: 'webhook-1',
      url: 'https://merchant.example/hooks',
      events: ['order.captured'],
    },
    requestId: 'request-create',
    httpStatus: 200,
  });
  const listWebhooks = vi.fn<SezzleClient['listWebhooks']>().mockResolvedValue({
    data: [],
    requestId: 'request-list',
    httpStatus: 200,
  });
  const client: SezzleClient = {
    authenticateMerchant: vi.fn().mockResolvedValue({
      merchantUuid: 'merchant-1',
      expiresAt: '2026-07-16T15:00:00Z',
      requestId: 'request-auth',
    }),
    getMerchantContext: vi.fn(),
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
    listWebhooks,
    getWebhook: vi.fn(),
    createWebhook,
    updateWebhook: vi.fn(),
    deleteWebhook: vi.fn(),
    sendTestWebhook: vi.fn(),
  };
  const config = loadConfig({
    SEZZLE_PERMISSION_PROFILE: 'webhooks',
    SEZZLE_READ_ONLY: 'false',
    SEZZLE_REQUIRE_CONFIRMATION: 'true',
    SEZZLE_MERCHANT_UUID: 'merchant-1',
    SEZZLE_WEBHOOK_SECRET: 'webhook-secret',
  });
  const storage = new MemoryStore();
  let id = 0;
  const idFactory = () => `id-${String((id += 1))}`;
  const audit = new AuditLog(storage, now, idFactory);
  const mutations = new MutationGuard(storage, audit, 300, now, idFactory);
  const events = new EventStore(storage, new WebhookVerifier(config.sezzle.webhookSecret), now);
  return {
    operations: new WebhookOperations(config, client, mutations, audit, events),
    createWebhook,
    listWebhooks,
    storage,
  };
};

describe('guarded webhook operations', () => {
  it('previews and creates a webhook only after explicit confirmation', async () => {
    const { operations, createWebhook, storage } = createHarness();
    const request = {
      url: 'https://merchant.example/hooks',
      events: ['order.captured' as const],
    };
    const preview = await operations.previewCreateWebhook(request);

    await expect(
      operations.createWebhook({ request, previewId: preview.previewId, confirm: false }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(createWebhook).not.toHaveBeenCalled();

    const result = await operations.createWebhook({
      request,
      previewId: preview.previewId,
      confirm: true,
    });
    expect(result.apiEvidence.evidenceId).toBe('webhook-1');
    expect(createWebhook).toHaveBeenCalledOnce();
    expect(await storage.getAudit(result.auditId)).toMatchObject({ result: 'success' });
  });

  it('rejects duplicate webhook URLs during preview and execution', async () => {
    const { operations, createWebhook, listWebhooks } = createHarness();
    const request = {
      url: 'https://merchant.example/hooks',
      events: ['order.captured' as const],
    };
    listWebhooks.mockResolvedValue({
      data: [{ uuid: 'existing', url: request.url, events: request.events }],
      requestId: 'request-list',
      httpStatus: 200,
    });
    const preview = await operations.previewCreateWebhook(request);

    expect(preview.validationResult.code).toBe('WEBHOOK_URL_ALREADY_EXISTS');
    await expect(
      operations.createWebhook({ request, previewId: preview.previewId, confirm: true }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_URL_ALREADY_EXISTS' });
    expect(createWebhook).not.toHaveBeenCalled();
  });
});
