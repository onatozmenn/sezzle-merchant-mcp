import { z } from 'zod';

export const findingSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export type FindingSeverity = z.infer<typeof findingSeveritySchema>;

export const diagnosticCodeSchema = z.enum([
  'INVALID_REDIRECT_URL',
  'MISSING_REDIRECT_URL',
  'MISSING_ORDER_REFERENCE',
  'CURRENCY_INCONSISTENCY',
  'UNCAPTURED_AUTHORIZATION',
  'STUCK_AUTHORIZATION',
  'REFUND_BEFORE_CAPTURE',
  'REFUND_EXCEEDS_REFUNDABLE_AMOUNT',
  'DUPLICATE_ORDER_REFERENCE',
  'DUPLICATE_REFUND',
  'MISSING_WEBHOOK_SUBSCRIPTION',
  'INVALID_WEBHOOK_SIGNATURE',
  'MISSING_WEBHOOK_EVENT',
  'OUT_OF_ORDER_WEBHOOK_EVENT',
  'ENVIRONMENT_CREDENTIAL_MISMATCH',
  'AUTHENTICATION_EXPIRED',
  'STUCK_CHECKOUT_SESSION',
  'MERCHANT_ORDER_MISMATCH',
]);

export type DiagnosticCode = z.infer<typeof diagnosticCodeSchema>;

export interface DiagnosticFinding {
  readonly code: DiagnosticCode;
  readonly severity: FindingSeverity;
  readonly title: string;
  readonly explanation: string;
  readonly evidence: readonly string[];
  readonly recommendedAction: string;
  readonly safeToAutomate: false;
}
