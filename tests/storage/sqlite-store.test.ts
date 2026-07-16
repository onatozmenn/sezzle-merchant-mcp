import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { SqliteStore } from '../../src/storage/sqlite-store.js';

const temporaryDirectories: string[] = [];
const previewOperationKey = 'fixture-preview-operation-1';

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('SqliteStore', () => {
  it('persists previews, operations, audits, and webhook events across restart', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'sezzle-ops-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'storage.db');
    const store = new SqliteStore(path);
    await store.savePreview({
      previewId: 'preview-1',
      createdAt: '2026-07-16T12:00:00Z',
      expiresAt: '2026-07-16T12:05:00Z',
      merchantId: 'merchant-1',
      environment: 'sandbox',
      tool: 'sezzle_capture_order',
      targetType: 'order',
      targetId: 'order-1',
      requestHash: 'request-hash',
      stateHash: 'state-hash',
      idempotencyKey: previewOperationKey,
      validationValid: true,
      validationCode: 'VALID',
    });
    await store.reserveOperation({
      idempotencyKey: 'operation-1',
      requestHash: 'request-hash',
      tool: 'sezzle_capture_order',
      targetId: 'order-1',
      status: 'in_progress',
      createdAt: '2026-07-16T12:00:00Z',
    });
    await store.appendAudit({
      auditId: 'audit-1',
      timestamp: '2026-07-16T12:00:00Z',
      tool: 'sezzle_capture_order',
      merchantId: 'merchant-1',
      environment: 'sandbox',
      targetType: 'order',
      targetId: 'order-1',
      preview: true,
      confirmed: false,
      requestHash: 'request-hash',
      result: 'preview',
    });
    await store.saveWebhookEvent({
      eventId: 'event-1',
      eventType: 'order.authorized',
      dataType: 'order',
      receivedAt: '2026-07-16T12:00:00Z',
      occurredAt: '2026-07-16T11:00:00Z',
      signatureVerified: true,
      correlationKey: 'order:order-1',
      payloadHash: 'payload-hash',
      rawBody: '{"uuid":"event-1"}',
      relatedIds: { orderUuid: 'order-1' },
      duplicateCount: 0,
    });
    await store.close();

    const reopened = new SqliteStore(path);
    expect(await reopened.getPreview('preview-1')).toMatchObject({ validationValid: true });
    expect(await reopened.getAudit('audit-1')).toMatchObject({ result: 'preview' });
    expect(await reopened.getWebhookEvent('event-1')).toMatchObject({
      rawBody: '{"uuid":"event-1"}',
      relatedIds: { orderUuid: 'order-1' },
    });
    const duplicate = await reopened.saveWebhookEvent({
      eventId: 'event-1',
      eventType: 'order.authorized',
      dataType: 'order',
      receivedAt: '2026-07-16T12:01:00Z',
      occurredAt: '2026-07-16T11:00:00Z',
      signatureVerified: true,
      correlationKey: 'order:order-1',
      payloadHash: 'payload-hash',
      rawBody: '{"uuid":"event-1"}',
      relatedIds: { orderUuid: 'order-1' },
      duplicateCount: 0,
    });
    expect(duplicate).toMatchObject({ duplicate: true, record: { duplicateCount: 1 } });
    await reopened.close();
  });

  it('atomically reserves one operation for an idempotency key', async () => {
    const store = new SqliteStore(':memory:');
    const operation = {
      idempotencyKey: 'operation-1',
      requestHash: 'request-hash',
      tool: 'sezzle_capture_order',
      targetId: 'order-1',
      status: 'in_progress' as const,
      createdAt: '2026-07-16T12:00:00Z',
    };

    expect((await store.reserveOperation(operation)).reserved).toBe(true);
    expect((await store.reserveOperation(operation)).reserved).toBe(false);
    await store.close();
  });
});
