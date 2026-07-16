import { describe, expect, it } from 'vitest';

import {
  parseInterestActivity,
  parseInterestBalance,
  parseSettlementDetails,
  parseSettlementSummaries,
} from '../../src/domain/settlement.js';
import { orderReportSchema } from '../../src/api/schemas/reports.js';

describe('Sezzle report parsers', () => {
  it('parses settlement summary floats losslessly into minor units', () => {
    const summaries = parseSettlementSummaries(`[
      {
        "uuid": "payout-1",
        "payout_currency": "USD",
        "settlement_currency": "USD",
        "payout_date": "2026-07-15T00:00:00Z",
        "final_payout_amount": 950.80,
        "net_settlement_amount": 693.61,
        "forex_fees": 0.00,
        "status": "Complete"
      }
    ]`);

    expect(summaries[0]).toMatchObject({
      finalPayoutAmount: { amount_in_cents: 95_080, currency: 'USD' },
      netSettlementAmount: { amount_in_cents: 69_361, currency: 'USD' },
    });
  });

  it('parses the documented multi-section settlement CSV', () => {
    const details = parseSettlementDetails(
      [
        'total_order_amount,total_capture_amount,total_refund_amount,total_fee_amount,total_returned_fee_amount,net_settlement_amount,payment_uuid,settlement_currency,payout_date,payout_status,final_payout_amount,payout_currency',
        '703.20,703.20,-5.00,-43.80,.30,654.70,payout-1,USD,2026-07-15T00:00:00Z,Complete,654.70,USD',
        'type,event_date,order_uuid,external_reference_id,order_amount,amount,posting_currency,type_code,sezzle_order_id',
        'ORDER,2026-07-14T10:00:00Z,order-1,merchant-1,500.00,,USD,001,sezzle-1',
        'FEE,2026-07-14T10:00:00Z,order-1,merchant-1,,-30.00,USD,003,sezzle-1',
        'CORRECTION,2026-07-14T11:00:00Z,,,,1.50,,007,',
      ].join('\n'),
    );

    expect(details.summary.totals['total_fee_amount']?.amount_in_cents).toBe(-4_380);
    expect(details.lineItems[0]).toMatchObject({ orderAmountInCents: 50_000, currency: 'USD' });
    expect(details.lineItems[2]).toMatchObject({ amountInCents: 150, currency: 'USD' });
  });

  it('preserves interest fractions of a cent at scale four', () => {
    const balance = parseInterestBalance('{"interest_balance":5183.4624}', 'USD');
    const activity = parseInterestActivity(
      [
        'type,event_date,interest_account_change_amount,interest_account_balance_after_change',
        'INTEREST_ACCRUAL,2026-07-15T00:00:00Z,1.0702,5183.4624',
      ].join('\n'),
    );

    expect(balance.balanceInTenThousandths).toBe('51834624');
    expect(activity[0]?.changeInTenThousandths).toBe('10702');
  });

  it('strips customer PII from order reports', () => {
    const report = orderReportSchema.parse([
      {
        created_at: '2026-07-15T00:00:00Z',
        order_uuid: 'order-1',
        customer_name: 'Private Person',
        customer_email: 'private@example.com',
        customer_currency_code: 'USD',
        merchant_currency_code: 'USD',
        order_amount_in_cents: 10_000,
        captured_amount_in_cents: 10_000,
        uncaptured_amount_in_cents: 0,
        total_fees_in_cents: 600,
        net_amount_in_cents: 9_400,
        order_type: 'Standard Checkout',
      },
    ]);

    expect(report[0]).not.toHaveProperty('customer_name');
    expect(report[0]).not.toHaveProperty('customerEmail');
  });
});
