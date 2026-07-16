import { parse as parseCsv } from 'csv-parse/sync';
import { isLosslessNumber, parse as parseLosslessJson } from 'lossless-json';

import { SezzleOpsError } from '../api/errors.js';
import { currencySchema, type Currency } from './money.js';
import {
  formatScaledUnits,
  parseDecimalToScaledUnits,
  scaledUnitsToSafeNumber,
} from './decimal.js';

export interface SignedMoneyJson {
  readonly amount_in_cents: number;
  readonly currency: Currency;
}

export interface SettlementSummary {
  readonly uuid: string;
  readonly payoutCurrency: Currency;
  readonly settlementCurrency: Currency;
  readonly payoutDate: string;
  readonly finalPayoutAmount: SignedMoneyJson | undefined;
  readonly netSettlementAmount: SignedMoneyJson;
  readonly forexFees: SignedMoneyJson;
  readonly status: string;
}

export interface SettlementDetailSummary {
  readonly paymentUuid: string;
  readonly settlementCurrency: Currency;
  readonly payoutDate: string;
  readonly payoutStatus: string;
  readonly payoutCurrency: Currency;
  readonly netSettlementAmount: SignedMoneyJson;
  readonly finalPayoutAmount: SignedMoneyJson;
  readonly totals: Readonly<Record<string, SignedMoneyJson>>;
}

export interface SettlementLineItem {
  readonly recordId: string;
  readonly type: string;
  readonly eventDate: string | undefined;
  readonly orderUuid: string | undefined;
  readonly externalReferenceId: string | undefined;
  readonly sezzleOrderId: string | undefined;
  readonly orderAmountInCents: number | undefined;
  readonly amountInCents: number | undefined;
  readonly currency: Currency;
  readonly typeCode: string | undefined;
}

export interface SettlementDetails {
  readonly summary: SettlementDetailSummary;
  readonly lineItems: readonly SettlementLineItem[];
}

const invalidResponse = (message: string): never => {
  throw new SezzleOpsError({
    code: 'SEZZLE_RESPONSE_INVALID',
    message,
    retryable: false,
    httpStatus: 502,
    details: {},
  });
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidResponse('Sezzle returned an invalid settlement object.');
  }
  return value as Readonly<Record<string, unknown>>;
};

const requiredString = (record: Readonly<Record<string, unknown>>, key: string): string => {
  const value = record[key];
  if (typeof value !== 'string' || value === '') {
    return invalidResponse(`Sezzle settlement response is missing ${key}.`);
  }
  return value;
};

const optionalDecimalString = (
  record: Readonly<Record<string, unknown>>,
  key: string,
): string | undefined => {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (isLosslessNumber(value)) return value.value;
  if (typeof value === 'string') return value;
  return invalidResponse(`Sezzle settlement response has invalid ${key}.`);
};

const requiredDecimalString = (record: Readonly<Record<string, unknown>>, key: string): string =>
  optionalDecimalString(record, key) ?? invalidResponse(`Missing decimal field ${key}.`);

const parseCurrency = (value: string): Currency => {
  const parsed = currencySchema.safeParse(value);
  if (!parsed.success) return invalidResponse(`Unsupported settlement currency ${value}.`);
  return parsed.data;
};

const signedMoney = (decimal: string, currency: Currency): SignedMoneyJson => ({
  amount_in_cents: scaledUnitsToSafeNumber(parseDecimalToScaledUnits(decimal, 2)),
  currency,
});

export const parseSettlementSummaries = (text: string): readonly SettlementSummary[] => {
  // OpenAPI declares settlement amounts as JSON floats. Parse response text
  // losslessly and convert decimal strings to minor units without Number math.
  let parsed: unknown;
  try {
    parsed = parseLosslessJson(text);
  } catch {
    return invalidResponse('Sezzle returned invalid settlement summary JSON.');
  }
  if (!Array.isArray(parsed))
    return invalidResponse('Settlement summary response must be an array.');
  return parsed.map((item) => {
    const record = asRecord(item);
    const payoutCurrency = parseCurrency(requiredString(record, 'payout_currency'));
    const settlementCurrency = parseCurrency(
      typeof record['settlement_currency'] === 'string'
        ? record['settlement_currency']
        : payoutCurrency,
    );
    const finalPayout = optionalDecimalString(record, 'final_payout_amount');
    return {
      uuid: requiredString(record, 'uuid'),
      payoutCurrency,
      settlementCurrency,
      payoutDate: requiredString(record, 'payout_date'),
      finalPayoutAmount:
        finalPayout === undefined ? undefined : signedMoney(finalPayout, payoutCurrency),
      netSettlementAmount: signedMoney(
        requiredDecimalString(record, 'net_settlement_amount'),
        settlementCurrency,
      ),
      forexFees: signedMoney(requiredDecimalString(record, 'forex_fees'), settlementCurrency),
      status: requiredString(record, 'status'),
    };
  });
};

const parseRows = (text: string): string[][] => {
  const rows: unknown = parseCsv(text, { relax_column_count: true, skip_empty_lines: true });
  if (
    !Array.isArray(rows) ||
    !rows.every((row) => Array.isArray(row) && row.every((cell) => typeof cell === 'string'))
  ) {
    return invalidResponse('Sezzle returned invalid settlement CSV.');
  }
  return rows;
};

const rowRecord = (headers: readonly string[], values: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    headers.map((header, index) => [header.trim().toLowerCase(), values[index] ?? '']),
  );

const csvValue = (record: Readonly<Record<string, string>>, key: string): string =>
  record[key]?.trim() ?? '';

const optionalCsvValue = (
  record: Readonly<Record<string, string>>,
  key: string,
): string | undefined => {
  const value = csvValue(record, key);
  return value === '' ? undefined : value;
};

const totalKeys = [
  'total_order_amount',
  'total_capture_amount',
  'total_refund_amount',
  'total_fee_amount',
  'total_returned_fee_amount',
  'total_chargeback_amount',
  'total_chargeback_reversal_amount',
  'total_interest_transfer_amount',
  'total_correction_amount',
  'total_referral_revenue_transfer_amount',
  'total_bank_account_withdrawals',
  'total_bank_account_withdrawal_reversals',
  'forex_fees',
] as const;

export const parseSettlementDetails = (text: string): SettlementDetails => {
  const rows = parseRows(text);
  if (rows.length < 3)
    return invalidResponse('Settlement CSV does not contain summary and line headers.');
  const summaryRecord = rowRecord(rows[0] ?? [], rows[1] ?? []);
  const settlementCurrency = parseCurrency(csvValue(summaryRecord, 'settlement_currency'));
  const payoutCurrency = parseCurrency(csvValue(summaryRecord, 'payout_currency'));
  const totals: Record<string, SignedMoneyJson> = {};
  for (const key of totalKeys) {
    const value = optionalCsvValue(summaryRecord, key);
    if (value !== undefined) totals[key] = signedMoney(value, settlementCurrency);
  }

  const lineHeaders = rows[2] ?? [];
  const lineItems = rows.slice(3).map((row, index): SettlementLineItem => {
    const record = rowRecord(lineHeaders, row);
    const postingCurrency = optionalCsvValue(record, 'posting_currency') ?? settlementCurrency;
    const currency = parseCurrency(postingCurrency);
    const orderAmount = optionalCsvValue(record, 'order_amount');
    const amount = optionalCsvValue(record, 'amount');
    return {
      recordId: `settlement-row-${String(index + 1)}`,
      type: csvValue(record, 'type').toUpperCase(),
      eventDate: optionalCsvValue(record, 'event_date'),
      orderUuid: optionalCsvValue(record, 'order_uuid'),
      externalReferenceId: optionalCsvValue(record, 'external_reference_id'),
      sezzleOrderId: optionalCsvValue(record, 'sezzle_order_id'),
      orderAmountInCents:
        orderAmount === undefined
          ? undefined
          : scaledUnitsToSafeNumber(parseDecimalToScaledUnits(orderAmount, 2)),
      amountInCents:
        amount === undefined
          ? undefined
          : scaledUnitsToSafeNumber(parseDecimalToScaledUnits(amount, 2)),
      currency,
      typeCode: optionalCsvValue(record, 'type_code'),
    };
  });

  return {
    summary: {
      paymentUuid: csvValue(summaryRecord, 'payment_uuid'),
      settlementCurrency,
      payoutDate: csvValue(summaryRecord, 'payout_date'),
      payoutStatus: csvValue(summaryRecord, 'payout_status'),
      payoutCurrency,
      netSettlementAmount: signedMoney(
        csvValue(summaryRecord, 'net_settlement_amount'),
        settlementCurrency,
      ),
      finalPayoutAmount: signedMoney(
        csvValue(summaryRecord, 'final_payout_amount'),
        payoutCurrency,
      ),
      totals,
    },
    lineItems,
  };
};

export interface InterestBalance {
  readonly currency: Currency;
  readonly balanceDecimal: string;
  readonly balanceInTenThousandths: string;
  readonly scale: 4;
}

export const parseInterestBalance = (text: string, currency: Currency): InterestBalance => {
  let parsed: unknown;
  try {
    parsed = parseLosslessJson(text);
  } catch {
    return invalidResponse('Sezzle returned invalid interest balance JSON.');
  }
  const record = asRecord(parsed);
  const decimal = requiredDecimalString(record, 'interest_balance');
  const units = parseDecimalToScaledUnits(decimal, 4);
  return {
    currency,
    balanceDecimal: formatScaledUnits(units, 4),
    balanceInTenThousandths: units.toString(),
    scale: 4,
  };
};

export interface InterestActivityItem {
  readonly type: string;
  readonly eventDate: string;
  readonly changeDecimal: string;
  readonly balanceAfterDecimal: string;
  readonly changeInTenThousandths: string;
  readonly balanceAfterInTenThousandths: string;
  readonly scale: 4;
}

export const parseInterestActivity = (text: string): readonly InterestActivityItem[] => {
  const rows = parseRows(text);
  if (rows.length === 0) return [];
  const headers = rows[0] ?? [];
  return rows.slice(1).map((row) => {
    const record = rowRecord(headers, row);
    const change = parseDecimalToScaledUnits(csvValue(record, 'interest_account_change_amount'), 4);
    const balance = parseDecimalToScaledUnits(
      csvValue(record, 'interest_account_balance_after_change'),
      4,
    );
    return {
      type: csvValue(record, 'type'),
      eventDate: csvValue(record, 'event_date'),
      changeDecimal: formatScaledUnits(change, 4),
      balanceAfterDecimal: formatScaledUnits(balance, 4),
      changeInTenThousandths: change.toString(),
      balanceAfterInTenThousandths: balance.toString(),
      scale: 4,
    };
  });
};
