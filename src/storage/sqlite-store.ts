import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { z } from 'zod';

import { webhookEventTypeSchema } from '../domain/webhook.js';
import type {
  AuditEvent,
  AuditFilter,
  MutationPreviewRecord,
  OperationRecord,
  OperationReservation,
  OperationStatus,
  Storage,
  WebhookEventFilter,
  WebhookEventRecord,
  WebhookSaveResult,
} from './interface.js';

const previewRowSchema = z.object({
  preview_id: z.string(),
  created_at: z.string(),
  expires_at: z.string(),
  merchant_id: z.string(),
  environment: z.enum(['sandbox', 'production']),
  tool: z.string(),
  target_type: z.string(),
  target_id: z.string(),
  request_hash: z.string(),
  state_hash: z.string(),
  idempotency_key: z.string(),
  validation_valid: z.union([z.literal(0), z.literal(1)]),
  validation_code: z.string(),
  consumed_at: z.string().nullable(),
});

const operationRowSchema = z.object({
  idempotency_key: z.string(),
  request_hash: z.string(),
  tool: z.string(),
  target_id: z.string(),
  status: z.enum(['in_progress', 'succeeded', 'failed']),
  created_at: z.string(),
  audit_id: z.string().nullable(),
  evidence_id: z.string().nullable(),
});

const auditRowSchema = z.object({
  audit_id: z.string(),
  timestamp: z.string(),
  tool: z.string(),
  merchant_id: z.string(),
  environment: z.enum(['sandbox', 'production']),
  target_type: z.string(),
  target_id: z.string(),
  preview: z.union([z.literal(0), z.literal(1)]),
  confirmed: z.union([z.literal(0), z.literal(1)]),
  request_hash: z.string(),
  result: z.enum(['preview', 'success', 'failure', 'rejected']),
  error_code: z.string().nullable(),
  evidence_id: z.string().nullable(),
});

const relatedIdsSchema = z
  .object({
    orderUuid: z.string().optional(),
    sessionUuid: z.string().optional(),
    disputeId: z.string().optional(),
    merchantUuid: z.string().optional(),
    customerUuid: z.string().optional(),
  })
  .transform((ids) => ({
    ...(ids.orderUuid === undefined ? {} : { orderUuid: ids.orderUuid }),
    ...(ids.sessionUuid === undefined ? {} : { sessionUuid: ids.sessionUuid }),
    ...(ids.disputeId === undefined ? {} : { disputeId: ids.disputeId }),
    ...(ids.merchantUuid === undefined ? {} : { merchantUuid: ids.merchantUuid }),
    ...(ids.customerUuid === undefined ? {} : { customerUuid: ids.customerUuid }),
  }));

const webhookRowSchema = z.object({
  event_id: z.string(),
  event_type: webhookEventTypeSchema,
  data_type: z.string(),
  received_at: z.string(),
  occurred_at: z.string(),
  signature_verified: z.literal(1),
  correlation_key: z.string(),
  payload_hash: z.string(),
  raw_body: z.string(),
  related_ids: z.string(),
  duplicate_count: z.number().int().nonnegative(),
});

type PreviewRow = z.infer<typeof previewRowSchema>;
type OperationRow = z.infer<typeof operationRowSchema>;
type AuditRow = z.infer<typeof auditRowSchema>;
type WebhookRow = z.infer<typeof webhookRowSchema>;

const previewFromRow = (unknownRow: unknown): MutationPreviewRecord => {
  const row = previewRowSchema.parse(unknownRow);
  return {
    previewId: row.preview_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    merchantId: row.merchant_id,
    environment: row.environment,
    tool: row.tool,
    targetType: row.target_type,
    targetId: row.target_id,
    requestHash: row.request_hash,
    stateHash: row.state_hash,
    idempotencyKey: row.idempotency_key,
    validationValid: row.validation_valid === 1,
    validationCode: row.validation_code,
    ...(row.consumed_at === null ? {} : { consumedAt: row.consumed_at }),
  };
};

const operationFromRow = (unknownRow: unknown): OperationRecord => {
  const row = operationRowSchema.parse(unknownRow);
  return {
    idempotencyKey: row.idempotency_key,
    requestHash: row.request_hash,
    tool: row.tool,
    targetId: row.target_id,
    status: row.status,
    createdAt: row.created_at,
    ...(row.audit_id === null ? {} : { auditId: row.audit_id }),
    ...(row.evidence_id === null ? {} : { evidenceId: row.evidence_id }),
  };
};

const auditFromRow = (unknownRow: unknown): AuditEvent => {
  const row = auditRowSchema.parse(unknownRow);
  return {
    auditId: row.audit_id,
    timestamp: row.timestamp,
    tool: row.tool,
    merchantId: row.merchant_id,
    environment: row.environment,
    targetType: row.target_type,
    targetId: row.target_id,
    preview: row.preview === 1,
    confirmed: row.confirmed === 1,
    requestHash: row.request_hash,
    result: row.result,
    ...(row.error_code === null ? {} : { errorCode: row.error_code }),
    ...(row.evidence_id === null ? {} : { evidenceId: row.evidence_id }),
  };
};

const webhookFromRow = (unknownRow: unknown): WebhookEventRecord => {
  const row = webhookRowSchema.parse(unknownRow);
  const parsedIds: unknown = JSON.parse(row.related_ids);
  return {
    eventId: row.event_id,
    eventType: row.event_type,
    dataType: row.data_type,
    receivedAt: row.received_at,
    occurredAt: row.occurred_at,
    signatureVerified: true,
    correlationKey: row.correlation_key,
    payloadHash: row.payload_hash,
    rawBody: row.raw_body,
    relatedIds: relatedIdsSchema.parse(parsedIds),
    duplicateCount: row.duplicate_count,
  };
};

export class SqliteStore implements Storage {
  readonly #database: Database.Database;

  public constructor(path: string) {
    const memory = path === ':memory:';
    const databasePath = memory ? path : resolve(path);
    if (!memory) mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });
    this.#database = new Database(databasePath);
    this.#database.pragma('journal_mode = WAL');
    this.#database.pragma('foreign_keys = ON');
    this.#database.pragma('busy_timeout = 5000');
    this.#migrate();
    if (!memory && process.platform !== 'win32') chmodSync(databasePath, 0o600);
  }

  public close(): Promise<void> {
    if (this.#database.open) this.#database.close();
    return Promise.resolve();
  }

  public savePreview(record: MutationPreviewRecord): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO mutation_previews (
          preview_id, created_at, expires_at, merchant_id, environment, tool, target_type,
          target_id, request_hash, state_hash, idempotency_key, validation_valid,
          validation_code, consumed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.previewId,
        record.createdAt,
        record.expiresAt,
        record.merchantId,
        record.environment,
        record.tool,
        record.targetType,
        record.targetId,
        record.requestHash,
        record.stateHash,
        record.idempotencyKey,
        record.validationValid ? 1 : 0,
        record.validationCode,
        record.consumedAt ?? null,
      );
    return Promise.resolve();
  }

  public getPreview(previewId: string): Promise<MutationPreviewRecord | undefined> {
    const row = this.#database
      .prepare<[string], PreviewRow>('SELECT * FROM mutation_previews WHERE preview_id = ?')
      .get(previewId);
    return Promise.resolve(row === undefined ? undefined : previewFromRow(row));
  }

  public consumePreview(
    previewId: string,
    consumedAt: string,
  ): Promise<MutationPreviewRecord | undefined> {
    const consume = this.#database.transaction(() => {
      const update = this.#database
        .prepare(
          'UPDATE mutation_previews SET consumed_at = ? WHERE preview_id = ? AND consumed_at IS NULL',
        )
        .run(consumedAt, previewId);
      if (update.changes !== 1) return undefined;
      return this.#database
        .prepare<[string], PreviewRow>('SELECT * FROM mutation_previews WHERE preview_id = ?')
        .get(previewId);
    });
    const row = consume();
    return Promise.resolve(row === undefined ? undefined : previewFromRow(row));
  }

  public reserveOperation(record: OperationRecord): Promise<OperationReservation> {
    const reserve = this.#database.transaction(() => {
      const insert = this.#database
        .prepare(
          `INSERT OR IGNORE INTO operations (
            idempotency_key, request_hash, tool, target_id, status, created_at, audit_id, evidence_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.idempotencyKey,
          record.requestHash,
          record.tool,
          record.targetId,
          record.status,
          record.createdAt,
          record.auditId ?? null,
          record.evidenceId ?? null,
        );
      if (insert.changes === 1) return { reserved: true, existing: undefined } as const;
      const existing = this.#database
        .prepare<[string], OperationRow>('SELECT * FROM operations WHERE idempotency_key = ?')
        .get(record.idempotencyKey);
      return {
        reserved: false,
        existing: existing === undefined ? undefined : operationFromRow(existing),
      } as const;
    });
    return Promise.resolve(reserve());
  }

  public completeOperation(
    idempotencyKey: string,
    status: Exclude<OperationStatus, 'in_progress'>,
    auditId: string,
    evidenceId?: string,
  ): Promise<void> {
    const result = this.#database
      .prepare(
        `UPDATE operations SET status = ?, audit_id = ?, evidence_id = ?
         WHERE idempotency_key = ? AND status = 'in_progress'`,
      )
      .run(status, auditId, evidenceId ?? null, idempotencyKey);
    if (result.changes !== 1)
      throw new Error('Cannot complete an operation that is not in progress.');
    return Promise.resolve();
  }

  public appendAudit(event: AuditEvent): Promise<void> {
    this.#database
      .prepare(
        `INSERT INTO audit_events (
          audit_id, timestamp, tool, merchant_id, environment, target_type, target_id,
          preview, confirmed, request_hash, result, error_code, evidence_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.auditId,
        event.timestamp,
        event.tool,
        event.merchantId,
        event.environment,
        event.targetType,
        event.targetId,
        event.preview ? 1 : 0,
        event.confirmed ? 1 : 0,
        event.requestHash,
        event.result,
        event.errorCode ?? null,
        event.evidenceId ?? null,
      );
    return Promise.resolve();
  }

  public getAudit(auditId: string): Promise<AuditEvent | undefined> {
    const row = this.#database
      .prepare<[string], AuditRow>('SELECT * FROM audit_events WHERE audit_id = ?')
      .get(auditId);
    return Promise.resolve(row === undefined ? undefined : auditFromRow(row));
  }

  public listAudits(filter: AuditFilter): Promise<readonly AuditEvent[]> {
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (filter.tool !== undefined) {
      clauses.push('tool = ?');
      values.push(filter.tool);
    }
    if (filter.targetId !== undefined) {
      clauses.push('target_id = ?');
      values.push(filter.targetId);
    }
    if (filter.result !== undefined) {
      clauses.push('result = ?');
      values.push(filter.result);
    }
    values.push(filter.limit);
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    const rows = this.#database
      .prepare<(string | number)[], AuditRow>(
        `SELECT * FROM audit_events ${where} ORDER BY timestamp DESC LIMIT ?`,
      )
      .all(...values);
    return Promise.resolve(rows.map((row) => auditFromRow(row)));
  }

  public saveWebhookEvent(record: WebhookEventRecord): Promise<WebhookSaveResult> {
    const save = this.#database.transaction(() => {
      const existing = this.#database
        .prepare<[string, string], WebhookRow>(
          'SELECT * FROM webhook_events WHERE event_id = ? OR payload_hash = ? LIMIT 1',
        )
        .get(record.eventId, record.payloadHash);
      if (existing !== undefined) {
        this.#database
          .prepare(
            'UPDATE webhook_events SET duplicate_count = duplicate_count + 1 WHERE event_id = ?',
          )
          .run(existing.event_id);
        const updated = this.#database
          .prepare<[string], WebhookRow>('SELECT * FROM webhook_events WHERE event_id = ?')
          .get(existing.event_id);
        if (updated === undefined) throw new Error('Webhook duplicate update failed.');
        return { duplicate: true, record: webhookFromRow(updated) };
      }
      this.#database
        .prepare(
          `INSERT INTO webhook_events (
            event_id, event_type, data_type, received_at, occurred_at, signature_verified,
            correlation_key, payload_hash, raw_body, related_ids, duplicate_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.eventId,
          record.eventType,
          record.dataType,
          record.receivedAt,
          record.occurredAt,
          1,
          record.correlationKey,
          record.payloadHash,
          record.rawBody,
          JSON.stringify(record.relatedIds),
          record.duplicateCount,
        );
      return { duplicate: false, record };
    });
    return Promise.resolve(save());
  }

  public getWebhookEvent(eventId: string): Promise<WebhookEventRecord | undefined> {
    const row = this.#database
      .prepare<[string], WebhookRow>('SELECT * FROM webhook_events WHERE event_id = ?')
      .get(eventId);
    return Promise.resolve(row === undefined ? undefined : webhookFromRow(row));
  }

  public listWebhookEvents(filter: WebhookEventFilter): Promise<readonly WebhookEventRecord[]> {
    const clauses: string[] = [];
    const values: (string | number)[] = [];
    if (filter.correlationKey !== undefined) {
      clauses.push('correlation_key = ?');
      values.push(filter.correlationKey);
    }
    if (filter.eventType !== undefined) {
      clauses.push('event_type = ?');
      values.push(filter.eventType);
    }
    values.push(filter.limit);
    const where = clauses.length === 0 ? '' : `WHERE ${clauses.join(' AND ')}`;
    const rows = this.#database
      .prepare<(string | number)[], WebhookRow>(
        `SELECT * FROM webhook_events ${where} ORDER BY received_at DESC LIMIT ?`,
      )
      .all(...values);
    return Promise.resolve(rows.map((row) => webhookFromRow(row)));
  }

  #migrate(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS mutation_previews (
        preview_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
        tool TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        state_hash TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        validation_valid INTEGER NOT NULL CHECK (validation_valid IN (0, 1)),
        validation_code TEXT NOT NULL,
        consumed_at TEXT
      );
      CREATE TABLE IF NOT EXISTS operations (
        idempotency_key TEXT PRIMARY KEY,
        request_hash TEXT NOT NULL,
        tool TEXT NOT NULL,
        target_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('in_progress', 'succeeded', 'failed')),
        created_at TEXT NOT NULL,
        audit_id TEXT,
        evidence_id TEXT
      );
      CREATE TABLE IF NOT EXISTS audit_events (
        audit_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        tool TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        preview INTEGER NOT NULL CHECK (preview IN (0, 1)),
        confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
        request_hash TEXT NOT NULL,
        result TEXT NOT NULL CHECK (result IN ('preview', 'success', 'failure', 'rejected')),
        error_code TEXT,
        evidence_id TEXT
      );
      CREATE INDEX IF NOT EXISTS audit_events_timestamp_idx ON audit_events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS audit_events_tool_idx ON audit_events(tool);
      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        data_type TEXT NOT NULL,
        received_at TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        signature_verified INTEGER NOT NULL CHECK (signature_verified = 1),
        correlation_key TEXT NOT NULL,
        payload_hash TEXT NOT NULL UNIQUE,
        raw_body TEXT NOT NULL,
        related_ids TEXT NOT NULL,
        duplicate_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS webhook_events_correlation_idx
        ON webhook_events(correlation_key, occurred_at);
    `);
  }
}
