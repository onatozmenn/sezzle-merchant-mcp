import type { AppConfig } from '../config/env.js';
import type { Logger } from '../logging/logger.js';
import type { z } from 'zod';
import { AuthClient, type MerchantAuthentication } from './auth-client.js';
import { SezzleOpsError } from './errors.js';
import { sezzleEndpoints } from './endpoint-catalog.js';
import { HttpClient, type ApiResponse, type HttpRequestOptions } from './request.js';
import {
  orderSnapshotSchema,
  reauthorizationResponseSchema,
  sessionResponseSchema,
  transactionResponseSchema,
  type OrderSnapshot,
  type ReauthorizationResponse,
  type SessionResponse,
  type TransactionResponse,
} from './schemas/phase1.js';
import type { CreateSessionRequest, UpdateReferenceRequest } from './schemas/requests.js';
import type { MoneyInput } from '../domain/money.js';
import {
  parseInterestActivity,
  parseInterestBalance,
  parseSettlementDetails,
  parseSettlementSummaries,
  type InterestActivityItem,
  type InterestBalance,
  type SettlementDetails,
  type SettlementSummary,
} from '../domain/settlement.js';
import { orderReportSchema, type OrderReportItem } from './schemas/reports.js';
import type {
  InterestActivityQuery,
  InterestBalanceQuery,
  OrderReportQuery,
  SettlementDetailsQuery,
  SettlementSummaryQuery,
} from './schemas/report-requests.js';
import {
  webhookListSchema,
  webhookSubscriptionSchema,
  type WebhookRequest,
  type WebhookSubscription,
  type WebhookTestRequest,
} from './schemas/webhooks.js';

export interface MerchantContext {
  readonly environment: 'sandbox' | 'production';
  readonly apiBaseUrl: string;
  readonly configuredMerchantUuid: string | undefined;
  readonly authenticatedMerchantUuid: string | undefined;
  readonly tokenExpiresAt: string | undefined;
  readonly readOnly: boolean;
  readonly requireConfirmation: boolean;
  readonly permissionProfile: string;
}

export interface SezzleClient {
  authenticateMerchant(force?: boolean): Promise<MerchantAuthentication>;
  getMerchantContext(): MerchantContext;
  createPaymentSession(request: CreateSessionRequest): Promise<ApiResponse<SessionResponse>>;
  getPaymentSession(sessionUuid: string): Promise<ApiResponse<SessionResponse>>;
  cancelActiveCheckout(orderUuid: string): Promise<ApiResponse<null>>;
  getOrder(orderUuid: string): Promise<ApiResponse<OrderSnapshot>>;
  updateOrderReference(
    orderUuid: string,
    request: UpdateReferenceRequest,
  ): Promise<ApiResponse<null>>;
  captureOrder(
    orderUuid: string,
    amount: MoneyInput,
    idempotencyKey: string,
  ): Promise<ApiResponse<TransactionResponse>>;
  refundOrder(
    orderUuid: string,
    amount: MoneyInput,
    idempotencyKey: string,
  ): Promise<ApiResponse<TransactionResponse>>;
  releaseAuthorization(
    orderUuid: string,
    amount: MoneyInput,
    idempotencyKey: string,
  ): Promise<ApiResponse<TransactionResponse>>;
  reauthorizeOrder(
    orderUuid: string,
    amount: MoneyInput,
    idempotencyKey: string,
  ): Promise<ApiResponse<ReauthorizationResponse>>;
  listSettlementSummaries(
    query: SettlementSummaryQuery,
  ): Promise<ApiResponse<readonly SettlementSummary[]>>;
  getSettlementDetails(query: SettlementDetailsQuery): Promise<ApiResponse<SettlementDetails>>;
  getOrderReport(query: OrderReportQuery): Promise<ApiResponse<readonly OrderReportItem[]>>;
  getInterestBalance(query: InterestBalanceQuery): Promise<ApiResponse<InterestBalance>>;
  getInterestActivity(
    query: InterestActivityQuery,
  ): Promise<ApiResponse<readonly InterestActivityItem[]>>;
  listWebhooks(): Promise<ApiResponse<readonly WebhookSubscription[]>>;
  getWebhook(webhookUuid: string): Promise<ApiResponse<WebhookSubscription>>;
  createWebhook(request: WebhookRequest): Promise<ApiResponse<WebhookSubscription>>;
  updateWebhook(
    webhookUuid: string,
    request: WebhookRequest,
  ): Promise<ApiResponse<WebhookSubscription>>;
  deleteWebhook(webhookUuid: string): Promise<ApiResponse<null>>;
  sendTestWebhook(request: WebhookTestRequest): Promise<ApiResponse<null>>;
}

interface ClientOverrides {
  readonly fetchImplementation?: typeof fetch;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => number;
  readonly requestIdFactory?: () => string;
}

class DefaultSezzleClient implements SezzleClient {
  public constructor(
    private readonly config: AppConfig,
    private readonly http: HttpClient,
    private readonly auth: AuthClient,
  ) {}

  public authenticateMerchant(force = false): Promise<MerchantAuthentication> {
    return this.auth.authenticate(force);
  }

  public getMerchantContext(): MerchantContext {
    const authentication = this.auth.getCurrentAuthentication();
    return {
      environment: this.config.sezzle.environment,
      apiBaseUrl: this.config.sezzle.apiBaseUrl.origin,
      configuredMerchantUuid: this.config.sezzle.merchantUuid,
      authenticatedMerchantUuid: authentication?.merchantUuid,
      tokenExpiresAt: authentication?.expiresAt,
      readOnly: this.config.sezzle.readOnly,
      requireConfirmation: this.config.sezzle.requireConfirmation,
      permissionProfile: this.config.sezzle.permissionProfile,
    };
  }

  public createPaymentSession(
    request: CreateSessionRequest,
  ): Promise<ApiResponse<SessionResponse>> {
    return this.#authenticatedJson(
      {
        method: 'POST',
        path: sezzleEndpoints.sessions,
        headers: {},
        body: request,
        retryable: false,
      },
      sessionResponseSchema,
    );
  }

  public getPaymentSession(sessionUuid: string): Promise<ApiResponse<SessionResponse>> {
    return this.#authenticatedJson(
      {
        method: 'GET',
        path: sezzleEndpoints.session(sessionUuid),
        headers: {},
        body: undefined,
        retryable: true,
      },
      sessionResponseSchema,
    );
  }

  public cancelActiveCheckout(orderUuid: string): Promise<ApiResponse<null>> {
    return this.#authenticatedEmpty({
      method: 'DELETE',
      path: sezzleEndpoints.checkout(orderUuid),
      headers: {},
      body: undefined,
      retryable: false,
    });
  }

  public getOrder(orderUuid: string): Promise<ApiResponse<OrderSnapshot>> {
    return this.#authenticatedJson(
      {
        method: 'GET',
        path: sezzleEndpoints.order(orderUuid),
        headers: {},
        body: undefined,
        retryable: true,
      },
      orderSnapshotSchema,
    );
  }

  public updateOrderReference(
    orderUuid: string,
    request: UpdateReferenceRequest,
  ): Promise<ApiResponse<null>> {
    return this.#authenticatedEmpty({
      method: 'PATCH',
      path: sezzleEndpoints.order(orderUuid),
      headers: {},
      body: request,
      retryable: false,
    });
  }

  public captureOrder(
    orderUuid: string,
    amount: MoneyInput,
    idempotencyKey: string,
  ): Promise<ApiResponse<TransactionResponse>> {
    return this.#financialPost(
      sezzleEndpoints.capture(orderUuid),
      { capture_amount: amount },
      idempotencyKey,
    );
  }

  public refundOrder(
    orderUuid: string,
    amount: MoneyInput,
    idempotencyKey: string,
  ): Promise<ApiResponse<TransactionResponse>> {
    return this.#financialPost(sezzleEndpoints.refund(orderUuid), amount, idempotencyKey);
  }

  public releaseAuthorization(
    orderUuid: string,
    amount: MoneyInput,
    idempotencyKey: string,
  ): Promise<ApiResponse<TransactionResponse>> {
    return this.#financialPost(sezzleEndpoints.release(orderUuid), amount, idempotencyKey);
  }

  public reauthorizeOrder(
    orderUuid: string,
    amount: MoneyInput,
    idempotencyKey: string,
  ): Promise<ApiResponse<ReauthorizationResponse>> {
    return this.#authenticatedJson(
      {
        method: 'POST',
        path: sezzleEndpoints.reauthorize(orderUuid),
        headers: { 'Sezzle-Request-Id': idempotencyKey },
        body: amount,
        retryable: true,
      },
      reauthorizationResponseSchema,
    );
  }

  public async listSettlementSummaries(
    query: SettlementSummaryQuery,
  ): Promise<ApiResponse<readonly SettlementSummary[]>> {
    const response = await this.#authenticatedText({
      method: 'GET',
      path: this.#withQuery(sezzleEndpoints.settlementSummaries, {
        'start-date': query.startDate,
        'end-date': query.endDate,
        offset: String(query.offset),
        'currency-code': query.currency,
      }),
      headers: {},
      body: undefined,
      retryable: true,
    });
    return { ...response, data: parseSettlementSummaries(response.data) };
  }

  public async getSettlementDetails(
    query: SettlementDetailsQuery,
  ): Promise<ApiResponse<SettlementDetails>> {
    const response = await this.#authenticatedText({
      method: 'GET',
      path: this.#withQuery(sezzleEndpoints.settlementDetails(query.payoutUuid), {
        ...(query.metadata.length === 0 ? {} : { metadata: query.metadata.join(',') }),
      }),
      headers: { Accept: 'text/csv' },
      body: undefined,
      retryable: true,
    });
    return { ...response, data: parseSettlementDetails(response.data) };
  }

  public getOrderReport(query: OrderReportQuery): Promise<ApiResponse<readonly OrderReportItem[]>> {
    return this.#authenticatedJson(
      {
        method: 'GET',
        path: this.#withQuery(sezzleEndpoints.orderReport, {
          'start-date': query.startDate,
          'end-date': query.endDate,
        }),
        headers: {},
        body: undefined,
        retryable: true,
      },
      orderReportSchema,
    );
  }

  public async getInterestBalance(
    query: InterestBalanceQuery,
  ): Promise<ApiResponse<InterestBalance>> {
    const response = await this.#authenticatedText({
      method: 'GET',
      path: this.#withQuery(sezzleEndpoints.interestBalance, {
        'currency-code': query.currency,
      }),
      headers: {},
      body: undefined,
      retryable: true,
    });
    return { ...response, data: parseInterestBalance(response.data, query.currency) };
  }

  public async getInterestActivity(
    query: InterestActivityQuery,
  ): Promise<ApiResponse<readonly InterestActivityItem[]>> {
    const response = await this.#authenticatedText({
      method: 'GET',
      path: this.#withQuery(sezzleEndpoints.interestActivity, {
        'start-date': query.startDate,
        'end-date': query.endDate,
        offset: String(query.offset),
        'currency-code': query.currency,
      }),
      headers: { Accept: 'text/csv' },
      body: undefined,
      retryable: true,
    });
    return { ...response, data: parseInterestActivity(response.data) };
  }

  public listWebhooks(): Promise<ApiResponse<readonly WebhookSubscription[]>> {
    return this.#authenticatedJson(
      {
        method: 'GET',
        path: sezzleEndpoints.webhooks,
        headers: {},
        body: undefined,
        retryable: true,
      },
      webhookListSchema,
    );
  }

  public getWebhook(webhookUuid: string): Promise<ApiResponse<WebhookSubscription>> {
    return this.#authenticatedJson(
      {
        method: 'GET',
        path: sezzleEndpoints.webhook(webhookUuid),
        headers: {},
        body: undefined,
        retryable: true,
      },
      webhookSubscriptionSchema,
    );
  }

  public createWebhook(request: WebhookRequest): Promise<ApiResponse<WebhookSubscription>> {
    return this.#authenticatedJson(
      {
        method: 'POST',
        path: sezzleEndpoints.webhooks,
        headers: {},
        body: request,
        retryable: false,
      },
      webhookSubscriptionSchema,
    );
  }

  public updateWebhook(
    webhookUuid: string,
    request: WebhookRequest,
  ): Promise<ApiResponse<WebhookSubscription>> {
    return this.#authenticatedJson(
      {
        method: 'PATCH',
        path: sezzleEndpoints.webhook(webhookUuid),
        headers: {},
        body: request,
        retryable: false,
      },
      webhookSubscriptionSchema,
    );
  }

  public deleteWebhook(webhookUuid: string): Promise<ApiResponse<null>> {
    return this.#authenticatedEmpty({
      method: 'DELETE',
      path: sezzleEndpoints.webhook(webhookUuid),
      headers: {},
      body: undefined,
      retryable: false,
    });
  }

  public sendTestWebhook(request: WebhookTestRequest): Promise<ApiResponse<null>> {
    return this.#authenticatedEmpty({
      method: 'POST',
      path: sezzleEndpoints.webhookTest,
      headers: {},
      body: request,
      retryable: false,
    });
  }

  #financialPost(
    path: string,
    body: unknown,
    idempotencyKey: string,
  ): Promise<ApiResponse<TransactionResponse>> {
    return this.#authenticatedJson(
      {
        method: 'POST',
        path,
        headers: { 'Sezzle-Request-Id': idempotencyKey },
        body,
        retryable: true,
      },
      transactionResponseSchema,
    );
  }

  async #authenticatedJson<T>(
    request: HttpRequestOptions,
    schema: z.ZodType<T>,
  ): Promise<ApiResponse<T>> {
    return this.#withAuthentication((authorization) =>
      this.http.requestJson(
        { ...request, headers: { ...request.headers, Authorization: `Bearer ${authorization}` } },
        schema,
      ),
    );
  }

  async #authenticatedEmpty(request: HttpRequestOptions): Promise<ApiResponse<null>> {
    return this.#withAuthentication((authorization) =>
      this.http.requestEmpty({
        ...request,
        headers: { ...request.headers, Authorization: `Bearer ${authorization}` },
      }),
    );
  }

  async #authenticatedText(request: HttpRequestOptions): Promise<ApiResponse<string>> {
    return this.#withAuthentication((authorization) =>
      this.http.requestText({
        ...request,
        headers: { ...request.headers, Authorization: `Bearer ${authorization}` },
      }),
    );
  }

  #withQuery(path: string, values: Readonly<Record<string, string>>): string {
    const query = new URLSearchParams(values);
    return `${path}?${query.toString()}`;
  }

  async #withAuthentication<T>(operation: (authorization: string) => Promise<T>): Promise<T> {
    const token = await this.auth.getBearerToken();
    try {
      return await operation(token);
    } catch (error: unknown) {
      if (!(error instanceof SezzleOpsError) || error.code !== 'AUTHENTICATION_FAILED') throw error;
      const refreshedToken = await this.auth.getBearerToken(true);
      return operation(refreshedToken);
    }
  }
}

export const createSezzleClient = (
  config: AppConfig,
  logger: Logger,
  overrides: ClientOverrides = {},
): SezzleClient => {
  const http = new HttpClient({
    baseUrl: config.sezzle.apiBaseUrl,
    timeoutMs: config.request.timeoutMs,
    maxConcurrency: config.request.maxConcurrency,
    maxRetries: config.request.maxRetries,
    logger,
    ...(overrides.fetchImplementation === undefined
      ? {}
      : { fetchImplementation: overrides.fetchImplementation }),
    ...(overrides.sleep === undefined ? {} : { sleep: overrides.sleep }),
    ...(overrides.now === undefined ? {} : { now: overrides.now }),
    ...(overrides.requestIdFactory === undefined
      ? {}
      : { requestIdFactory: overrides.requestIdFactory }),
  });
  return new DefaultSezzleClient(config, http, new AuthClient(config, http, overrides.now));
};
