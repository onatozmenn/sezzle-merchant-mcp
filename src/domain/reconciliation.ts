import { z } from 'zod';

import { currencySchema, moneyInputSchema, type Currency } from './money.js';
import { scaledUnitsToSafeNumber } from './decimal.js';
import { sha256Hash } from '../utils/canonical-json.js';

const merchantOrderSchema = z
  .object({
    record_id: z.string().trim().min(1).max(255),
    order_reference: z.string().trim().min(1).max(255),
    sezzle_order_uuid: z.string().trim().min(1).max(255).optional(),
    currency: currencySchema,
    order_amount_in_cents: z.number().int().nonnegative(),
    captured_amount_in_cents: z.number().int().nonnegative(),
    refunded_amount_in_cents: z.number().int().nonnegative(),
    expected_fee_in_cents: z.number().int().nonnegative().optional(),
  })
  .strict()
  .transform((record) => ({
    recordId: record.record_id,
    orderReference: record.order_reference,
    ...(record.sezzle_order_uuid === undefined
      ? {}
      : { sezzleOrderUuid: record.sezzle_order_uuid }),
    currency: record.currency,
    orderAmountInCents: record.order_amount_in_cents,
    capturedAmountInCents: record.captured_amount_in_cents,
    refundedAmountInCents: record.refunded_amount_in_cents,
    ...(record.expected_fee_in_cents === undefined
      ? {}
      : { expectedFeeInCents: record.expected_fee_in_cents }),
  }));

export const settlementRecordTypeSchema = z.enum([
  'ORDER',
  'CAPTURE',
  'REFUND',
  'FEE',
  'RETURNED_FEE',
  'CHARGEBACK',
  'CHARGEBACK_REVERSAL',
  'CORRECTION',
  'INTEREST_TRANSFER',
  'REFERRAL_REVENUE_TRANSFER',
  'BANK_ACCOUNT_WITHDRAWAL',
  'BANK_ACCOUNT_WITHDRAWAL_REVERSAL',
  'MONTHLY_FEE',
  'MONTHLY_FEE_REFUND',
]);

const sezzleRecordSchema = z
  .object({
    record_id: z.string().trim().min(1).max(255),
    type: settlementRecordTypeSchema,
    order_uuid: z.string().trim().min(1).max(255).optional(),
    external_reference_id: z.string().trim().min(1).max(255).optional(),
    amount_in_cents: z.number().int().optional(),
    order_amount_in_cents: z.number().int().nonnegative().optional(),
    currency: currencySchema,
    event_date: z.string().optional(),
  })
  .strict()
  .transform((record) => ({
    recordId: record.record_id,
    type: record.type,
    ...(record.order_uuid === undefined ? {} : { orderUuid: record.order_uuid }),
    ...(record.external_reference_id === undefined
      ? {}
      : { externalReferenceId: record.external_reference_id }),
    ...(record.amount_in_cents === undefined ? {} : { amountInCents: record.amount_in_cents }),
    ...(record.order_amount_in_cents === undefined
      ? {}
      : { orderAmountInCents: record.order_amount_in_cents }),
    currency: record.currency,
    ...(record.event_date === undefined ? {} : { eventDate: record.event_date }),
  }));

const rawReconciliationInputSchema = z
  .object({
    currency: currencySchema,
    merchant_orders: z.array(merchantOrderSchema).max(25_000),
    sezzle_records: z.array(sezzleRecordSchema).max(100_000),
    actual_settlement: moneyInputSchema,
    fee_tolerance_in_cents: z.number().int().nonnegative().default(0),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.actual_settlement.currency !== input.currency) {
      context.addIssue({
        code: 'custom',
        path: ['actual_settlement', 'currency'],
        message: 'Actual settlement currency must match reconciliation currency.',
      });
    }
    input.merchant_orders.forEach((record, index) => {
      if (record.currency !== input.currency) {
        context.addIssue({
          code: 'custom',
          path: ['merchant_orders', index, 'currency'],
          message: 'Merchant record currency must match reconciliation currency.',
        });
      }
    });
    input.sezzle_records.forEach((record, index) => {
      if (record.currency !== input.currency) {
        context.addIssue({
          code: 'custom',
          path: ['sezzle_records', index, 'currency'],
          message: 'Sezzle record currency must match reconciliation currency.',
        });
      }
    });
  });

export const reconciliationInputSchema = rawReconciliationInputSchema.transform((input) => ({
  currency: input.currency,
  merchantOrders: input.merchant_orders,
  sezzleRecords: input.sezzle_records,
  actualSettlement: input.actual_settlement,
  feeToleranceInCents: input.fee_tolerance_in_cents,
}));

export type ReconciliationInput = z.infer<typeof reconciliationInputSchema>;
type MerchantOrder = ReconciliationInput['merchantOrders'][number];
type SezzleRecord = ReconciliationInput['sezzleRecords'][number];

export interface ReconciliationEvidence {
  readonly evidenceId: string;
  readonly kind: string;
  readonly description: string;
  readonly recordIds: readonly string[];
  readonly amountInCents?: number;
  readonly currency?: Currency;
}

export interface AmountMismatch {
  readonly code: string;
  readonly merchantRecordId: string;
  readonly orderReference: string;
  readonly merchantAmountInCents: number;
  readonly sezzleAmountInCents: number;
  readonly differenceInCents: number;
  readonly currency: Currency;
  readonly evidenceIds: readonly string[];
}

export interface FeeAnomaly {
  readonly code: 'FEE_AMOUNT_MISMATCH';
  readonly merchantRecordId: string;
  readonly orderReference: string;
  readonly expectedFeeInCents: number;
  readonly actualFeeInCents: number;
  readonly differenceInCents: number;
  readonly currency: Currency;
  readonly evidenceIds: readonly string[];
}

export interface ReconciliationResult {
  readonly summary: {
    readonly currency: Currency;
    readonly merchantRecordCount: number;
    readonly sezzleRecordCount: number;
    readonly matchedOrderCount: number;
    readonly unmatchedMerchantCount: number;
    readonly unmatchedSezzleCount: number;
    readonly duplicateRecordCount: number;
    readonly expectedPayoutInCents: number;
    readonly actualPayoutInCents: number;
    readonly payoutDifferenceInCents: number;
  };
  readonly matched: readonly {
    readonly merchantRecordId: string;
    readonly orderReference: string;
    readonly sezzleRecordIds: readonly string[];
    readonly evidenceIds: readonly string[];
  }[];
  readonly unmatchedMerchantRecords: readonly MerchantOrder[];
  readonly unmatchedSezzleRecords: readonly SezzleRecord[];
  readonly amountMismatches: readonly AmountMismatch[];
  readonly feeAnomalies: readonly FeeAnomaly[];
  readonly confidence: number;
  readonly evidence: readonly ReconciliationEvidence[];
  readonly duplicateRecords: readonly SezzleRecord[];
}

const absolute = (value: bigint): bigint => (value < 0n ? -value : value);

const orderKeyForSezzle = (record: SezzleRecord): string | undefined => {
  if (record.orderUuid !== undefined) return `uuid:${record.orderUuid}`;
  if (record.externalReferenceId !== undefined) return `reference:${record.externalReferenceId}`;
  return undefined;
};

const recordFingerprint = (record: SezzleRecord): string =>
  sha256Hash({
    type: record.type,
    orderUuid: record.orderUuid,
    externalReferenceId: record.externalReferenceId,
    amountInCents: record.amountInCents,
    orderAmountInCents: record.orderAmountInCents,
    currency: record.currency,
    eventDate: record.eventDate,
  });

const sumAmounts = (
  records: readonly SezzleRecord[],
  type: SezzleRecord['type'],
  field: 'amountInCents' | 'orderAmountInCents' = 'amountInCents',
): bigint => {
  let total = 0n;
  for (const record of records) {
    if (record.type !== type) continue;
    const value = record[field];
    if (value !== undefined) total += BigInt(value);
  }
  return total;
};

const payoutContribution = (record: SezzleRecord): bigint => {
  const amount = BigInt(record.amountInCents ?? 0);
  switch (record.type) {
    case 'REFUND':
    case 'FEE':
    case 'CHARGEBACK':
    case 'MONTHLY_FEE':
      return -absolute(amount);
    case 'RETURNED_FEE':
    case 'CHARGEBACK_REVERSAL':
    case 'MONTHLY_FEE_REFUND':
      return absolute(amount);
    case 'CORRECTION':
    case 'INTEREST_TRANSFER':
    case 'REFERRAL_REVENUE_TRANSFER':
    case 'BANK_ACCOUNT_WITHDRAWAL':
    case 'BANK_ACCOUNT_WITHDRAWAL_REVERSAL':
      return amount;
    case 'ORDER':
    case 'CAPTURE':
      return 0n;
  }
};

const differenceNumber = (left: bigint, right: bigint): number =>
  scaledUnitsToSafeNumber(left - right);

const recordsForMerchant = (
  merchant: MerchantOrder,
  records: readonly SezzleRecord[],
): readonly SezzleRecord[] =>
  records.filter(
    (record) =>
      (merchant.sezzleOrderUuid !== undefined && record.orderUuid === merchant.sezzleOrderUuid) ||
      record.externalReferenceId === merchant.orderReference,
  );

const financialTotals = (records: readonly SezzleRecord[]) => {
  const captures = absolute(sumAmounts(records, 'CAPTURE'));
  const orderFallback = absolute(sumAmounts(records, 'ORDER', 'orderAmountInCents'));
  const refunds = absolute(sumAmounts(records, 'REFUND'));
  const feeNet =
    -absolute(sumAmounts(records, 'FEE')) + absolute(sumAmounts(records, 'RETURNED_FEE'));
  return {
    captures: captures === 0n ? orderFallback : captures,
    refunds,
    feeCost: feeNet < 0n ? -feeNet : 0n,
    orderAmount: orderFallback,
  };
};

export class ReconciliationEngine {
  public reconcile(rawInput: ReconciliationInput): ReconciliationResult {
    const input = rawInput;
    const evidence: ReconciliationEvidence[] = [];
    let evidenceSequence = 0;
    const addEvidence = (
      kind: string,
      description: string,
      recordIds: readonly string[],
      amount?: bigint,
    ): string => {
      const evidenceId = `evidence-${String((evidenceSequence += 1))}`;
      evidence.push({
        evidenceId,
        kind,
        description,
        recordIds,
        ...(amount === undefined
          ? {}
          : {
              amountInCents: scaledUnitsToSafeNumber(amount),
              currency: input.currency,
            }),
      });
      return evidenceId;
    };

    const uniqueRecords: SezzleRecord[] = [];
    const duplicateRecords: SezzleRecord[] = [];
    const seenIds = new Set<string>();
    const seenFingerprints = new Set<string>();
    for (const record of input.sezzleRecords) {
      const fingerprint = recordFingerprint(record);
      if (seenIds.has(record.recordId) || seenFingerprints.has(fingerprint)) {
        duplicateRecords.push(record);
        addEvidence('duplicate', 'Duplicate Sezzle settlement record excluded from totals.', [
          record.recordId,
        ]);
        continue;
      }
      seenIds.add(record.recordId);
      seenFingerprints.add(fingerprint);
      uniqueRecords.push(record);
    }

    const matched: ReconciliationResult['matched'][number][] = [];
    const unmatchedMerchantRecords: MerchantOrder[] = [];
    const amountMismatches: AmountMismatch[] = [];
    const feeAnomalies: FeeAnomaly[] = [];
    const usedSezzleRecordIds = new Set<string>();

    for (const merchant of input.merchantOrders) {
      const records = recordsForMerchant(merchant, uniqueRecords);
      if (records.length === 0) {
        unmatchedMerchantRecords.push(merchant);
        addEvidence(
          'unmatched_merchant',
          'No Sezzle settlement records matched this merchant order.',
          [merchant.recordId],
        );
        continue;
      }
      for (const record of records) usedSezzleRecordIds.add(record.recordId);
      const totals = financialTotals(records);
      const matchEvidence = addEvidence(
        'order_match',
        'Merchant order matched to Sezzle records by order UUID or external reference.',
        [merchant.recordId, ...records.map((record) => record.recordId)],
      );
      matched.push({
        merchantRecordId: merchant.recordId,
        orderReference: merchant.orderReference,
        sezzleRecordIds: records.map((record) => record.recordId),
        evidenceIds: [matchEvidence],
      });

      const comparisons = [
        {
          code: 'ORDER_AMOUNT_MISMATCH',
          merchant: BigInt(merchant.orderAmountInCents),
          sezzle: totals.orderAmount,
        },
        {
          code: 'CAPTURE_AMOUNT_MISMATCH',
          merchant: BigInt(merchant.capturedAmountInCents),
          sezzle: totals.captures,
        },
        {
          code: 'REFUND_AMOUNT_MISMATCH',
          merchant: BigInt(merchant.refundedAmountInCents),
          sezzle: totals.refunds,
        },
      ];
      for (const comparison of comparisons) {
        if (comparison.merchant === comparison.sezzle) continue;
        const mismatchEvidence = addEvidence(
          'amount_mismatch',
          comparison.code,
          [merchant.recordId, ...records.map((record) => record.recordId)],
          comparison.sezzle - comparison.merchant,
        );
        amountMismatches.push({
          code: comparison.code,
          merchantRecordId: merchant.recordId,
          orderReference: merchant.orderReference,
          merchantAmountInCents: scaledUnitsToSafeNumber(comparison.merchant),
          sezzleAmountInCents: scaledUnitsToSafeNumber(comparison.sezzle),
          differenceInCents: differenceNumber(comparison.sezzle, comparison.merchant),
          currency: input.currency,
          evidenceIds: [mismatchEvidence],
        });
      }

      if (merchant.expectedFeeInCents !== undefined) {
        const expectedFee = BigInt(merchant.expectedFeeInCents);
        const difference = totals.feeCost - expectedFee;
        if (absolute(difference) > BigInt(input.feeToleranceInCents)) {
          const feeEvidence = addEvidence(
            'fee_anomaly',
            'Net Sezzle fee differs from the merchant expectation.',
            [merchant.recordId, ...records.map((record) => record.recordId)],
            difference,
          );
          feeAnomalies.push({
            code: 'FEE_AMOUNT_MISMATCH',
            merchantRecordId: merchant.recordId,
            orderReference: merchant.orderReference,
            expectedFeeInCents: merchant.expectedFeeInCents,
            actualFeeInCents: scaledUnitsToSafeNumber(totals.feeCost),
            differenceInCents: scaledUnitsToSafeNumber(difference),
            currency: input.currency,
            evidenceIds: [feeEvidence],
          });
        }
      }
    }

    const unmatchedSezzleRecords = uniqueRecords.filter(
      (record) =>
        orderKeyForSezzle(record) !== undefined && !usedSezzleRecordIds.has(record.recordId),
    );
    for (const record of unmatchedSezzleRecords) {
      addEvidence('unmatched_sezzle', 'No merchant order matched this Sezzle record.', [
        record.recordId,
      ]);
    }

    const grouped = new Map<string, SezzleRecord[]>();
    const adjustments: SezzleRecord[] = [];
    for (const record of uniqueRecords) {
      const key = orderKeyForSezzle(record);
      if (key === undefined) {
        adjustments.push(record);
      } else {
        const group = grouped.get(key) ?? [];
        group.push(record);
        grouped.set(key, group);
      }
    }
    let expectedPayout = 0n;
    for (const records of grouped.values()) {
      expectedPayout += financialTotals(records).captures;
      for (const record of records) expectedPayout += payoutContribution(record);
    }
    for (const record of adjustments) expectedPayout += payoutContribution(record);
    const actualPayout = BigInt(input.actualSettlement.amount_in_cents);
    const payoutDifference = actualPayout - expectedPayout;
    addEvidence(
      'payout_total',
      'Expected payout calculated from deduplicated captures, refunds, fees, chargebacks, and adjustments.',
      uniqueRecords.map((record) => record.recordId),
      expectedPayout,
    );

    const confidenceDenominator = input.merchantOrders.length + unmatchedSezzleRecords.length;
    const confidenceBasisPoints =
      confidenceDenominator === 0
        ? 10_000n
        : (BigInt(matched.length) * 10_000n) / BigInt(confidenceDenominator);

    return {
      summary: {
        currency: input.currency,
        merchantRecordCount: input.merchantOrders.length,
        sezzleRecordCount: input.sezzleRecords.length,
        matchedOrderCount: matched.length,
        unmatchedMerchantCount: unmatchedMerchantRecords.length,
        unmatchedSezzleCount: unmatchedSezzleRecords.length,
        duplicateRecordCount: duplicateRecords.length,
        expectedPayoutInCents: scaledUnitsToSafeNumber(expectedPayout),
        actualPayoutInCents: scaledUnitsToSafeNumber(actualPayout),
        payoutDifferenceInCents: scaledUnitsToSafeNumber(payoutDifference),
      },
      matched,
      unmatchedMerchantRecords,
      unmatchedSezzleRecords,
      amountMismatches,
      feeAnomalies,
      confidence: Number(confidenceBasisPoints) / 10_000,
      evidence,
      duplicateRecords,
    };
  }

  public findUnmatchedOrders(input: ReconciliationInput) {
    const result = this.reconcile(input);
    return {
      summary: result.summary,
      unmatchedMerchantRecords: result.unmatchedMerchantRecords,
      unmatchedSezzleRecords: result.unmatchedSezzleRecords,
      confidence: result.confidence,
      evidence: result.evidence.filter((item) => item.kind.startsWith('unmatched')),
    };
  }

  public detectRefundMismatches(input: ReconciliationInput) {
    const result = this.reconcile(input);
    return {
      mismatches: result.amountMismatches.filter((item) => item.code === 'REFUND_AMOUNT_MISMATCH'),
      evidence: result.evidence,
    };
  }

  public detectCaptureMismatches(input: ReconciliationInput) {
    const result = this.reconcile(input);
    return {
      mismatches: result.amountMismatches.filter((item) => item.code === 'CAPTURE_AMOUNT_MISMATCH'),
      evidence: result.evidence,
    };
  }

  public detectFeeAnomalies(input: ReconciliationInput) {
    const result = this.reconcile(input);
    return { feeAnomalies: result.feeAnomalies, evidence: result.evidence };
  }

  public explainPayoutDifference(input: ReconciliationInput) {
    const result = this.reconcile(input);
    const difference = result.summary.payoutDifferenceInCents;
    const explanation =
      difference === 0
        ? 'Actual settlement equals the deterministic expected payout.'
        : `Actual settlement differs from the deterministic expected payout by ${String(difference)} minor units.`;
    return {
      expectedPayoutInCents: result.summary.expectedPayoutInCents,
      actualPayoutInCents: result.summary.actualPayoutInCents,
      differenceInCents: difference,
      currency: result.summary.currency,
      explanation,
      contributingMismatchCount:
        result.amountMismatches.length +
        result.feeAnomalies.length +
        result.summary.unmatchedSezzleCount,
      evidence: result.evidence,
    };
  }

  public generateFinanceDailyBrief(input: ReconciliationInput) {
    const result = this.reconcile(input);
    return {
      summary: result.summary,
      highPriority: [
        ...result.amountMismatches.filter(
          (item) =>
            item.code === 'CAPTURE_AMOUNT_MISMATCH' || item.code === 'REFUND_AMOUNT_MISMATCH',
        ),
        ...result.feeAnomalies,
      ],
      unmatchedMerchantOrders: result.unmatchedMerchantRecords.length,
      duplicateRecords: result.duplicateRecords.length,
      payoutBalanced: result.summary.payoutDifferenceInCents === 0,
      evidence: result.evidence,
    };
  }
}
