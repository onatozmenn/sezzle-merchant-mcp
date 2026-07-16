import { describe, expect, it } from 'vitest';

import {
  DiagnosticsEngine,
  integrationDiagnosticSchema,
} from '../../src/services/diagnostics-engine.js';

const engine = new DiagnosticsEngine();

describe('DiagnosticsEngine', () => {
  it('emits stable findings for invalid redirects and session currency', () => {
    const findings = engine.diagnoseIntegration(
      integrationDiagnosticSchema.parse({
        now: '2026-07-16T12:00:00Z',
        configured_environment: 'sandbox',
        credential_environment: 'sandbox',
        api_base_url: 'https://sandbox.gateway.sezzle.com',
        session_payload: {
          cancel_url: { href: 'http://unsafe.example/cart', method: 'GET' },
          complete_url: { href: 'https://merchant.example/complete', method: 'GET' },
          order: {
            intent: 'AUTH',
            reference_id: 'order_1',
            description: 'Order',
            order_amount: { amount_in_cents: 100, currency: 'USD' },
            tax_amount: { amount_in_cents: 10, currency: 'CAD' },
          },
        },
        redirects: {
          cancel_url: 'http://unsafe.example/cart',
          complete_url: 'https://other.example/complete',
          allowed_hosts: ['merchant.example'],
        },
      }),
    );

    expect(findings.map((item) => item.code)).toEqual(
      expect.arrayContaining(['CURRENCY_INCONSISTENCY', 'INVALID_REDIRECT_URL']),
    );
    expect(new Set(findings.map((item) => item.safeToAutomate))).toEqual(new Set([false]));
  });

  it('detects uncaptured, stuck, refund, duplicate-reference, and duplicate-refund states', () => {
    const findings = engine.diagnoseIntegration(
      integrationDiagnosticSchema.parse({
        now: '2026-07-16T12:00:00Z',
        configured_environment: 'sandbox',
        credential_environment: 'sandbox',
        api_base_url: 'https://sandbox.gateway.sezzle.com',
        orders: [
          {
            order_uuid: 'order-1',
            reference_id: 'duplicate-ref',
            currency: 'USD',
            authorized_amount_in_cents: 1_000,
            captured_amount_in_cents: 0,
            refunded_amount_in_cents: 100,
            authorization_approved: true,
            authorization_expires_at: '2026-07-16T13:00:00Z',
            updated_at: '2026-07-16T09:00:00Z',
            refund_attempts: [
              { refund_id: 'refund-1', amount_in_cents: 100 },
              { refund_id: 'refund-1', amount_in_cents: 100 },
            ],
          },
          {
            order_uuid: 'order-2',
            reference_id: 'duplicate-ref',
            currency: 'USD',
            authorized_amount_in_cents: 500,
            captured_amount_in_cents: 500,
            refunded_amount_in_cents: 0,
            authorization_approved: true,
          },
        ],
      }),
    );

    expect(findings.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'UNCAPTURED_AUTHORIZATION',
        'STUCK_AUTHORIZATION',
        'REFUND_BEFORE_CAPTURE',
        'DUPLICATE_ORDER_REFERENCE',
        'DUPLICATE_REFUND',
      ]),
    );
  });

  it('detects webhook and environment health problems', () => {
    const findings = engine.diagnoseIntegration(
      integrationDiagnosticSchema.parse({
        now: '2026-07-16T12:00:00Z',
        configured_environment: 'production',
        credential_environment: 'sandbox',
        api_base_url: 'https://sandbox.gateway.sezzle.com',
        authentication_expires_at: '2026-07-16T11:00:00Z',
        webhooks: {
          subscribed_events: ['order.authorized'],
          required_events: ['order.authorized', 'order.captured'],
          invalid_signature_count: 2,
          missing_events: [{ order_uuid: 'order-1', event: 'order.captured' }],
          out_of_order_count: 1,
        },
      }),
    );

    expect(findings.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        'ENVIRONMENT_CREDENTIAL_MISMATCH',
        'AUTHENTICATION_EXPIRED',
        'MISSING_WEBHOOK_SUBSCRIPTION',
        'INVALID_WEBHOOK_SIGNATURE',
        'MISSING_WEBHOOK_EVENT',
        'OUT_OF_ORDER_WEBHOOK_EVENT',
      ]),
    );
    expect(
      engine.generateGoLiveChecklist(
        integrationDiagnosticSchema.parse({
          now: '2026-07-16T12:00:00Z',
          configured_environment: 'production',
          credential_environment: 'sandbox',
          api_base_url: 'https://sandbox.gateway.sezzle.com',
        }),
      ).readyForProduction,
    ).toBe(false);
  });
});
