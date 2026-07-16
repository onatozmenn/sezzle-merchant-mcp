import { z } from 'zod';

import { currencySchema } from '../../domain/money.js';
import { dateTimeSchema, resourceIdSchema } from './common.js';

export const orderReportItemSchema = z
  .object({
    created_at: dateTimeSchema,
    order_uuid: resourceIdSchema,
    order_platform_uuid: z.string().optional(),
    external_reference_id: z.string().optional(),
    customer_currency_code: currencySchema,
    merchant_currency_code: currencySchema,
    order_amount_in_cents: z.number().int(),
    captured_amount_in_cents: z.number().int(),
    uncaptured_amount_in_cents: z.number().int(),
    total_fees_in_cents: z.number().int(),
    net_amount_in_cents: z.number().int(),
    refund_fee_in_cents: z.number().int().optional(),
    released_amount_in_cents: z.number().int().optional(),
    order_type: z.string(),
    financing_option: z.string().optional(),
  })
  .strip()
  .transform((item) => ({
    createdAt: item.created_at,
    orderUuid: item.order_uuid,
    ...(item.order_platform_uuid === undefined
      ? {}
      : { orderPlatformUuid: item.order_platform_uuid }),
    ...(item.external_reference_id === undefined
      ? {}
      : { externalReferenceId: item.external_reference_id }),
    customerCurrency: item.customer_currency_code,
    merchantCurrency: item.merchant_currency_code,
    orderAmountInCents: item.order_amount_in_cents,
    capturedAmountInCents: item.captured_amount_in_cents,
    uncapturedAmountInCents: item.uncaptured_amount_in_cents,
    totalFeesInCents: item.total_fees_in_cents,
    netAmountInCents: item.net_amount_in_cents,
    ...(item.refund_fee_in_cents === undefined
      ? {}
      : { refundFeeInCents: item.refund_fee_in_cents }),
    ...(item.released_amount_in_cents === undefined
      ? {}
      : { releasedAmountInCents: item.released_amount_in_cents }),
    orderType: item.order_type,
    ...(item.financing_option === undefined ? {} : { financingOption: item.financing_option }),
  }));

export const orderReportSchema = z.array(orderReportItemSchema);
export type OrderReportItem = z.infer<typeof orderReportItemSchema>;
