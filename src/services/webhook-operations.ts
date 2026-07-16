import type { AppConfig } from '../config/env.js';
import { SezzleOpsError } from '../api/errors.js';
import type { ApiResponse } from '../api/request.js';
import type { SezzleClient } from '../api/sezzle-client.js';
import {
  webhookRequestSchema,
  webhookTestRequestSchema,
  type WebhookRequest,
  type WebhookSubscription,
  type WebhookTestRequest,
} from '../api/schemas/webhooks.js';
import type { WebhookEventType } from '../domain/webhook.js';
import type { FinancialValidation } from '../domain/order.js';
import type { MutationPreviewRecord } from '../storage/interface.js';
import { sha256Hash } from '../utils/canonical-json.js';
import type { AuditLog } from './audit-log.js';
import type { EventStore } from './event-store.js';
import type { MutationGuard, MutationPreviewResult } from './mutation-guard.js';

interface Confirmation {
  readonly confirm: boolean;
  readonly previewId: string;
}

export interface CreateWebhookInput extends Confirmation {
  readonly request: WebhookRequest;
}

export interface UpdateWebhookInput extends Confirmation {
  readonly webhookUuid: string;
  readonly request: WebhookRequest;
}

export interface DeleteWebhookInput extends Confirmation {
  readonly webhookUuid: string;
}

export interface TestWebhookInput extends Confirmation {
  readonly request: WebhookTestRequest;
}

export interface WebhookMutationResult {
  readonly currentKnownState: unknown;
  readonly requestedChange: unknown;
  readonly financialImpact: { readonly directMovement: false };
  readonly validationResult: FinancialValidation;
  readonly warnings: readonly string[];
  readonly executed: true;
  readonly auditId: string;
  readonly apiEvidence: {
    readonly requestId: string;
    readonly httpStatus: number;
    readonly evidenceId?: string;
  };
}

interface MutationPlan<T> {
  readonly tool: string;
  readonly merchantId: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly request: unknown;
  readonly currentState: unknown;
  readonly requestedChange: unknown;
  readonly validation: FinancialValidation;
  readonly warnings: readonly string[];
  readonly execute: (preview: MutationPreviewRecord) => Promise<ApiResponse<T>>;
  readonly evidenceId: (data: T) => string | undefined;
}

const valid = (message: string): FinancialValidation => ({ valid: true, code: 'VALID', message });
const invalid = (code: string, message: string): FinancialValidation => ({
  valid: false,
  code,
  message,
});

const errorCode = (error: unknown): string =>
  error instanceof SezzleOpsError ? error.code : 'INTERNAL_ERROR';

const errorWithAudit = (error: unknown, auditId: string): SezzleOpsError => {
  if (error instanceof SezzleOpsError) {
    return new SezzleOpsError({
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      httpStatus: error.httpStatus,
      ...(error.requestId === undefined ? {} : { requestId: error.requestId }),
      details: { ...error.details, auditId },
    });
  }
  return new SezzleOpsError({
    code: 'INTERNAL_ERROR',
    message: 'Webhook operation failed.',
    retryable: false,
    httpStatus: 500,
    details: { auditId },
  });
};

export class WebhookOperations {
  public constructor(
    private readonly config: AppConfig,
    private readonly client: SezzleClient,
    private readonly mutations: MutationGuard,
    private readonly audit: AuditLog,
    private readonly events: EventStore,
  ) {}

  public async listWebhooks(): Promise<readonly WebhookSubscription[]> {
    return (await this.client.listWebhooks()).data;
  }

  public async previewCreateWebhook(requestInput: WebhookRequest): Promise<MutationPreviewResult> {
    return this.#preview(await this.#createPlan(requestInput));
  }

  public async createWebhook(input: CreateWebhookInput): Promise<WebhookMutationResult> {
    return this.#execute(await this.#createPlan(input.request), input);
  }

  public async previewUpdateWebhook(
    webhookUuid: string,
    requestInput: WebhookRequest,
  ): Promise<MutationPreviewResult> {
    return this.#preview(await this.#updatePlan(webhookUuid, requestInput));
  }

  public async updateWebhook(input: UpdateWebhookInput): Promise<WebhookMutationResult> {
    return this.#execute(await this.#updatePlan(input.webhookUuid, input.request), input);
  }

  public async previewDeleteWebhook(webhookUuid: string): Promise<MutationPreviewResult> {
    return this.#preview(await this.#deletePlan(webhookUuid));
  }

  public async deleteWebhook(input: DeleteWebhookInput): Promise<WebhookMutationResult> {
    return this.#execute(await this.#deletePlan(input.webhookUuid), input);
  }

  public async previewTestWebhook(
    requestInput: WebhookTestRequest,
  ): Promise<MutationPreviewResult> {
    return this.#preview(await this.#testPlan(requestInput));
  }

  public async sendTestWebhook(input: TestWebhookInput): Promise<WebhookMutationResult> {
    return this.#execute(await this.#testPlan(input.request), input);
  }

  public verifySignature(rawBody: string, signature: string) {
    return this.events.verify(rawBody, signature);
  }

  public async ingestEvent(rawBody: string, signature: string) {
    const requestHash = sha256Hash(rawBody);
    const merchantId = this.config.sezzle.merchantUuid ?? 'unconfigured';
    try {
      const event = await this.events.ingest(rawBody, signature);
      const audit = await this.audit.record({
        tool: 'sezzle_ingest_webhook_event',
        merchantId,
        environment: this.config.sezzle.environment,
        targetType: 'webhook_event',
        targetId: event.eventId,
        preview: false,
        confirmed: true,
        requestHash,
        result: 'success',
        evidenceId: event.payloadHash,
      });
      return { ...event, auditId: audit.auditId };
    } catch (error: unknown) {
      const audit = await this.audit.record({
        tool: 'sezzle_ingest_webhook_event',
        merchantId,
        environment: this.config.sezzle.environment,
        targetType: 'webhook_payload',
        targetId: requestHash,
        preview: false,
        confirmed: false,
        requestHash,
        result: 'rejected',
        errorCode: errorCode(error),
      });
      throw errorWithAudit(error, audit.auditId);
    }
  }

  public getEvent(eventId: string) {
    return this.events.get(eventId);
  }

  public listEvents(filter: Parameters<EventStore['list']>[0]) {
    return this.events.list(filter);
  }

  public inspectHealth() {
    return this.events.inspectHealth();
  }

  public findMissingOrderEvents(
    orders: readonly {
      readonly orderUuid: string;
      readonly expectedEvents: readonly WebhookEventType[];
    }[],
  ) {
    return this.events.findMissingOrderEvents(orders);
  }

  public detectOutOfOrderEvents(correlationKey?: string) {
    return this.events.detectOutOfOrderEvents(correlationKey);
  }

  public detectDuplicateEvents() {
    return this.events.detectDuplicateEvents();
  }

  async #merchantId(): Promise<string> {
    return (await this.client.authenticateMerchant()).merchantUuid;
  }

  async #createPlan(requestInput: WebhookRequest): Promise<MutationPlan<WebhookSubscription>> {
    const request = webhookRequestSchema.parse(requestInput);
    const merchantId = await this.#merchantId();
    const current = (await this.client.listWebhooks()).data;
    const duplicate = current.some((webhook) => webhook.url === request.url);
    return {
      tool: 'sezzle_create_webhook',
      merchantId,
      targetType: 'webhook_url',
      targetId: request.url,
      request,
      currentState: current,
      requestedChange: { action: 'create', ...request },
      validation: duplicate
        ? invalid('WEBHOOK_URL_ALREADY_EXISTS', 'A webhook already uses this URL.')
        : valid('Webhook URL and event set are valid for creation.'),
      warnings: ['Webhook subscription changes affect future event delivery.'],
      execute: () => this.client.createWebhook(request),
      evidenceId: (data) => data.uuid,
    };
  }

  async #updatePlan(
    webhookUuid: string,
    requestInput: WebhookRequest,
  ): Promise<MutationPlan<WebhookSubscription>> {
    const request = webhookRequestSchema.parse(requestInput);
    const merchantId = await this.#merchantId();
    const current = (await this.client.getWebhook(webhookUuid)).data;
    return {
      tool: 'sezzle_update_webhook',
      merchantId,
      targetType: 'webhook',
      targetId: webhookUuid,
      request: { webhookUuid, ...request },
      currentState: current,
      requestedChange: { action: 'replace_configuration', ...request },
      validation: valid('Webhook replacement URL and event set are valid.'),
      warnings: ['Sezzle replaces the complete event subscription set on update.'],
      execute: () => this.client.updateWebhook(webhookUuid, request),
      evidenceId: (data) => data.uuid,
    };
  }

  async #deletePlan(webhookUuid: string): Promise<MutationPlan<null>> {
    const merchantId = await this.#merchantId();
    const current = (await this.client.getWebhook(webhookUuid)).data;
    return {
      tool: 'sezzle_delete_webhook',
      merchantId,
      targetType: 'webhook',
      targetId: webhookUuid,
      request: { webhookUuid },
      currentState: current,
      requestedChange: { action: 'delete', webhookUuid },
      validation: valid('Webhook exists and can be deleted.'),
      warnings: ['Sezzle documents webhook deletion as irreversible.'],
      execute: () => this.client.deleteWebhook(webhookUuid),
      evidenceId: () => webhookUuid,
    };
  }

  async #testPlan(requestInput: WebhookTestRequest): Promise<MutationPlan<null>> {
    const request = webhookTestRequestSchema.parse(requestInput);
    const merchantId = await this.#merchantId();
    return {
      tool: 'sezzle_send_test_webhook',
      merchantId,
      targetType: 'webhook_url',
      targetId: request.url,
      request,
      currentState: { environment: this.config.sezzle.environment },
      requestedChange: { action: 'send_test_event', ...request },
      validation: valid('Webhook test URL and event are valid.'),
      warnings: ['This sends a test delivery to the specified URL.'],
      execute: () => this.client.sendTestWebhook(request),
      evidenceId: () => undefined,
    };
  }

  #identity<T>(plan: MutationPlan<T>) {
    return {
      tool: plan.tool,
      merchantId: plan.merchantId,
      environment: this.config.sezzle.environment,
      targetType: plan.targetType,
      targetId: plan.targetId,
    } as const;
  }

  #preview<T>(plan: MutationPlan<T>): Promise<MutationPreviewResult> {
    return this.mutations.createPreview({
      ...this.#identity(plan),
      request: plan.request,
      currentState: plan.currentState,
      requestedChange: plan.requestedChange,
      financialImpact: { directMovement: false },
      validation: plan.validation,
      warnings: plan.warnings,
    });
  }

  async #execute<T>(
    plan: MutationPlan<T>,
    confirmation: Confirmation,
  ): Promise<WebhookMutationResult> {
    const identity = this.#identity(plan);
    if (!plan.validation.valid) {
      return this.mutations.rejectExecution(
        { ...identity, request: plan.request },
        plan.validation.code,
        plan.validation.message,
      );
    }
    const preview = await this.mutations.confirmPreview({
      ...identity,
      confirm: confirmation.confirm,
      previewId: confirmation.previewId,
      request: plan.request,
      currentState: plan.currentState,
    });
    try {
      const response = await plan.execute(preview);
      const evidenceId = plan.evidenceId(response.data);
      const auditId = await this.mutations.recordSuccess(preview, evidenceId);
      return {
        currentKnownState: plan.currentState,
        requestedChange: plan.requestedChange,
        financialImpact: { directMovement: false },
        validationResult: plan.validation,
        warnings: plan.warnings,
        executed: true,
        auditId,
        apiEvidence: {
          requestId: response.requestId,
          httpStatus: response.httpStatus,
          ...(evidenceId === undefined ? {} : { evidenceId }),
        },
      };
    } catch (error: unknown) {
      const auditId = await this.mutations.recordFailure(preview, errorCode(error));
      throw errorWithAudit(error, auditId);
    }
  }
}
