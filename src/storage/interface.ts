import type { SezzleEnvironment } from '../config/env.js';
import type { WebhookEventType, WebhookRelatedIds } from '../domain/webhook.js';

export type AuditResult = 'preview' | 'success' | 'failure' | 'rejected';

export interface AuditEvent {
  readonly auditId: string;
  readonly timestamp: string;
  readonly tool: string;
  readonly merchantId: string;
  readonly environment: SezzleEnvironment;
  readonly targetType: string;
  readonly targetId: string;
  readonly preview: boolean;
  readonly confirmed: boolean;
  readonly requestHash: string;
  readonly result: AuditResult;
  readonly errorCode?: string;
  readonly evidenceId?: string;
}

export interface MutationPreviewRecord {
  readonly previewId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly merchantId: string;
  readonly environment: SezzleEnvironment;
  readonly tool: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly requestHash: string;
  readonly stateHash: string;
  readonly idempotencyKey: string;
  readonly validationValid: boolean;
  readonly validationCode: string;
  readonly consumedAt?: string;
}

export type OperationStatus = 'in_progress' | 'succeeded' | 'failed';

export interface OperationRecord {
  readonly idempotencyKey: string;
  readonly requestHash: string;
  readonly tool: string;
  readonly targetId: string;
  readonly status: OperationStatus;
  readonly createdAt: string;
  readonly auditId?: string;
  readonly evidenceId?: string;
}

export interface OperationReservation {
  readonly reserved: boolean;
  readonly existing: OperationRecord | undefined;
}

export interface AuditFilter {
  readonly tool?: string;
  readonly targetId?: string;
  readonly result?: AuditResult;
  readonly limit: number;
}

export interface Storage {
  close(): Promise<void>;
  savePreview(record: MutationPreviewRecord): Promise<void>;
  getPreview(previewId: string): Promise<MutationPreviewRecord | undefined>;
  consumePreview(previewId: string, consumedAt: string): Promise<MutationPreviewRecord | undefined>;
  reserveOperation(record: OperationRecord): Promise<OperationReservation>;
  completeOperation(
    idempotencyKey: string,
    status: Exclude<OperationStatus, 'in_progress'>,
    auditId: string,
    evidenceId?: string,
  ): Promise<void>;
  appendAudit(event: AuditEvent): Promise<void>;
  getAudit(auditId: string): Promise<AuditEvent | undefined>;
  listAudits(filter: AuditFilter): Promise<readonly AuditEvent[]>;
  saveWebhookEvent(record: WebhookEventRecord): Promise<WebhookSaveResult>;
  getWebhookEvent(eventId: string): Promise<WebhookEventRecord | undefined>;
  listWebhookEvents(filter: WebhookEventFilter): Promise<readonly WebhookEventRecord[]>;
}

export interface WebhookEventRecord {
  readonly eventId: string;
  readonly eventType: WebhookEventType;
  readonly dataType: string;
  readonly receivedAt: string;
  readonly occurredAt: string;
  readonly signatureVerified: true;
  readonly correlationKey: string;
  readonly payloadHash: string;
  readonly rawBody: string;
  readonly relatedIds: WebhookRelatedIds;
  readonly duplicateCount: number;
}

export interface WebhookSaveResult {
  readonly duplicate: boolean;
  readonly record: WebhookEventRecord;
}

export interface WebhookEventFilter {
  readonly correlationKey?: string;
  readonly eventType?: WebhookEventType;
  readonly limit: number;
}
