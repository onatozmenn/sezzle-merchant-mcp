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

export class MemoryStore implements Storage {
  readonly #previews = new Map<string, MutationPreviewRecord>();
  readonly #operations = new Map<string, OperationRecord>();
  readonly #audits = new Map<string, AuditEvent>();
  readonly #webhookEvents = new Map<string, WebhookEventRecord>();
  readonly #webhookPayloadIds = new Map<string, string>();

  public close(): Promise<void> {
    return Promise.resolve();
  }

  public savePreview(record: MutationPreviewRecord): Promise<void> {
    this.#previews.set(record.previewId, { ...record });
    return Promise.resolve();
  }

  public getPreview(previewId: string): Promise<MutationPreviewRecord | undefined> {
    const record = this.#previews.get(previewId);
    return Promise.resolve(record === undefined ? undefined : { ...record });
  }

  public consumePreview(
    previewId: string,
    consumedAt: string,
  ): Promise<MutationPreviewRecord | undefined> {
    const record = this.#previews.get(previewId);
    if (record === undefined || record.consumedAt !== undefined) return Promise.resolve(undefined);
    const consumed = { ...record, consumedAt };
    this.#previews.set(previewId, consumed);
    return Promise.resolve({ ...consumed });
  }

  public reserveOperation(record: OperationRecord): Promise<OperationReservation> {
    const existing = this.#operations.get(record.idempotencyKey);
    if (existing !== undefined) {
      return Promise.resolve({ reserved: false, existing: { ...existing } });
    }
    this.#operations.set(record.idempotencyKey, { ...record });
    return Promise.resolve({ reserved: true, existing: undefined });
  }

  public completeOperation(
    idempotencyKey: string,
    status: Exclude<OperationStatus, 'in_progress'>,
    auditId: string,
    evidenceId?: string,
  ): Promise<void> {
    const existing = this.#operations.get(idempotencyKey);
    if (existing === undefined)
      throw new Error('Cannot complete an operation that was not reserved.');
    this.#operations.set(idempotencyKey, {
      ...existing,
      status,
      auditId,
      ...(evidenceId === undefined ? {} : { evidenceId }),
    });
    return Promise.resolve();
  }

  public appendAudit(event: AuditEvent): Promise<void> {
    this.#audits.set(event.auditId, { ...event });
    return Promise.resolve();
  }

  public getAudit(auditId: string): Promise<AuditEvent | undefined> {
    const event = this.#audits.get(auditId);
    return Promise.resolve(event === undefined ? undefined : { ...event });
  }

  public listAudits(filter: AuditFilter): Promise<readonly AuditEvent[]> {
    const events = [...this.#audits.values()]
      .filter((event) => filter.tool === undefined || event.tool === filter.tool)
      .filter((event) => filter.targetId === undefined || event.targetId === filter.targetId)
      .filter((event) => filter.result === undefined || event.result === filter.result)
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, filter.limit)
      .map((event) => ({ ...event }));
    return Promise.resolve(events);
  }

  public saveWebhookEvent(record: WebhookEventRecord): Promise<WebhookSaveResult> {
    const existingById = this.#webhookEvents.get(record.eventId);
    const payloadEventId = this.#webhookPayloadIds.get(record.payloadHash);
    const existingByPayload =
      payloadEventId === undefined ? undefined : this.#webhookEvents.get(payloadEventId);
    const existing = existingById ?? existingByPayload;
    if (existing !== undefined) {
      const updated = { ...existing, duplicateCount: existing.duplicateCount + 1 };
      this.#webhookEvents.set(existing.eventId, updated);
      return Promise.resolve({ duplicate: true, record: { ...updated } });
    }
    this.#webhookEvents.set(record.eventId, { ...record });
    this.#webhookPayloadIds.set(record.payloadHash, record.eventId);
    return Promise.resolve({ duplicate: false, record: { ...record } });
  }

  public getWebhookEvent(eventId: string): Promise<WebhookEventRecord | undefined> {
    const record = this.#webhookEvents.get(eventId);
    return Promise.resolve(record === undefined ? undefined : { ...record });
  }

  public listWebhookEvents(filter: WebhookEventFilter): Promise<readonly WebhookEventRecord[]> {
    const records = [...this.#webhookEvents.values()]
      .filter(
        (record) =>
          filter.correlationKey === undefined || record.correlationKey === filter.correlationKey,
      )
      .filter((record) => filter.eventType === undefined || record.eventType === filter.eventType)
      .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt))
      .slice(0, filter.limit)
      .map((record) => ({ ...record }));
    return Promise.resolve(records);
  }
}
