import { z } from 'zod';

import type { OrderSnapshot } from '../api/schemas/phase1.js';

export const supportClassificationSchema = z.enum([
  'order_status',
  'refund_request',
  'capture_question',
  'checkout_cancellation',
  'decline_or_approval',
  'dispute',
  'personal_data',
  'unknown',
]);

export type SupportClassification = z.infer<typeof supportClassificationSchema>;

export const supportRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(5_000),
    stated_classification: supportClassificationSchema.optional(),
  })
  .strict()
  .transform((request) => ({
    message: request.message,
    ...(request.stated_classification === undefined
      ? {}
      : { statedClassification: request.stated_classification }),
  }));

export type SupportRequest = z.infer<typeof supportRequestSchema>;

export const actionEvidenceSchema = z
  .object({
    action: z.enum(['refund', 'capture', 'cancellation', 'release', 'escalation']),
    status: z.enum(['confirmed', 'failed', 'unknown']),
    api_request_id: z.string().trim().min(1).max(255).optional(),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (evidence.status === 'confirmed' && evidence.api_request_id === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['api_request_id'],
        message: 'Confirmed action evidence requires an API request ID.',
      });
    }
  })
  .transform((evidence) => ({
    action: evidence.action,
    status: evidence.status,
    ...(evidence.api_request_id === undefined ? {} : { apiRequestId: evidence.api_request_id }),
  }));

export type ActionEvidence = z.infer<typeof actionEvidenceSchema>;

export interface SupportResponse {
  readonly classification: SupportClassification;
  readonly facts: readonly string[];
  readonly policyReferences: readonly string[];
  readonly draftResponse: string;
  readonly requiresHuman: boolean;
  readonly reason: string;
  readonly allowedActions: readonly string[];
}

const classificationRules: readonly {
  readonly classification: SupportClassification;
  readonly terms: readonly string[];
}[] = [
  { classification: 'refund_request', terms: ['refund', 'money back', 'returned'] },
  { classification: 'capture_question', terms: ['capture', 'charged', 'payment pending'] },
  { classification: 'checkout_cancellation', terms: ['cancel checkout', 'cancel order'] },
  {
    classification: 'decline_or_approval',
    terms: ['declined', 'denied', 'approved', 'spending limit'],
  },
  { classification: 'dispute', terms: ['dispute', 'chargeback'] },
  { classification: 'personal_data', terms: ['email', 'phone', 'address', 'personal data'] },
  { classification: 'order_status', terms: ['order status', 'where is', 'status'] },
];

const policyFor = (classification: SupportClassification): readonly string[] => {
  switch (classification) {
    case 'refund_request':
      return ['SUPPORT-ACTION-EVIDENCE', 'REFUND-AFTER-CAPTURE'];
    case 'capture_question':
      return ['SUPPORT-ACTION-EVIDENCE', 'AUTHORIZATION-BEFORE-CAPTURE'];
    case 'checkout_cancellation':
      return ['ACTIVE-CHECKOUT-ONLY', 'SUPPORT-ACTION-EVIDENCE'];
    case 'decline_or_approval':
      return ['NO-UNDERWRITING-INFERENCE', 'HUMAN-ESCALATION'];
    case 'dispute':
      return ['DISPUTE-HUMAN-REVIEW'];
    case 'personal_data':
      return ['DATA-MINIMIZATION', 'HUMAN-ESCALATION'];
    case 'order_status':
      return ['MERCHANT-OWNERSHIP-REQUIRED', 'DATA-MINIMIZATION'];
    case 'unknown':
      return ['HUMAN-ESCALATION'];
  }
};

const routeFor = (classification: SupportClassification) => {
  switch (classification) {
    case 'order_status':
      return {
        requiresHuman: false,
        reason: 'Status can be explained from verified order facts.',
        allowedActions: ['explain_status'],
      };
    case 'refund_request':
      return {
        requiresHuman: true,
        reason:
          'Refunds require merchant policy review and a separate confirmed financial mutation.',
        allowedActions: ['gather_refund_reason', 'preview_refund', 'escalate'],
      };
    case 'capture_question':
      return {
        requiresHuman: true,
        reason:
          'Capture timing depends on fulfillment policy and requires explicit financial approval.',
        allowedActions: ['explain_authorization', 'preview_capture', 'escalate'],
      };
    case 'checkout_cancellation':
      return {
        requiresHuman: true,
        reason: 'Cancellation is irreversible and must be separately previewed and confirmed.',
        allowedActions: ['verify_active_checkout', 'preview_cancellation', 'escalate'],
      };
    case 'decline_or_approval':
      return {
        requiresHuman: true,
        reason:
          'Exact underwriting, approval, decline, and spending-limit reasons are unavailable.',
        allowedActions: ['state_known_status', 'refer_to_sezzle_support'],
      };
    case 'dispute':
      return {
        requiresHuman: true,
        reason: 'Disputes require merchant evidence and deadline-aware human review.',
        allowedActions: ['gather_evidence', 'escalate'],
      };
    case 'personal_data':
      return {
        requiresHuman: true,
        reason: 'Personal-data requests require identity and privacy-policy verification.',
        allowedActions: ['privacy_escalation'],
      };
    case 'unknown':
      return {
        requiresHuman: true,
        reason: 'The request cannot be handled safely from the supplied facts.',
        allowedActions: ['clarify', 'escalate'],
      };
  }
};

export class SupportPolicyEngine {
  public classify(request: SupportRequest): SupportClassification {
    if (request.statedClassification !== undefined) return request.statedClassification;
    const message = request.message.toLowerCase();
    return (
      classificationRules.find((rule) => rule.terms.some((term) => message.includes(term)))
        ?.classification ?? 'unknown'
    );
  }

  public determineSafeRoute(request: SupportRequest): SupportResponse {
    const classification = this.classify(request);
    const route = routeFor(classification);
    return {
      classification,
      facts: [],
      policyReferences: policyFor(classification),
      draftResponse: '',
      requiresHuman: route.requiresHuman,
      reason: route.reason,
      allowedActions: route.allowedActions,
    };
  }

  public identifyRequiredEscalation(request: SupportRequest): SupportResponse {
    const classification = this.classify(request);
    const route = routeFor(classification);
    const escalationActions = route.allowedActions.filter(
      (action) => action.includes('escalat') || action.startsWith('refer_'),
    );
    return {
      classification,
      facts: [],
      policyReferences: policyFor(classification),
      draftResponse: '',
      requiresHuman: route.requiresHuman,
      reason: route.requiresHuman
        ? `Human escalation is required. ${route.reason}`
        : 'No mandatory human escalation is identified from the supplied request.',
      allowedActions: route.requiresHuman
        ? escalationActions.length === 0
          ? ['human_review']
          : escalationActions
        : [],
    };
  }

  public explainOrderStatus(order: OrderSnapshot): SupportResponse {
    const facts = [
      `Order reference: ${order.reference_id ?? 'not provided'}.`,
      `Checkout status: ${order.checkout_status ?? 'unknown'}.`,
      `Authorization approved: ${String(order.authorization?.approved ?? false)}.`,
      `Captured amount in cents: ${String(
        order.authorization?.captures.reduce(
          (total, capture) => total + BigInt(capture.amount.amount_in_cents),
          0n,
        ) ?? 0n,
      )}.`,
      `Refunded amount in cents: ${String(
        order.authorization?.refunds.reduce(
          (total, refund) => total + BigInt(refund.amount.amount_in_cents),
          0n,
        ) ?? 0n,
      )}.`,
    ];
    return {
      classification: 'order_status',
      facts,
      policyReferences: policyFor('order_status'),
      draftResponse: `We verified the merchant order. Its checkout status is ${order.checkout_status ?? 'unknown'}. No payment action was performed during this review.`,
      requiresHuman: false,
      reason: 'The response uses only verified, PII-free order facts.',
      allowedActions: ['explain_status'],
    };
  }

  public draftCustomerResponse(
    request: SupportRequest,
    facts: readonly string[],
    actionEvidence: readonly ActionEvidence[],
  ): SupportResponse {
    const classification = this.classify(request);
    const route = routeFor(classification);
    const confirmed = actionEvidence.filter(
      (evidence) => evidence.status === 'confirmed' && evidence.apiRequestId !== undefined,
    );
    const actionText =
      confirmed.length === 0
        ? 'No refund, capture, cancellation, release, or escalation has been confirmed.'
        : confirmed
            .map(
              (evidence) =>
                `The ${evidence.action} was confirmed by API response ${evidence.apiRequestId ?? ''}.`,
            )
            .join(' ');
    const policyText =
      classification === 'decline_or_approval'
        ? 'We cannot provide or infer an exact underwriting, approval, spending-limit, or decline reason.'
        : 'We can explain verified facts and route any requested action for separate approval.';
    return {
      classification,
      facts,
      policyReferences: policyFor(classification),
      draftResponse: `${policyText} ${actionText}`,
      requiresHuman: route.requiresHuman,
      reason: route.reason,
      allowedActions: route.allowedActions,
    };
  }
}
