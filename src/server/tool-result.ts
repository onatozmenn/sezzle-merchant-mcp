import { randomUUID } from 'node:crypto';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { normalizeUnknownError } from '../api/errors.js';

export const executeTool = async (operation: () => Promise<unknown>): Promise<CallToolResult> => {
  try {
    const result = await operation();
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: { result },
    };
  } catch (error: unknown) {
    const normalized = normalizeUnknownError(error, randomUUID());
    return {
      content: [{ type: 'text', text: JSON.stringify(normalized) }],
      structuredContent: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
        httpStatus: normalized.httpStatus,
        requestId: normalized.requestId,
        details: normalized.details,
      },
      isError: true,
    };
  }
};
