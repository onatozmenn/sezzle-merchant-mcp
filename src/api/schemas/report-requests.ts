import { z } from 'zod';

import { currencySchema } from '../../domain/money.js';

const dateSchema = z.iso.date();

const dateRange = z
  .object({
    startDate: dateSchema,
    endDate: dateSchema,
  })
  .strict()
  .superRefine((range, context) => {
    if (range.endDate < range.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'End date precedes start date.',
      });
    }
  });

export const settlementSummaryQuerySchema = dateRange.extend({
  offset: z.number().int().nonnegative().default(0),
  currency: currencySchema.default('USD'),
});

export type SettlementSummaryQuery = z.infer<typeof settlementSummaryQuerySchema>;

export const settlementDetailsQuerySchema = z
  .object({
    payoutUuid: z.string().trim().min(1).max(255),
    metadata: z.array(z.string().trim().min(1).max(100)).max(25).default([]),
  })
  .strict();

export type SettlementDetailsQuery = z.infer<typeof settlementDetailsQuerySchema>;

export const orderReportQuerySchema = dateRange.superRefine((range, context) => {
  const start = Date.parse(`${range.startDate}T00:00:00Z`);
  const end = Date.parse(`${range.endDate}T00:00:00Z`);
  if (end - start > 7 * 24 * 60 * 60 * 1_000) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'Sezzle order reports cannot span more than seven days.',
    });
  }
});

export type OrderReportQuery = z.infer<typeof orderReportQuerySchema>;

export const interestBalanceQuerySchema = z
  .object({ currency: currencySchema.default('USD') })
  .strict();

export type InterestBalanceQuery = z.infer<typeof interestBalanceQuerySchema>;

export const interestActivityQuerySchema = dateRange.extend({
  offset: z.number().int().nonnegative().default(0),
  currency: currencySchema.default('USD'),
});

export type InterestActivityQuery = z.infer<typeof interestActivityQuerySchema>;
