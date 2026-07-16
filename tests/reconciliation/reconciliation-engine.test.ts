import { describe, expect, it } from 'vitest';

import {
  ReconciliationEngine,
  reconciliationInputSchema,
} from '../../src/domain/reconciliation.js';

const input = reconciliationInputSchema.parse({
  currency: 'USD',
  merchant_orders: [
    {
      record_id: 'merchant-1',
      order_reference: 'ref-1',
      sezzle_order_uuid: 'order-1',
      currency: 'USD',
      order_amount_in_cents: 10_000,
      captured_amount_in_cents: 8_000,
      refunded_amount_in_cents: 1_000,
      expected_fee_in_cents: 480,
    },
    {
      record_id: 'merchant-2',
      order_reference: 'ref-missing',
      currency: 'USD',
      order_amount_in_cents: 2_000,
      captured_amount_in_cents: 0,
      refunded_amount_in_cents: 0,
    },
  ],
  sezzle_records: [
    {
      record_id: 'record-order-1',
      type: 'ORDER',
      order_uuid: 'order-1',
      external_reference_id: 'ref-1',
      order_amount_in_cents: 10_000,
      currency: 'USD',
    },
    {
      record_id: 'record-capture-1',
      type: 'CAPTURE',
      order_uuid: 'order-1',
      external_reference_id: 'ref-1',
      amount_in_cents: 8_000,
      currency: 'USD',
    },
    {
      record_id: 'record-refund-1',
      type: 'REFUND',
      order_uuid: 'order-1',
      external_reference_id: 'ref-1',
      amount_in_cents: 1_000,
      currency: 'USD',
    },
    {
      record_id: 'record-fee-1',
      type: 'FEE',
      order_uuid: 'order-1',
      external_reference_id: 'ref-1',
      amount_in_cents: -480,
      currency: 'USD',
    },
    {
      record_id: 'record-correction-1',
      type: 'CORRECTION',
      amount_in_cents: 100,
      currency: 'USD',
    },
  ],
  actual_settlement: { amount_in_cents: 6_620, currency: 'USD' },
  fee_tolerance_in_cents: 0,
});

describe('ReconciliationEngine', () => {
  it('matches captures, refunds, fees, and deterministic payout totals', () => {
    const result = new ReconciliationEngine().reconcile(input);

    expect(result.summary).toMatchObject({
      matchedOrderCount: 1,
      unmatchedMerchantCount: 1,
      expectedPayoutInCents: 6_620,
      actualPayoutInCents: 6_620,
      payoutDifferenceInCents: 0,
    });
    expect(result.amountMismatches).toEqual([]);
    expect(result.feeAnomalies).toEqual([]);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it('detects capture and refund mismatches with traceable evidence', () => {
    const firstMerchant = input.merchantOrders[0];
    if (firstMerchant === undefined) throw new Error('Expected merchant fixture.');
    const mismatched = {
      ...input,
      merchantOrders: [
        {
          ...firstMerchant,
          capturedAmountInCents: 7_900,
          refundedAmountInCents: 900,
        },
      ],
    };
    const result = new ReconciliationEngine().reconcile(mismatched);

    expect(result.amountMismatches.map((item) => item.code)).toEqual(
      expect.arrayContaining(['CAPTURE_AMOUNT_MISMATCH', 'REFUND_AMOUNT_MISMATCH']),
    );
    expect(result.amountMismatches.every((item) => item.evidenceIds.length > 0)).toBe(true);
  });

  it('deduplicates repeated settlement records before payout arithmetic', () => {
    const firstMerchant = input.merchantOrders[0];
    if (firstMerchant === undefined) throw new Error('Expected merchant fixture.');
    const duplicate = input.sezzleRecords.find((record) => record.recordId === 'record-fee-1');
    if (duplicate === undefined) throw new Error('Expected fee fixture.');
    const result = new ReconciliationEngine().reconcile({
      ...input,
      merchantOrders: [firstMerchant],
      sezzleRecords: [...input.sezzleRecords, { ...duplicate, recordId: 'record-fee-copy' }],
    });

    expect(result.summary.duplicateRecordCount).toBe(1);
    expect(result.summary.expectedPayoutInCents).toBe(6_620);
  });

  it('produces deterministic focused views and payout explanations', () => {
    const engine = new ReconciliationEngine();

    expect(engine.findUnmatchedOrders(input).unmatchedMerchantRecords).toHaveLength(1);
    expect(engine.detectCaptureMismatches(input).mismatches).toEqual([]);
    expect(engine.detectRefundMismatches(input).mismatches).toEqual([]);
    expect(engine.detectFeeAnomalies(input).feeAnomalies).toEqual([]);
    expect(engine.explainPayoutDifference(input).differenceInCents).toBe(0);
    expect(engine.generateFinanceDailyBrief(input).payoutBalanced).toBe(true);
  });
});
