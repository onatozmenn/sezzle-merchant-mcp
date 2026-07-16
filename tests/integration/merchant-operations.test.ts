import { describe, expect, it, vi } from 'vitest';

import type { SezzleClient } from '../../src/api/sezzle-client.js';
import type { OrderSnapshot } from '../../src/api/schemas/phase1.js';
import { SezzleOpsError } from '../../src/api/errors.js';
import { loadConfig } from '../../src/config/env.js';
import { AuditLog } from '../../src/services/audit-log.js';
import { MerchantOperations } from '../../src/services/merchant-operations.js';
import { MutationGuard } from '../../src/services/mutation-guard.js';
import { MemoryStore } from '../../src/storage/memory-store.js';

const now = () => new Date('2026-07-16T12:00:00Z');
const order: OrderSnapshot = {
  uuid: 'order-1',
  intent: 'AUTH',
  checkout_status: 'complete',
  authorization: {
    authorization_amount: { amount_in_cents: 1_000, currency: 'USD' },
    approved: true,
    expiration: '2026-07-17T00:00:00Z',
    captures: [],
    refunds: [],
    releases: [],
  },
};

const createClient = () => {
  const captureOrder = vi.fn<SezzleClient['captureOrder']>().mockResolvedValue({
    data: { uuid: 'capture-1' },
    requestId: 'capture-request',
    httpStatus: 200,
  });
  const getOrder = vi
    .fn<SezzleClient['getOrder']>()
    .mockResolvedValue({ data: order, requestId: 'get-order', httpStatus: 200 });
  const reauthorizeOrder = vi.fn<SezzleClient['reauthorizeOrder']>();
  const client: SezzleClient = {
    authenticateMerchant: vi.fn().mockResolvedValue({
      merchantUuid: 'merchant-1',
      expiresAt: '2026-07-16T15:00:00Z',
      requestId: 'auth-request',
    }),
    getMerchantContext: vi.fn().mockReturnValue({
      environment: 'sandbox',
      apiBaseUrl: 'https://sandbox.gateway.sezzle.com',
      configuredMerchantUuid: 'merchant-1',
      authenticatedMerchantUuid: 'merchant-1',
      tokenExpiresAt: '2026-07-16T15:00:00Z',
      readOnly: false,
      requireConfirmation: true,
      permissionProfile: 'finance',
    }),
    createPaymentSession: vi.fn(),
    getPaymentSession: vi.fn(),
    cancelActiveCheckout: vi.fn(),
    getOrder,
    updateOrderReference: vi.fn(),
    captureOrder,
    refundOrder: vi.fn(),
    releaseAuthorization: vi.fn(),
    reauthorizeOrder,
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
  };
  return { client, captureOrder, getOrder, reauthorizeOrder };
};

const createOperations = (client: SezzleClient) => {
  const config = loadConfig({
    SEZZLE_READ_ONLY: 'false',
    SEZZLE_REQUIRE_CONFIRMATION: 'true',
    SEZZLE_PERMISSION_PROFILE: 'finance',
    SEZZLE_MERCHANT_UUID: 'merchant-1',
  });
  const storage = new MemoryStore();
  let id = 0;
  const idFactory = () => `id-${String((id += 1))}`;
  const audit = new AuditLog(storage, now, idFactory);
  const guard = new MutationGuard(storage, audit, 300, now, idFactory);
  return { operations: new MerchantOperations(config, client, guard, now), storage };
};

describe('Phase 1 merchant operation workflows', () => {
  it('previews and executes a capture only after explicit confirmation', async () => {
    const { client, captureOrder } = createClient();
    const { operations, storage } = createOperations(client);
    const amount = { amount_in_cents: 500, currency: 'USD' as const };
    const preview = await operations.previewCapture('order-1', amount);

    expect(preview.executed).toBe(false);
    expect(preview.validationResult.valid).toBe(true);
    await expect(
      operations.captureOrder({
        orderUuid: 'order-1',
        amount,
        previewId: preview.previewId,
        confirm: false,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    expect(captureOrder).not.toHaveBeenCalled();

    const executed = await operations.captureOrder({
      orderUuid: 'order-1',
      amount,
      previewId: preview.previewId,
      confirm: true,
    });

    expect(executed.executed).toBe(true);
    expect(executed.apiEvidence.evidenceId).toBe('capture-1');
    expect(captureOrder).toHaveBeenCalledOnce();
    expect(await storage.getAudit(executed.auditId)).toMatchObject({
      result: 'success',
      confirmed: true,
      evidenceId: 'capture-1',
    });
  });

  it('does not execute a capture above the authorization', async () => {
    const { client, captureOrder } = createClient();
    const { operations } = createOperations(client);
    const preview = await operations.previewCapture('order-1', {
      amount_in_cents: 1_001,
      currency: 'USD',
    });

    expect(preview.validationResult.code).toBe('CAPTURE_EXCEEDS_AUTHORIZED_AMOUNT');
    await expect(
      operations.captureOrder({
        orderUuid: 'order-1',
        amount: { amount_in_cents: 1_001, currency: 'USD' },
        previewId: preview.previewId,
        confirm: true,
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_EXCEEDS_AUTHORIZED_AMOUNT' });
    expect(captureOrder).not.toHaveBeenCalled();
  });

  it('audits upstream failure and never reports execution success', async () => {
    const { client, captureOrder } = createClient();
    captureOrder.mockRejectedValue(new Error('mock transport failure'));
    const { operations, storage } = createOperations(client);
    const amount = { amount_in_cents: 500, currency: 'USD' as const };
    const preview = await operations.previewCapture('order-1', amount);

    const error = await operations
      .captureOrder({
        orderUuid: 'order-1',
        amount,
        previewId: preview.previewId,
        confirm: true,
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: 'INTERNAL_ERROR' });
    const failureAudits = await storage.listAudits({ result: 'failure', limit: 10 });
    expect(failureAudits).toHaveLength(1);
  });

  it('does not expose a reauthorization order UUID when approval is denied', async () => {
    const { client, getOrder, reauthorizeOrder } = createClient();
    const authorization = order.authorization;
    if (authorization === undefined) throw new Error('Expected authorization fixture.');
    getOrder.mockResolvedValue({
      data: {
        ...order,
        authorization: {
          ...authorization,
          expiration: '2026-07-16T11:00:00Z',
        },
      },
      requestId: 'get-order',
      httpStatus: 200,
    });
    reauthorizeOrder.mockResolvedValue({
      data: {
        uuid: 'new-order-must-not-leak',
        intent: 'AUTH',
        order_amount: { amount_in_cents: 500, currency: 'USD' },
        authorization: {
          authorization_amount: { amount_in_cents: 500, currency: 'USD' },
          approved: false,
          expiration: '2026-07-17T12:00:00Z',
        },
      },
      requestId: 'reauthorize-request',
      httpStatus: 200,
    });
    const { operations, storage } = createOperations(client);
    const amount = { amount_in_cents: 500, currency: 'USD' as const };
    const preview = await operations.previewReauthorize('order-1', amount);

    const error = await operations
      .reauthorizeOrder({
        orderUuid: 'order-1',
        amount,
        previewId: preview.previewId,
        confirm: true,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(SezzleOpsError);
    if (!(error instanceof SezzleOpsError)) throw new Error('Expected normalized error.');
    expect(error.code).toBe('REAUTHORIZATION_NOT_APPROVED');
    expect(typeof error.details['auditId']).toBe('string');
    expect(JSON.stringify(error)).not.toContain('new-order-must-not-leak');
    expect(await storage.listAudits({ result: 'success', limit: 10 })).toHaveLength(0);
    expect(await storage.listAudits({ result: 'failure', limit: 10 })).toHaveLength(1);
  });
});
