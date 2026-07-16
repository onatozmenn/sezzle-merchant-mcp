import { z } from 'zod';

import { SezzleOpsError } from '../api/errors.js';
import { moneyInputSchema } from '../domain/money.js';

export const orderUuidInput = z.string().trim().min(1).max(255).describe('Sezzle order UUID.');
export const sessionUuidInput = z.string().trim().min(1).max(255).describe('Sezzle session UUID.');
export const amountInput = moneyInputSchema.describe('Integer minor-unit amount and currency.');
export const previewIdInput = z
  .string()
  .trim()
  .min(1)
  .describe('Preview ID returned by the matching preview call.');

export const requirePreviewId = (previewId: string | undefined): string => {
  if (previewId !== undefined) return previewId;
  throw new SezzleOpsError({
    code: 'PREVIEW_REQUIRED',
    message: 'Confirmed execution requires preview_id from a matching preview.',
    retryable: false,
    httpStatus: 400,
    details: {},
  });
};
