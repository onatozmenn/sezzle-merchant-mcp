import { describe, expect, it } from 'vitest';

import { AuditLog } from '../../src/services/audit-log.js';
import { MutationGuard } from '../../src/services/mutation-guard.js';
import { MemoryStore } from '../../src/storage/memory-store.js';

const identity = {
  tool: 'sezzle_capture_order',
  merchantId: 'merchant-1',
  environment: 'sandbox' as const,
  targetType: 'order',
  targetId: 'order-1',
};

const createHarness = () => {
  const storage = new MemoryStore();
  let id = 0;
  const idFactory = () => `id-${String((id += 1))}`;
  const now = () => new Date('2026-07-16T12:00:00Z');
  const audit = new AuditLog(storage, now, idFactory);
  const guard = new MutationGuard(storage, audit, 300, now, idFactory);
  return { storage, guard };
};

const createPreview = (guard: MutationGuard) =>
  guard.createPreview({
    ...identity,
    request: { amount: { amount_in_cents: 500, currency: 'USD' } },
    currentState: { remaining: 1_000 },
    requestedChange: { capture: 500 },
    financialImpact: { remainingAfter: 500 },
    validation: { valid: true, code: 'VALID', message: 'Valid.' },
    warnings: ['Financial mutation'],
  });

describe('mutation confirmation guard', () => {
  it('never executes without literal confirm true and creates a rejection audit', async () => {
    const { storage, guard } = createHarness();
    const preview = await createPreview(guard);

    await expect(
      guard.confirmPreview({
        ...identity,
        confirm: false,
        previewId: preview.previewId,
        request: { amount: { amount_in_cents: 500, currency: 'USD' } },
        currentState: { remaining: 1_000 },
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' });
    const audits = await storage.listAudits({ result: 'rejected', limit: 10 });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.errorCode).toBe('CONFIRMATION_REQUIRED');
  });

  it('rejects a request changed after preview', async () => {
    const { guard } = createHarness();
    const preview = await createPreview(guard);

    await expect(
      guard.confirmPreview({
        ...identity,
        confirm: true,
        previewId: preview.previewId,
        request: { amount: { amount_in_cents: 501, currency: 'USD' } },
        currentState: { remaining: 1_000 },
      }),
    ).rejects.toMatchObject({ code: 'PREVIEW_REQUEST_MISMATCH' });
  });

  it('rejects stale current state', async () => {
    const { guard } = createHarness();
    const preview = await createPreview(guard);

    await expect(
      guard.confirmPreview({
        ...identity,
        confirm: true,
        previewId: preview.previewId,
        request: { amount: { amount_in_cents: 500, currency: 'USD' } },
        currentState: { remaining: 999 },
      }),
    ).rejects.toMatchObject({ code: 'STATE_CHANGED_SINCE_PREVIEW' });
  });

  it('consumes a valid preview once and rejects duplicate execution', async () => {
    const { storage, guard } = createHarness();
    const preview = await createPreview(guard);
    const input = {
      ...identity,
      confirm: true,
      previewId: preview.previewId,
      request: { amount: { amount_in_cents: 500, currency: 'USD' } },
      currentState: { remaining: 1_000 },
    };

    const confirmed = await guard.confirmPreview(input);
    const auditId = await guard.recordSuccess(confirmed, 'capture-1');

    expect(auditId).toBeTruthy();
    await expect(guard.confirmPreview(input)).rejects.toMatchObject({
      code: 'DUPLICATE_OPERATION',
    });
    expect((await storage.getPreview(preview.previewId))?.consumedAt).toBeDefined();
  });
});
