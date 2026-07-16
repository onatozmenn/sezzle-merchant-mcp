import { z } from 'zod';

export interface NormalizedError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly httpStatus: number;
  readonly requestId: string;
  readonly details: Readonly<Record<string, unknown>>;
}

interface SezzleOpsErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly httpStatus: number;
  readonly requestId?: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export class SezzleOpsError extends Error {
  public override readonly name = 'SezzleOpsError';
  public readonly code: string;
  public readonly retryable: boolean;
  public readonly httpStatus: number;
  public readonly requestId: string | undefined;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(options: SezzleOpsErrorOptions) {
    super(options.message);
    this.code = options.code;
    this.retryable = options.retryable;
    this.httpStatus = options.httpStatus;
    this.requestId = options.requestId;
    this.details = options.details;
  }

  public toNormalized(requestId = this.requestId ?? ''): NormalizedError {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      httpStatus: this.httpStatus,
      requestId,
      details: this.details,
    };
  }
}

const sezzleErrorItemSchema = z.looseObject({
  code: z.string().optional(),
  message: z.string().optional(),
  location: z.string().optional(),
  debug_uuid: z.string().optional(),
});

const sezzleErrorBodySchema = z.union([
  sezzleErrorItemSchema,
  z.array(sezzleErrorItemSchema).min(1),
]);

const firstSezzleError = (body: unknown): z.infer<typeof sezzleErrorItemSchema> | undefined => {
  const parsed = sezzleErrorBodySchema.safeParse(body);
  if (!parsed.success) return undefined;
  return Array.isArray(parsed.data) ? parsed.data[0] : parsed.data;
};

const mapSezzleCode = (httpStatus: number, sezzleCode: string | undefined): string => {
  if (httpStatus === 401) return 'AUTHENTICATION_FAILED';
  if (httpStatus === 403) return 'PERMISSION_DENIED';
  if (httpStatus === 404) return 'RESOURCE_NOT_FOUND';
  if (httpStatus === 409) return 'DUPLICATE_OPERATION';
  if (httpStatus === 429) return 'RATE_LIMITED';
  if (sezzleCode === 'already_completed' || sezzleCode === 'duplicate') {
    return 'DUPLICATE_OPERATION';
  }
  if (
    sezzleCode === 'invalid_authorization' ||
    sezzleCode === 'checkout_expired' ||
    sezzleCode === 'token_is_expired'
  ) {
    return 'INVALID_STATE_TRANSITION';
  }
  if (httpStatus === 400 || httpStatus === 422) return 'SEZZLE_VALIDATION_ERROR';
  return 'SEZZLE_API_ERROR';
};

export const normalizeSezzleApiError = (
  httpStatus: number,
  body: unknown,
  requestId: string,
): SezzleOpsError => {
  const source = firstSezzleError(body);
  const sourceCode = source?.code;
  const retryable = httpStatus === 408 || httpStatus === 429 || httpStatus >= 500;
  const details: Record<string, unknown> = {};
  if (sourceCode !== undefined) details['sezzleCode'] = sourceCode;
  if (source?.location !== undefined) details['location'] = source.location;
  if (source?.debug_uuid !== undefined) details['debugUuid'] = source.debug_uuid;

  return new SezzleOpsError({
    code: mapSezzleCode(httpStatus, sourceCode),
    message: source?.message ?? `Sezzle API request failed with HTTP ${String(httpStatus)}.`,
    retryable,
    httpStatus,
    requestId,
    details,
  });
};

export const normalizeUnknownError = (error: unknown, requestId: string): NormalizedError => {
  if (error instanceof SezzleOpsError) return error.toNormalized(requestId);
  if (error instanceof DOMException && error.name === 'AbortError') {
    return {
      code: 'REQUEST_TIMEOUT',
      message: 'The upstream request timed out.',
      retryable: true,
      httpStatus: 504,
      requestId,
      details: {},
    };
  }
  if (error instanceof TypeError) {
    return {
      code: 'NETWORK_ERROR',
      message: 'The upstream service could not be reached.',
      retryable: true,
      httpStatus: 503,
      requestId,
      details: {},
    };
  }
  if (error instanceof z.ZodError) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'Input validation failed.',
      retryable: false,
      httpStatus: 400,
      requestId,
      details: {
        fields: [...new Set(error.issues.map((issue) => issue.path.join('.')))],
      },
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'An internal error occurred.',
    retryable: false,
    httpStatus: 500,
    requestId,
    details: {},
  };
};
