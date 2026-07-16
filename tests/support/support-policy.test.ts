import { describe, expect, it, vi } from 'vitest';

import type { SezzleClient } from '../../src/api/sezzle-client.js';
import {
  SupportPolicyEngine,
  supportRequestSchema,
} from '../../src/services/support-policy-engine.js';
import { SupportService } from '../../src/services/support-service.js';
import { AuditLog } from '../../src/services/audit-log.js';
import { MemoryStore } from '../../src/storage/memory-store.js';

const createClient = (referenceId = 'merchant-order-1'): SezzleClient => ({
  authenticateMerchant: vi.fn().mockResolvedValue({
    merchantUuid: 'merchant-1',
    expiresAt: '2026-07-16T15:00:00Z',
    requestId: 'request-auth',
  }),
  getMerchantContext: vi.fn(),
  createPaymentSession: vi.fn(),
  getPaymentSession: vi.fn(),
  cancelActiveCheckout: vi.fn(),
  getOrder: vi.fn().mockResolvedValue({
    data: {
      uuid: 'order-1',
      reference_id: referenceId,
      checkout_status: 'complete',
      authorization: {
        authorization_amount: { amount_in_cents: 1_000, currency: 'USD' },
        approved: true,
        expiration: '2026-07-17T00:00:00Z',
        captures: [],
        refunds: [],
        releases: [],
      },
    },
    requestId: 'request-order',
    httpStatus: 200,
  }),
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

describe('secure support policy', () => {
  it('rejects order exposure when merchant reference ownership does not match', async () => {
    const storage = new MemoryStore();
    const service = new SupportService(
      createClient('different-reference'),
      new SupportPolicyEngine(),
      new AuditLog(
        storage,
        () => new Date('2026-07-16T12:00:00Z'),
        () => 'audit-1',
      ),
      'sandbox',
    );

    await expect(service.explainOrderStatus('order-1', 'merchant-order-1')).rejects.toMatchObject({
      code: 'ORDER_OWNERSHIP_NOT_VERIFIED',
      details: { auditId: 'audit-1' },
    });
    expect(await storage.getAudit('audit-1')).toMatchObject({
      result: 'rejected',
      errorCode: 'ORDER_OWNERSHIP_NOT_VERIFIED',
      targetId: 'order-1',
    });
  });

  it('returns only minimal verified order facts and never claims an action', async () => {
    const storage = new MemoryStore();
    const service = new SupportService(
      createClient(),
      new SupportPolicyEngine(),
      new AuditLog(storage),
      'sandbox',
    );
    const response = await service.explainOrderStatus('order-1', 'merchant-order-1');

    expect(response.facts.join(' ')).not.toContain('email');
    expect(response.facts.join(' ')).not.toContain('phone');
    expect(response.draftResponse).toContain('No payment action was performed');
  });

  it('aggregates support-facing financial facts with bigint', () => {
    const response = new SupportPolicyEngine().explainOrderStatus({
      uuid: 'order-large',
      reference_id: 'merchant-order-large',
      checkout_status: 'complete',
      authorization: {
        authorization_amount: {
          amount_in_cents: Number.MAX_SAFE_INTEGER,
          currency: 'USD',
        },
        approved: true,
        expiration: '2026-07-17T00:00:00Z',
        captures: [
          {
            amount: { amount_in_cents: Number.MAX_SAFE_INTEGER, currency: 'USD' },
          },
          { amount: { amount_in_cents: 1, currency: 'USD' } },
        ],
        refunds: [],
        releases: [],
      },
    });

    expect(response.facts).toContain('Captured amount in cents: 9007199254740992.');
  });

  it('does not claim a refund succeeded without confirmed API evidence', () => {
    const policy = new SupportPolicyEngine();
    const request = supportRequestSchema.parse({ message: 'Where is my refund?' });
    const response = policy.draftCustomerResponse(
      request,
      ['Refund was requested by the customer.'],
      [{ action: 'refund', status: 'unknown' }],
    );

    expect(response.draftResponse).toContain('No refund');
    expect(response.draftResponse).not.toContain('refund was confirmed');
  });

  it('never invents decline or spending-limit reasons', () => {
    const policy = new SupportPolicyEngine();
    const request = supportRequestSchema.parse({ message: 'Why was I declined?' });
    const response = policy.draftCustomerResponse(request, [], []);

    expect(response.classification).toBe('decline_or_approval');
    expect(response.draftResponse).toContain('cannot provide or infer');
    expect(response.requiresHuman).toBe(true);
  });

  it('keeps classification, routing, and escalation as distinct operations', () => {
    const storage = new MemoryStore();
    const service = new SupportService(
      createClient(),
      new SupportPolicyEngine(),
      new AuditLog(storage),
      'sandbox',
    );
    const request = supportRequestSchema.parse({ message: 'I need a refund' });

    expect(service.classify(request)).toEqual({ classification: 'refund_request' });
    expect(service.determineSafeRoute(request)).toMatchObject({
      classification: 'refund_request',
      requiresHuman: true,
      allowedActions: ['gather_refund_reason', 'preview_refund', 'escalate'],
    });
    expect(service.identifyRequiredEscalation(request)).toMatchObject({
      classification: 'refund_request',
      requiresHuman: true,
      allowedActions: ['escalate'],
    });
  });
});
