import { randomUUID } from 'node:crypto';

import pLimit from 'p-limit';
import type { z } from 'zod';

import { normalizeSezzleApiError, SezzleOpsError } from './errors.js';
import type { Logger } from '../logging/logger.js';

export interface ApiResponse<T> {
  readonly data: T;
  readonly requestId: string;
  readonly httpStatus: number;
}

export interface HttpRequestOptions {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly retryable: boolean;
}

interface HttpClientOptions {
  readonly baseUrl: URL;
  readonly timeoutMs: number;
  readonly maxConcurrency: number;
  readonly maxRetries: number;
  readonly logger: Logger;
  readonly fetchImplementation?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
  readonly requestIdFactory?: () => string;
}

const defaultSleep = async (milliseconds: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const retryableStatus = (status: number): boolean =>
  status === 408 ||
  status === 429 ||
  status === 500 ||
  status === 502 ||
  status === 503 ||
  status === 504;

export class HttpClient {
  readonly #baseUrl: URL;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #logger: Logger;
  readonly #fetch: typeof fetch;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #now: () => number;
  readonly #requestIdFactory: () => string;
  readonly #limit: ReturnType<typeof pLimit>;

  public constructor(options: HttpClientOptions) {
    this.#baseUrl = options.baseUrl;
    this.#timeoutMs = options.timeoutMs;
    this.#maxRetries = options.maxRetries;
    this.#logger = options.logger;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#now = options.now ?? Date.now;
    this.#requestIdFactory = options.requestIdFactory ?? randomUUID;
    this.#limit = pLimit(options.maxConcurrency);
  }

  public async requestJson<T>(
    options: HttpRequestOptions,
    schema: z.ZodType<T>,
  ): Promise<ApiResponse<T>> {
    const result = await this.#request(options);
    const text = await result.response.text();
    let body: unknown;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      throw new SezzleOpsError({
        code: 'SEZZLE_RESPONSE_INVALID',
        message: 'Sezzle returned an invalid JSON response.',
        retryable: false,
        httpStatus: 502,
        requestId: result.requestId,
        details: {},
      });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new SezzleOpsError({
        code: 'SEZZLE_RESPONSE_INVALID',
        message: 'Sezzle returned a response that did not match the documented schema.',
        retryable: false,
        httpStatus: 502,
        requestId: result.requestId,
        details: {
          fields: [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))],
        },
      });
    }
    return { data: parsed.data, requestId: result.requestId, httpStatus: result.response.status };
  }

  public async requestEmpty(options: HttpRequestOptions): Promise<ApiResponse<null>> {
    const result = await this.#request(options);
    return { data: null, requestId: result.requestId, httpStatus: result.response.status };
  }

  public async requestText(options: HttpRequestOptions): Promise<ApiResponse<string>> {
    const result = await this.#request(options);
    return {
      data: await result.response.text(),
      requestId: result.requestId,
      httpStatus: result.response.status,
    };
  }

  async #request(options: HttpRequestOptions): Promise<{ response: Response; requestId: string }> {
    const requestId = this.#requestIdFactory();
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => {
        controller.abort();
      }, this.#timeoutMs);
      try {
        const headers = new Headers(options.headers);
        headers.set('Accept', 'application/json');
        headers.set('X-Request-Id', requestId);
        const requestInit: RequestInit = {
          method: options.method,
          headers,
          signal: controller.signal,
        };
        if (options.body !== undefined) {
          headers.set('Content-Type', 'application/json');
          requestInit.body = JSON.stringify(options.body);
        }

        const response = await this.#limit(() =>
          this.#fetch(new URL(options.path, this.#baseUrl), requestInit),
        );
        if (response.ok) {
          return { response, requestId };
        }

        const body = await this.#readErrorBody(response);
        const error = normalizeSezzleApiError(response.status, body, requestId);
        if (
          !options.retryable ||
          !retryableStatus(response.status) ||
          attempt === this.#maxRetries
        ) {
          throw error;
        }
        await this.#waitBeforeRetry(
          response.headers.get('retry-after'),
          attempt,
          options,
          requestId,
        );
      } catch (error: unknown) {
        if (error instanceof SezzleOpsError) throw error;
        const requestError =
          error instanceof DOMException && error.name === 'AbortError'
            ? new SezzleOpsError({
                code: 'REQUEST_TIMEOUT',
                message: 'The upstream request timed out.',
                retryable: true,
                httpStatus: 504,
                requestId,
                details: {},
              })
            : new SezzleOpsError({
                code: 'NETWORK_ERROR',
                message: 'The upstream service could not be reached.',
                retryable: true,
                httpStatus: 503,
                requestId,
                details: {},
              });
        if (!options.retryable || attempt === this.#maxRetries) throw requestError;
        await this.#waitBeforeRetry(null, attempt, options, requestId);
      } finally {
        clearTimeout(timeout);
      }
    }
    throw new SezzleOpsError({
      code: 'INTERNAL_ERROR',
      message: 'Request retry state was exhausted unexpectedly.',
      retryable: false,
      httpStatus: 500,
      requestId,
      details: {},
    });
  }

  async #readErrorBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (text === '') return {};
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return {};
    }
  }

  async #waitBeforeRetry(
    retryAfter: string | null,
    attempt: number,
    options: HttpRequestOptions,
    requestId: string,
  ): Promise<void> {
    const delayMs = this.#retryDelay(retryAfter, attempt);
    this.#logger.warn(
      { requestId, method: options.method, path: options.path, attempt: attempt + 1, delayMs },
      'Retrying Sezzle API request',
    );
    await this.#sleep(delayMs);
  }

  #retryDelay(retryAfter: string | null, attempt: number): number {
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1_000, 60_000);
      const date = Date.parse(retryAfter);
      if (!Number.isNaN(date)) return Math.min(Math.max(date - this.#now(), 0), 60_000);
    }
    return Math.min(250 * 2 ** attempt, 5_000);
  }
}
