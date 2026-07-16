import { z } from 'zod';

import { createSessionRequestSchema } from '../api/schemas/requests.js';
import { currencySchema } from '../domain/money.js';
import type { DiagnosticCode, DiagnosticFinding, FindingSeverity } from '../domain/risk.js';
import { webhookEventTypeSchema } from '../domain/webhook.js';

const refundAttemptSchema = z
  .object({
    refund_id: z.string().trim().min(1).max(255),
    amount_in_cents: z.number().int().positive(),
    occurred_at: z.iso.datetime({ offset: true }).optional(),
  })
  .strict()
  .transform((refund) => ({
    refundId: refund.refund_id,
    amountInCents: refund.amount_in_cents,
    ...(refund.occurred_at === undefined ? {} : { occurredAt: refund.occurred_at }),
  }));

export const diagnosticOrderSchema = z
  .object({
    order_uuid: z.string().trim().min(1).max(255),
    reference_id: z.string().trim().min(1).max(255).optional(),
    merchant_reference_id: z.string().trim().min(1).max(255).optional(),
    currency: currencySchema,
    merchant_currency: currencySchema.optional(),
    authorized_amount_in_cents: z.number().int().nonnegative(),
    captured_amount_in_cents: z.number().int().nonnegative(),
    refunded_amount_in_cents: z.number().int().nonnegative(),
    authorization_approved: z.boolean(),
    authorization_expires_at: z.iso.datetime({ offset: true }).optional(),
    checkout_status: z.enum(['active', 'complete', 'denied', 'deleted']).optional(),
    checkout_expires_at: z.iso.datetime({ offset: true }).optional(),
    updated_at: z.iso.datetime({ offset: true }).optional(),
    refund_attempts: z.array(refundAttemptSchema).max(10_000).default([]),
  })
  .strict()
  .transform((order) => ({
    orderUuid: order.order_uuid,
    ...(order.reference_id === undefined ? {} : { referenceId: order.reference_id }),
    ...(order.merchant_reference_id === undefined
      ? {}
      : { merchantReferenceId: order.merchant_reference_id }),
    currency: order.currency,
    ...(order.merchant_currency === undefined ? {} : { merchantCurrency: order.merchant_currency }),
    authorizedAmountInCents: order.authorized_amount_in_cents,
    capturedAmountInCents: order.captured_amount_in_cents,
    refundedAmountInCents: order.refunded_amount_in_cents,
    authorizationApproved: order.authorization_approved,
    ...(order.authorization_expires_at === undefined
      ? {}
      : { authorizationExpiresAt: order.authorization_expires_at }),
    ...(order.checkout_status === undefined ? {} : { checkoutStatus: order.checkout_status }),
    ...(order.checkout_expires_at === undefined
      ? {}
      : { checkoutExpiresAt: order.checkout_expires_at }),
    ...(order.updated_at === undefined ? {} : { updatedAt: order.updated_at }),
    refundAttempts: order.refund_attempts,
  }));

export type DiagnosticOrder = z.infer<typeof diagnosticOrderSchema>;

export const redirectDiagnosticSchema = z
  .object({
    cancel_url: z.string().optional(),
    complete_url: z.string().optional(),
    allowed_hosts: z.array(z.string().trim().min(1)).max(100).default([]),
  })
  .strict()
  .transform((redirects) => ({
    ...(redirects.cancel_url === undefined ? {} : { cancelUrl: redirects.cancel_url }),
    ...(redirects.complete_url === undefined ? {} : { completeUrl: redirects.complete_url }),
    allowedHosts: redirects.allowed_hosts,
  }));

export type RedirectDiagnosticInput = z.infer<typeof redirectDiagnosticSchema>;

export const webhookDiagnosticSchema = z
  .object({
    subscribed_events: z.array(webhookEventTypeSchema).max(100).default([]),
    required_events: z.array(webhookEventTypeSchema).max(100).default([]),
    invalid_signature_count: z.number().int().nonnegative().default(0),
    missing_events: z
      .array(
        z
          .object({
            order_uuid: z.string().trim().min(1),
            event: webhookEventTypeSchema,
          })
          .strict(),
      )
      .max(10_000)
      .default([]),
    out_of_order_count: z.number().int().nonnegative().default(0),
  })
  .strict()
  .transform((webhooks) => ({
    subscribedEvents: webhooks.subscribed_events,
    requiredEvents: webhooks.required_events,
    invalidSignatureCount: webhooks.invalid_signature_count,
    missingEvents: webhooks.missing_events.map((item) => ({
      orderUuid: item.order_uuid,
      event: item.event,
    })),
    outOfOrderCount: webhooks.out_of_order_count,
  }));

export type WebhookDiagnosticInput = z.infer<typeof webhookDiagnosticSchema>;

export const integrationDiagnosticSchema = z
  .object({
    now: z.iso.datetime({ offset: true }),
    configured_environment: z.enum(['sandbox', 'production']),
    credential_environment: z.enum(['sandbox', 'production', 'unknown']).default('unknown'),
    api_base_url: z.url(),
    authentication_expires_at: z.iso.datetime({ offset: true }).optional(),
    session_payload: z.unknown().optional(),
    redirects: redirectDiagnosticSchema.optional(),
    orders: z.array(diagnosticOrderSchema).max(25_000).default([]),
    webhooks: webhookDiagnosticSchema.optional(),
    merchant_record_mismatch_count: z.number().int().nonnegative().default(0),
    stuck_threshold_minutes: z.number().int().positive().max(43_200).default(60),
  })
  .strict()
  .transform((input) => ({
    now: input.now,
    configuredEnvironment: input.configured_environment,
    credentialEnvironment: input.credential_environment,
    apiBaseUrl: input.api_base_url,
    ...(input.authentication_expires_at === undefined
      ? {}
      : { authenticationExpiresAt: input.authentication_expires_at }),
    ...(input.session_payload === undefined ? {} : { sessionPayload: input.session_payload }),
    ...(input.redirects === undefined ? {} : { redirects: input.redirects }),
    orders: input.orders,
    ...(input.webhooks === undefined ? {} : { webhooks: input.webhooks }),
    merchantRecordMismatchCount: input.merchant_record_mismatch_count,
    stuckThresholdMinutes: input.stuck_threshold_minutes,
  }));

export type IntegrationDiagnosticInput = z.infer<typeof integrationDiagnosticSchema>;

const finding = (
  code: DiagnosticCode,
  severity: FindingSeverity,
  title: string,
  explanation: string,
  evidence: readonly string[],
  recommendedAction: string,
): DiagnosticFinding => ({
  code,
  severity,
  title,
  explanation,
  evidence,
  recommendedAction,
  safeToAutomate: false,
});

const validUrl = (value: string, allowedHosts: readonly string[]): boolean => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      return false;
    }
    return allowedHosts.length === 0 || allowedHosts.includes(url.hostname);
  } catch {
    return false;
  }
};

export class DiagnosticsEngine {
  public validateSessionPayload(payload: unknown): readonly DiagnosticFinding[] {
    const result = createSessionRequestSchema.safeParse(payload);
    if (result.success) return [];
    const findings: DiagnosticFinding[] = [];
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      if (path.endsWith('reference_id')) {
        findings.push(
          finding(
            'MISSING_ORDER_REFERENCE',
            'high',
            'Order reference is missing or invalid',
            issue.message,
            [path],
            'Provide a stable merchant reference containing only letters, numbers, dashes, or underscores.',
          ),
        );
      } else if (issue.message.startsWith('All order money must use')) {
        findings.push(
          finding(
            'CURRENCY_INCONSISTENCY',
            'high',
            'Session currencies are inconsistent',
            issue.message,
            [path],
            'Use the order currency for every item, discount, tax, and shipping amount.',
          ),
        );
      } else if (path.startsWith('cancel_url') || path.startsWith('complete_url')) {
        findings.push(
          finding(
            path.endsWith('href') ? 'INVALID_REDIRECT_URL' : 'MISSING_REDIRECT_URL',
            'high',
            'Redirect URL is missing or invalid',
            issue.message,
            [path],
            'Provide explicit HTTPS cancel and complete URLs.',
          ),
        );
      }
    }
    return [
      ...new Map(
        findings.map((item) => [`${item.code}:${item.evidence.join(',')}`, item]),
      ).values(),
    ];
  }

  public validateRedirectUrls(input: RedirectDiagnosticInput): readonly DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = [];
    for (const [label, value] of [
      ['cancel_url', input.cancelUrl],
      ['complete_url', input.completeUrl],
    ] as const) {
      if (value === undefined || value.trim() === '') {
        findings.push(
          finding(
            'MISSING_REDIRECT_URL',
            'high',
            `${label} is missing`,
            'Checkout cannot safely return the shopper without both redirect URLs.',
            [label],
            'Configure an explicit HTTPS URL controlled by the merchant.',
          ),
        );
      } else if (!validUrl(value, input.allowedHosts)) {
        findings.push(
          finding(
            'INVALID_REDIRECT_URL',
            'high',
            `${label} is invalid`,
            'The redirect is not HTTPS or does not match an allowed merchant host.',
            [`${label}=${value}`],
            'Use an HTTPS URL on an explicitly allowed merchant host.',
          ),
        );
      }
    }
    return findings;
  }

  public auditAuthCaptureFlow(
    orders: readonly DiagnosticOrder[],
    now: string,
  ): readonly DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = [];
    const references = new Map<string, string[]>();
    for (const order of orders) {
      if (order.referenceId === undefined) {
        findings.push(
          finding(
            'MISSING_ORDER_REFERENCE',
            'high',
            'Order reference is missing',
            'The order cannot be reliably correlated with the merchant system.',
            [`order=${order.orderUuid}`],
            'Set a stable merchant order reference.',
          ),
        );
      } else {
        const ids = references.get(order.referenceId) ?? [];
        ids.push(order.orderUuid);
        references.set(order.referenceId, ids);
      }
      if (order.merchantCurrency !== undefined && order.currency !== order.merchantCurrency) {
        findings.push(
          finding(
            'CURRENCY_INCONSISTENCY',
            'high',
            'Merchant and Sezzle order currencies differ',
            'Financial amounts cannot be compared without an explicit conversion.',
            [
              `order=${order.orderUuid}`,
              `sezzle=${order.currency}`,
              `merchant=${order.merchantCurrency}`,
            ],
            'Correct the merchant record or reconcile using documented conversion values.',
          ),
        );
      }
      if (order.refundedAmountInCents > order.capturedAmountInCents) {
        findings.push(
          finding(
            order.capturedAmountInCents === 0
              ? 'REFUND_BEFORE_CAPTURE'
              : 'REFUND_EXCEEDS_REFUNDABLE_AMOUNT',
            'critical',
            'Refund state is invalid',
            'Recorded refunds exceed the captured amount.',
            [
              `order=${order.orderUuid}`,
              `captured=${String(order.capturedAmountInCents)}`,
              `refunded=${String(order.refundedAmountInCents)}`,
            ],
            'Stop automated refunds and reconcile the order with Sezzle API evidence.',
          ),
        );
      }
    }
    for (const [reference, orderIds] of references) {
      if (orderIds.length > 1) {
        findings.push(
          finding(
            'DUPLICATE_ORDER_REFERENCE',
            'high',
            'Merchant reference is used by multiple orders',
            'Duplicate references make correlation and reconciliation ambiguous.',
            [`reference=${reference}`, ...orderIds.map((id) => `order=${id}`)],
            'Assign a unique merchant reference to each order.',
          ),
        );
      }
    }
    return [...findings, ...this.detectUncapturedOrders(orders, now)];
  }

  public detectStuckAuthorizations(
    orders: readonly DiagnosticOrder[],
    now: string,
    thresholdMinutes: number,
  ): readonly DiagnosticFinding[] {
    const nowMs = Date.parse(now);
    const thresholdMs = thresholdMinutes * 60 * 1_000;
    return orders.flatMap((order) => {
      if (
        !order.authorizationApproved ||
        order.capturedAmountInCents >= order.authorizedAmountInCents ||
        order.updatedAt === undefined ||
        nowMs - Date.parse(order.updatedAt) < thresholdMs
      ) {
        return [];
      }
      return [
        finding(
          'STUCK_AUTHORIZATION',
          'high',
          'Authorization has remained uncaptured',
          'The approved order has not progressed within the configured threshold.',
          [`order=${order.orderUuid}`, `updated_at=${order.updatedAt}`],
          'Verify fulfillment state and either preview a capture or release before expiration.',
        ),
      ];
    });
  }

  public detectUncapturedOrders(
    orders: readonly DiagnosticOrder[],
    now: string,
  ): readonly DiagnosticFinding[] {
    const nowMs = Date.parse(now);
    return orders.flatMap((order) => {
      if (
        !order.authorizationApproved ||
        order.capturedAmountInCents >= order.authorizedAmountInCents
      ) {
        return [];
      }
      const expiresAt = order.authorizationExpiresAt;
      return [
        finding(
          'UNCAPTURED_AUTHORIZATION',
          expiresAt !== undefined && Date.parse(expiresAt) <= nowMs ? 'critical' : 'high',
          'Order is authorized but not fully captured',
          'Captured amount is below the approved authorization.',
          [
            `order=${order.orderUuid}`,
            `authorized=${String(order.authorizedAmountInCents)}`,
            `captured=${String(order.capturedAmountInCents)}`,
            ...(expiresAt === undefined ? [] : [`expires_at=${expiresAt}`]),
          ],
          'Confirm fulfillment and preview a capture or release; do not execute automatically.',
        ),
      ];
    });
  }

  public detectDuplicateRefunds(orders: readonly DiagnosticOrder[]): readonly DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = [];
    for (const order of orders) {
      const seenIds = new Set<string>();
      const seenFingerprints = new Set<string>();
      for (const refund of order.refundAttempts) {
        const fingerprint = `${String(refund.amountInCents)}:${refund.occurredAt ?? ''}`;
        if (seenIds.has(refund.refundId) || seenFingerprints.has(fingerprint)) {
          findings.push(
            finding(
              'DUPLICATE_REFUND',
              'critical',
              'Duplicate refund attempt detected',
              'A refund ID or deterministic amount/time fingerprint was repeated.',
              [
                `order=${order.orderUuid}`,
                `refund=${refund.refundId}`,
                `amount=${String(refund.amountInCents)}`,
              ],
              'Block further refund execution and verify API evidence and idempotency records.',
            ),
          );
        }
        seenIds.add(refund.refundId);
        seenFingerprints.add(fingerprint);
      }
    }
    return findings;
  }

  public testWebhookConfiguration(input: WebhookDiagnosticInput): readonly DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = [];
    const subscribed = new Set(input.subscribedEvents);
    for (const required of input.requiredEvents) {
      if (!subscribed.has(required)) {
        findings.push(
          finding(
            'MISSING_WEBHOOK_SUBSCRIPTION',
            'high',
            'Required webhook subscription is missing',
            `The integration is not subscribed to ${required}.`,
            [`event=${required}`],
            'Preview an updated webhook event set that includes the required event.',
          ),
        );
      }
    }
    if (input.invalidSignatureCount > 0) {
      findings.push(
        finding(
          'INVALID_WEBHOOK_SIGNATURE',
          'critical',
          'Invalid webhook signatures were observed',
          'At least one delivery failed HMAC-SHA256 verification.',
          [`count=${String(input.invalidSignatureCount)}`],
          'Reject invalid deliveries and verify the raw-body handling and merchant private key.',
        ),
      );
    }
    for (const missing of input.missingEvents) {
      findings.push(
        finding(
          'MISSING_WEBHOOK_EVENT',
          'high',
          'Expected order webhook event is missing',
          `${missing.event} was not observed for the order.`,
          [`order=${missing.orderUuid}`, `event=${missing.event}`],
          'Query the order state and inspect subscription/retry health before taking action.',
        ),
      );
    }
    if (input.outOfOrderCount > 0) {
      findings.push(
        finding(
          'OUT_OF_ORDER_WEBHOOK_EVENT',
          'medium',
          'Webhook events arrived out of order',
          'Event timelines must use occurrence time rather than receipt order.',
          [`count=${String(input.outOfOrderCount)}`],
          'Rebuild affected timelines from immutable events without overwriting newer state.',
        ),
      );
    }
    return findings;
  }

  public diagnoseIntegration(input: IntegrationDiagnosticInput): readonly DiagnosticFinding[] {
    const findings: DiagnosticFinding[] = [];
    if (input.sessionPayload !== undefined)
      findings.push(...this.validateSessionPayload(input.sessionPayload));
    if (input.redirects !== undefined) findings.push(...this.validateRedirectUrls(input.redirects));
    findings.push(...this.auditAuthCaptureFlow(input.orders, input.now));
    findings.push(
      ...this.detectStuckAuthorizations(input.orders, input.now, input.stuckThresholdMinutes),
    );
    findings.push(...this.detectDuplicateRefunds(input.orders));
    if (input.webhooks !== undefined)
      findings.push(...this.testWebhookConfiguration(input.webhooks));

    const expectedHost =
      input.configuredEnvironment === 'production'
        ? 'gateway.sezzle.com'
        : 'sandbox.gateway.sezzle.com';
    if (
      (input.credentialEnvironment !== 'unknown' &&
        input.credentialEnvironment !== input.configuredEnvironment) ||
      new URL(input.apiBaseUrl).hostname !== expectedHost
    ) {
      findings.push(
        finding(
          'ENVIRONMENT_CREDENTIAL_MISMATCH',
          'critical',
          'Sezzle environment configuration is inconsistent',
          'Credentials, configured environment, or API host do not refer to the same Sezzle environment.',
          [
            `configured=${input.configuredEnvironment}`,
            `credentials=${input.credentialEnvironment}`,
            `api_host=${new URL(input.apiBaseUrl).hostname}`,
          ],
          'Stop operations and align credentials and base URL with the intended environment.',
        ),
      );
    }
    if (
      input.authenticationExpiresAt !== undefined &&
      Date.parse(input.authenticationExpiresAt) <= Date.parse(input.now)
    ) {
      findings.push(
        finding(
          'AUTHENTICATION_EXPIRED',
          'high',
          'Authentication state is expired',
          'The known bearer token expiry is in the past.',
          [`expires_at=${input.authenticationExpiresAt}`],
          'Reacquire authentication before making merchant API calls.',
        ),
      );
    }
    for (const order of input.orders) {
      if (
        order.checkoutStatus === 'active' &&
        order.checkoutExpiresAt !== undefined &&
        Date.parse(order.checkoutExpiresAt) <= Date.parse(input.now)
      ) {
        findings.push(
          finding(
            'STUCK_CHECKOUT_SESSION',
            'medium',
            'Checkout remains active after its expected expiry',
            'The local checkout state appears stale.',
            [`order=${order.orderUuid}`, `expires_at=${order.checkoutExpiresAt}`],
            'Refresh the order from Sezzle and preview cancellation only if it remains active.',
          ),
        );
      }
      if (
        order.merchantReferenceId !== undefined &&
        order.referenceId !== undefined &&
        order.merchantReferenceId !== order.referenceId
      ) {
        findings.push(
          finding(
            'MERCHANT_ORDER_MISMATCH',
            'high',
            'Merchant and Sezzle order references differ',
            'The supplied merchant record does not match the Sezzle order reference.',
            [
              `order=${order.orderUuid}`,
              `merchant=${order.merchantReferenceId}`,
              `sezzle=${order.referenceId}`,
            ],
            'Reconcile ownership and references before exposing or mutating the order.',
          ),
        );
      }
    }
    if (input.merchantRecordMismatchCount > 0) {
      findings.push(
        finding(
          'MERCHANT_ORDER_MISMATCH',
          'high',
          'Merchant records do not match Sezzle records',
          'The supplied reconciliation result contains unmatched or mismatched records.',
          [`count=${String(input.merchantRecordMismatchCount)}`],
          'Run deterministic settlement reconciliation and resolve ownership before action.',
        ),
      );
    }
    return findings;
  }

  public generateGoLiveChecklist(input: IntegrationDiagnosticInput) {
    const findings = this.diagnoseIntegration(input);
    const blocking = findings.filter(
      (item) => item.severity === 'critical' || item.severity === 'high',
    );
    return {
      readyForProduction: input.configuredEnvironment === 'production' && blocking.length === 0,
      configuredEnvironment: input.configuredEnvironment,
      checks: [
        {
          code: 'CONFIGURATION',
          passed: !findings.some((item) => item.code === 'ENVIRONMENT_CREDENTIAL_MISMATCH'),
        },
        {
          code: 'AUTHENTICATION',
          passed: !findings.some((item) => item.code === 'AUTHENTICATION_EXPIRED'),
        },
        {
          code: 'SESSION_PAYLOAD',
          passed: !findings.some((item) =>
            ['MISSING_ORDER_REFERENCE', 'CURRENCY_INCONSISTENCY'].includes(item.code),
          ),
        },
        {
          code: 'REDIRECT_URLS',
          passed: !findings.some((item) =>
            ['INVALID_REDIRECT_URL', 'MISSING_REDIRECT_URL'].includes(item.code),
          ),
        },
        { code: 'WEBHOOKS', passed: !findings.some((item) => item.code.includes('WEBHOOK')) },
        {
          code: 'ORDER_FLOW',
          passed: !findings.some((item) =>
            [
              'UNCAPTURED_AUTHORIZATION',
              'REFUND_BEFORE_CAPTURE',
              'REFUND_EXCEEDS_REFUNDABLE_AMOUNT',
            ].includes(item.code),
          ),
        },
      ],
      blockingFindings: blocking,
      allFindings: findings,
    };
  }
}
