import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SecretValue } from '../../src/config/env.js';
import { EventStore } from '../../src/services/event-store.js';
import { WebhookVerifier } from '../../src/services/webhook-verifier.js';
import { MemoryStore } from '../../src/storage/memory-store.js';

const secret = 'webhook-secret';
const signatureFor = (body: string) => createHmac('sha256', secret).update(body).digest('hex');

const payload = (uuid: string, event: string, createdAt: string) =>
  JSON.stringify({
    uuid,
    created_at: createdAt,
    event,
    data_type: 'order',
    data: { uuid: 'order-1' },
  });

const createStore = () => {
  let milliseconds = Date.parse('2026-07-16T12:00:00Z');
  const now = () => new Date((milliseconds += 1_000));
  return new EventStore(new MemoryStore(), new WebhookVerifier(new SecretValue(secret)), now);
};

describe('verified webhook event storage', () => {
  it('rejects an invalid signature before parsing or storage', async () => {
    const store = createStore();
    const rawBody = payload('event-1', 'order.authorized', '2026-07-16T11:00:00Z');

    await expect(store.ingest(rawBody, '0'.repeat(64))).rejects.toMatchObject({
      code: 'WEBHOOK_SIGNATURE_INVALID',
    });
    expect((await store.list({ limit: 100 })).length).toBe(0);
    expect((await store.inspectHealth()).invalidSignatureAttempts).toBe(1);
  });

  it('preserves verified metadata and deduplicates repeated delivery idempotently', async () => {
    const store = createStore();
    const rawBody = payload('event-1', 'order.authorized', '2026-07-16T11:00:00Z');

    const first = await store.ingest(rawBody, signatureFor(rawBody));
    const repeated = await store.ingest(rawBody, signatureFor(rawBody));

    expect(first).toMatchObject({
      eventId: 'event-1',
      signatureVerified: true,
      duplicate: false,
      correlationKey: 'order:order-1',
    });
    expect(repeated.duplicate).toBe(true);
    expect(repeated.duplicateCount).toBe(1);
    expect(await store.detectDuplicateEvents()).toMatchObject({
      duplicates: [{ eventId: 'event-1', duplicateCount: 1 }],
    });
  });

  it('sorts timelines by occurrence time and reports out-of-order delivery', async () => {
    const store = createStore();
    const captured = payload('event-2', 'order.captured', '2026-07-16T11:10:00Z');
    const authorized = payload('event-1', 'order.authorized', '2026-07-16T11:00:00Z');
    await store.ingest(captured, signatureFor(captured));
    await store.ingest(authorized, signatureFor(authorized));

    const timeline = await store.timeline('order:order-1');
    const ordering = await store.detectOutOfOrderEvents('order:order-1');

    expect(timeline.map((event) => event.eventId)).toEqual(['event-1', 'event-2']);
    expect(ordering.findings).toHaveLength(1);
  });

  it('finds expected order events that have not arrived', async () => {
    const store = createStore();
    const authorized = payload('event-1', 'order.authorized', '2026-07-16T11:00:00Z');
    await store.ingest(authorized, signatureFor(authorized));

    const result = await store.findMissingOrderEvents([
      {
        orderUuid: 'order-1',
        expectedEvents: ['order.authorized', 'order.captured'],
      },
    ]);

    expect(result.missing[0]?.missingEvents).toEqual(['order.captured']);
  });

  it('does not expose the preserved raw body through event views', async () => {
    const store = createStore();
    const rawBody = payload('event-1', 'order.authorized', '2026-07-16T11:00:00Z');
    await store.ingest(rawBody, signatureFor(rawBody));

    expect(await store.get('event-1')).not.toHaveProperty('rawBody');
  });
});
