import { SezzleOpsError } from '../api/errors.js';
import {
  webhookPayloadSchema,
  type WebhookEventType,
  type WebhookRelatedIds,
} from '../domain/webhook.js';
import type { Storage, WebhookEventFilter, WebhookEventRecord } from '../storage/interface.js';
import type { WebhookVerifier } from './webhook-verifier.js';

export interface WebhookEventView {
  readonly eventId: string;
  readonly eventType: WebhookEventType;
  readonly dataType: string;
  readonly receivedAt: string;
  readonly occurredAt: string;
  readonly signatureVerified: true;
  readonly duplicate: boolean;
  readonly duplicateCount: number;
  readonly correlationKey: string;
  readonly payloadHash: string;
  readonly relatedIds: WebhookRelatedIds;
}

const stringField = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined => {
  const value = record[key];
  if (typeof value === 'string' && value !== '') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return undefined;
};

const relatedIdsFromPayload = (
  eventType: WebhookEventType,
  data: Readonly<Record<string, unknown>>,
): WebhookRelatedIds => {
  const nestedCustomer = data['customer'];
  const customerRecord =
    nestedCustomer !== null && typeof nestedCustomer === 'object' && !Array.isArray(nestedCustomer)
      ? (nestedCustomer as Readonly<Record<string, unknown>>)
      : undefined;
  const orderUuid = eventType.startsWith('order.')
    ? stringField(data, 'uuid')
    : stringField(data, 'order_uuid');
  const sessionUuid = stringField(data, 'session_uuid');
  const disputeId = stringField(data, 'dispute_id');
  const merchantUuid = stringField(data, 'merchant_uuid');
  const customerUuid =
    customerRecord === undefined ? undefined : stringField(customerRecord, 'uuid');
  return {
    ...(orderUuid === undefined ? {} : { orderUuid }),
    ...(sessionUuid === undefined ? {} : { sessionUuid }),
    ...(disputeId === undefined ? {} : { disputeId }),
    ...(merchantUuid === undefined ? {} : { merchantUuid }),
    ...(customerUuid === undefined ? {} : { customerUuid }),
  };
};

const correlationKeyFor = (eventId: string, relatedIds: WebhookRelatedIds): string => {
  if (relatedIds.orderUuid !== undefined) return `order:${relatedIds.orderUuid}`;
  if (relatedIds.sessionUuid !== undefined) return `session:${relatedIds.sessionUuid}`;
  if (relatedIds.disputeId !== undefined) return `dispute:${relatedIds.disputeId}`;
  if (relatedIds.merchantUuid !== undefined) return `merchant:${relatedIds.merchantUuid}`;
  if (relatedIds.customerUuid !== undefined) return `customer:${relatedIds.customerUuid}`;
  return `event:${eventId}`;
};

const toView = (record: WebhookEventRecord, duplicate = false): WebhookEventView => ({
  eventId: record.eventId,
  eventType: record.eventType,
  dataType: record.dataType,
  receivedAt: record.receivedAt,
  occurredAt: record.occurredAt,
  signatureVerified: true,
  duplicate,
  duplicateCount: record.duplicateCount,
  correlationKey: record.correlationKey,
  payloadHash: record.payloadHash,
  relatedIds: record.relatedIds,
});

export class EventStore {
  #invalidSignatureCount = 0;

  public constructor(
    private readonly storage: Storage,
    private readonly verifier: WebhookVerifier,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public verify(rawBody: string, signature: string) {
    return this.verifier.verify(rawBody, signature);
  }

  public async ingest(rawBody: string, signature: string): Promise<WebhookEventView> {
    const verification = this.verifier.verify(rawBody, signature);
    if (!verification.signatureVerified) {
      this.#invalidSignatureCount += 1;
      throw new SezzleOpsError({
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: 'Webhook signature verification failed.',
        retryable: false,
        httpStatus: 401,
        details: { payloadHash: verification.payloadHash },
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody) as unknown;
    } catch {
      throw new SezzleOpsError({
        code: 'WEBHOOK_PAYLOAD_INVALID',
        message: 'Verified webhook body is not valid JSON.',
        retryable: false,
        httpStatus: 400,
        details: { payloadHash: verification.payloadHash },
      });
    }
    const payload = webhookPayloadSchema.parse(body);
    const relatedIds = relatedIdsFromPayload(payload.event, payload.data);
    const record: WebhookEventRecord = {
      eventId: payload.uuid,
      eventType: payload.event,
      dataType: payload.data_type,
      receivedAt: this.now().toISOString(),
      occurredAt: payload.created_at,
      signatureVerified: true,
      correlationKey: correlationKeyFor(payload.uuid, relatedIds),
      payloadHash: verification.payloadHash,
      rawBody,
      relatedIds,
      duplicateCount: 0,
    };
    const saved = await this.storage.saveWebhookEvent(record);
    return toView(saved.record, saved.duplicate);
  }

  public async get(eventId: string): Promise<WebhookEventView> {
    const record = await this.storage.getWebhookEvent(eventId);
    if (record === undefined) {
      throw new SezzleOpsError({
        code: 'WEBHOOK_EVENT_NOT_FOUND',
        message: 'Webhook event was not found.',
        retryable: false,
        httpStatus: 404,
        details: {},
      });
    }
    return toView(record);
  }

  public async list(filter: WebhookEventFilter): Promise<readonly WebhookEventView[]> {
    return (await this.storage.listWebhookEvents(filter)).map((record) => toView(record));
  }

  public async timeline(correlationKey: string): Promise<readonly WebhookEventView[]> {
    const events = await this.storage.listWebhookEvents({ correlationKey, limit: 10_000 });
    return [...events]
      .sort(
        (left, right) =>
          left.occurredAt.localeCompare(right.occurredAt) ||
          left.receivedAt.localeCompare(right.receivedAt),
      )
      .map((record) => toView(record));
  }

  public async inspectHealth() {
    const events = await this.storage.listWebhookEvents({ limit: 100_000 });
    const eventTypes = [...new Set(events.map((event) => event.eventType))].sort();
    const correlations = new Set(events.map((event) => event.correlationKey));
    return {
      status:
        this.#invalidSignatureCount > 0
          ? 'degraded'
          : events.length === 0
            ? 'no_events'
            : 'healthy',
      totalStoredEvents: events.length,
      verifiedEvents: events.length,
      invalidSignatureAttempts: this.#invalidSignatureCount,
      duplicateDeliveries: events.reduce((total, event) => total + event.duplicateCount, 0),
      correlationCount: correlations.size,
      eventTypes,
      lastReceivedAt: events[0]?.receivedAt,
    };
  }

  public async findMissingOrderEvents(
    orders: readonly {
      readonly orderUuid: string;
      readonly expectedEvents: readonly WebhookEventType[];
    }[],
  ) {
    const missing: {
      orderUuid: string;
      missingEvents: WebhookEventType[];
      observedEvents: WebhookEventType[];
    }[] = [];
    for (const order of orders) {
      const events = await this.storage.listWebhookEvents({
        correlationKey: `order:${order.orderUuid}`,
        limit: 10_000,
      });
      const observed = [...new Set(events.map((event) => event.eventType))].sort();
      const absent = order.expectedEvents.filter((eventType) => !observed.includes(eventType));
      if (absent.length > 0) {
        missing.push({
          orderUuid: order.orderUuid,
          missingEvents: absent,
          observedEvents: observed,
        });
      }
    }
    return { missing, checkedOrders: orders.length };
  }

  public async detectOutOfOrderEvents(correlationKey?: string) {
    const events = await this.storage.listWebhookEvents({
      ...(correlationKey === undefined ? {} : { correlationKey }),
      limit: 100_000,
    });
    const byCorrelation = new Map<string, WebhookEventRecord[]>();
    for (const event of events) {
      const group = byCorrelation.get(event.correlationKey) ?? [];
      group.push(event);
      byCorrelation.set(event.correlationKey, group);
    }
    const findings: { correlationKey: string; earlierEventId: string; laterEventId: string }[] = [];
    for (const [key, group] of byCorrelation) {
      const received = [...group].sort((left, right) =>
        left.receivedAt.localeCompare(right.receivedAt),
      );
      for (let index = 1; index < received.length; index += 1) {
        const previous = received[index - 1];
        const current = received[index];
        if (
          previous !== undefined &&
          current !== undefined &&
          current.occurredAt < previous.occurredAt
        ) {
          findings.push({
            correlationKey: key,
            earlierEventId: previous.eventId,
            laterEventId: current.eventId,
          });
        }
      }
    }
    return { findings, correlationCount: byCorrelation.size };
  }

  public async detectDuplicateEvents() {
    const events = await this.storage.listWebhookEvents({ limit: 100_000 });
    return {
      duplicates: events
        .filter((event) => event.duplicateCount > 0)
        .map((event) => ({
          eventId: event.eventId,
          payloadHash: event.payloadHash,
          duplicateCount: event.duplicateCount,
          correlationKey: event.correlationKey,
        })),
    };
  }
}
