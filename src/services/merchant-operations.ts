import type { AppConfig } from '../config/env.js';
import type { MerchantAuthentication } from '../api/auth-client.js';
import { SezzleOpsError } from '../api/errors.js';
import type { MerchantContext, SezzleClient } from '../api/sezzle-client.js';
import type { OrderSnapshot, SessionResponse } from '../api/schemas/phase1.js';
import {
  createSessionRequestSchema,
  updateReferenceRequestSchema,
  type CreateSessionRequest,
} from '../api/schemas/requests.js';
import { moneyInputSchema, type MoneyInput } from '../domain/money.js';
import {
  previewCapture,
  previewReauthorization,
  previewRefund,
  previewRelease,
  type FinancialPreview,
  type FinancialValidation,
} from '../domain/order.js';
import type { MutationPreviewRecord } from '../storage/interface.js';
import type { MutationGuard, MutationPreviewResult } from './mutation-guard.js';
import {
  interestActivityQuerySchema,
  interestBalanceQuerySchema,
  orderReportQuerySchema,
  settlementDetailsQuerySchema,
  settlementSummaryQuerySchema,
  type InterestActivityQuery,
  type InterestBalanceQuery,
  type OrderReportQuery,
  type SettlementDetailsQuery,
  type SettlementSummaryQuery,
} from '../api/schemas/report-requests.js';

interface MutationConfirmation {
  readonly confirm: boolean;
  readonly previewId: string;
}

export interface FinancialMutationInput extends MutationConfirmation {
  readonly orderUuid: string;
  readonly amount: MoneyInput;
}

export interface ReferenceMutationInput extends MutationConfirmation {
  readonly orderUuid: string;
  readonly referenceId: string;
}

export interface TargetMutationInput extends MutationConfirmation {
  readonly orderUuid: string;
}

export interface SessionMutationInput extends MutationConfirmation {
  readonly session: CreateSessionRequest;
}

export interface MutationExecutionResult {
  readonly currentKnownState: unknown;
  readonly requestedChange: unknown;
  readonly financialImpact: unknown;
  readonly validationResult: FinancialValidation;
  readonly warnings: readonly string[];
  readonly executed: true;
  readonly auditId: string;
  readonly apiEvidence: {
    readonly requestId: string;
    readonly httpStatus: number;
    readonly evidenceId?: string;
    readonly approved?: boolean;
  };
}

type FinancialPreviewFactory = (
  order: OrderSnapshot,
  amount: MoneyInput,
  now: Date,
) => FinancialPreview;

interface FinancialOperationDefinition {
  readonly tool: string;
  readonly operation: 'capture' | 'refund' | 'release' | 'reauthorize';
  readonly preview: FinancialPreviewFactory;
}

const valid = (message: string): FinancialValidation => ({
  valid: true,
  code: 'VALID',
  message,
});

const invalid = (code: string, message: string): FinancialValidation => ({
  valid: false,
  code,
  message,
});

const mutationErrorCode = (error: unknown): string =>
  error instanceof SezzleOpsError ? error.code : 'INTERNAL_ERROR';

const withAuditId = (error: unknown, auditId: string): SezzleOpsError => {
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
    message: 'Mutation execution failed.',
    retryable: false,
    httpStatus: 500,
    details: { auditId },
  });
};

export class MerchantOperations {
  public constructor(
    private readonly config: AppConfig,
    private readonly client: SezzleClient,
    private readonly mutations: MutationGuard,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public authenticateMerchant(force = false): Promise<MerchantAuthentication> {
    return this.client.authenticateMerchant(force);
  }

  public getMerchantContext(): MerchantContext {
    return this.client.getMerchantContext();
  }

  public async getPaymentSession(sessionUuid: string): Promise<SessionResponse> {
    return (await this.client.getPaymentSession(sessionUuid)).data;
  }

  public async getOrder(orderUuid: string): Promise<OrderSnapshot> {
    return (await this.client.getOrder(orderUuid)).data;
  }

  public async listSettlementSummaries(query: SettlementSummaryQuery) {
    return (await this.client.listSettlementSummaries(settlementSummaryQuerySchema.parse(query)))
      .data;
  }

  public async getSettlementDetails(query: SettlementDetailsQuery) {
    return (await this.client.getSettlementDetails(settlementDetailsQuerySchema.parse(query))).data;
  }

  public async getOrderReport(query: OrderReportQuery) {
    return (await this.client.getOrderReport(orderReportQuerySchema.parse(query))).data;
  }

  public async getInterestBalance(query: InterestBalanceQuery) {
    return (await this.client.getInterestBalance(interestBalanceQuerySchema.parse(query))).data;
  }

  public async getInterestActivity(query: InterestActivityQuery) {
    return (await this.client.getInterestActivity(interestActivityQuerySchema.parse(query))).data;
  }

  public async previewCapture(
    orderUuid: string,
    amount: MoneyInput,
  ): Promise<MutationPreviewResult> {
    return this.#previewFinancial(
      { tool: 'sezzle_capture_order', operation: 'capture', preview: previewCapture },
      orderUuid,
      amount,
    );
  }

  public async captureOrder(input: FinancialMutationInput): Promise<MutationExecutionResult> {
    return this.#executeFinancial(
      { tool: 'sezzle_capture_order', operation: 'capture', preview: previewCapture },
      input,
    );
  }

  public async previewRefund(
    orderUuid: string,
    amount: MoneyInput,
  ): Promise<MutationPreviewResult> {
    return this.#previewFinancial(
      {
        tool: 'sezzle_refund_order',
        operation: 'refund',
        preview: (order, requested) => previewRefund(order, requested),
      },
      orderUuid,
      amount,
    );
  }

  public async refundOrder(input: FinancialMutationInput): Promise<MutationExecutionResult> {
    return this.#executeFinancial(
      {
        tool: 'sezzle_refund_order',
        operation: 'refund',
        preview: (order, requested) => previewRefund(order, requested),
      },
      input,
    );
  }

  public async previewRelease(
    orderUuid: string,
    amount: MoneyInput,
  ): Promise<MutationPreviewResult> {
    return this.#previewFinancial(
      {
        tool: 'sezzle_release_authorization',
        operation: 'release',
        preview: (order, requested) => previewRelease(order, requested),
      },
      orderUuid,
      amount,
    );
  }

  public async releaseAuthorization(
    input: FinancialMutationInput,
  ): Promise<MutationExecutionResult> {
    return this.#executeFinancial(
      {
        tool: 'sezzle_release_authorization',
        operation: 'release',
        preview: (order, requested) => previewRelease(order, requested),
      },
      input,
    );
  }

  public async previewReauthorize(
    orderUuid: string,
    amount: MoneyInput,
  ): Promise<MutationPreviewResult> {
    return this.#previewFinancial(
      {
        tool: 'sezzle_reauthorize_order',
        operation: 'reauthorize',
        preview: previewReauthorization,
      },
      orderUuid,
      amount,
    );
  }

  public async reauthorizeOrder(input: FinancialMutationInput): Promise<MutationExecutionResult> {
    return this.#executeFinancial(
      {
        tool: 'sezzle_reauthorize_order',
        operation: 'reauthorize',
        preview: previewReauthorization,
      },
      input,
    );
  }

  public async previewUpdateOrderReference(
    orderUuid: string,
    referenceId: string,
  ): Promise<MutationPreviewResult> {
    const request = updateReferenceRequestSchema.parse({ reference_id: referenceId });
    const merchantId = await this.#merchantId();
    const order = (await this.client.getOrder(orderUuid)).data;
    const validation =
      order.reference_id === request.reference_id
        ? invalid('REFERENCE_ALREADY_SET', 'Order already has the requested reference ID.')
        : valid('Order reference can be updated.');
    return this.mutations.createPreview({
      ...this.#identity('sezzle_update_order_reference', merchantId, orderUuid),
      request: { orderUuid, ...request },
      currentState: order,
      requestedChange: { referenceId: request.reference_id },
      financialImpact: { type: 'none' },
      validation,
      warnings: ['This changes merchant tracking metadata but does not move funds.'],
    });
  }

  public async updateOrderReference(
    input: ReferenceMutationInput,
  ): Promise<MutationExecutionResult> {
    const request = updateReferenceRequestSchema.parse({ reference_id: input.referenceId });
    const merchantId = await this.#merchantId();
    const order = (await this.client.getOrder(input.orderUuid)).data;
    const validation =
      order.reference_id === request.reference_id
        ? invalid('REFERENCE_ALREADY_SET', 'Order already has the requested reference ID.')
        : valid('Order reference can be updated.');
    const identity = this.#identity('sezzle_update_order_reference', merchantId, input.orderUuid);
    const requestForHash = { orderUuid: input.orderUuid, ...request };
    if (!validation.valid) {
      return this.mutations.rejectExecution(
        { ...identity, request: requestForHash },
        validation.code,
        validation.message,
      );
    }
    const preview = await this.mutations.confirmPreview({
      ...identity,
      confirm: input.confirm,
      previewId: input.previewId,
      request: requestForHash,
      currentState: order,
    });
    try {
      const response = await this.client.updateOrderReference(input.orderUuid, request);
      const auditId = await this.mutations.recordSuccess(preview);
      return this.#executionResult(
        order,
        { referenceId: request.reference_id },
        { type: 'none' },
        validation,
        ['This changes merchant tracking metadata but does not move funds.'],
        auditId,
        response.requestId,
        response.httpStatus,
      );
    } catch (error: unknown) {
      return this.#throwExecutionFailure(preview, error);
    }
  }

  public async previewCancelActiveCheckout(orderUuid: string): Promise<MutationPreviewResult> {
    const merchantId = await this.#merchantId();
    const order = (await this.client.getOrder(orderUuid)).data;
    const validation =
      order.checkout_status === 'active'
        ? valid('Checkout is active and can be cancelled.')
        : invalid('CHECKOUT_NOT_ACTIVE', 'Only an active incomplete checkout can be cancelled.');
    return this.mutations.createPreview({
      ...this.#identity('sezzle_cancel_active_checkout', merchantId, orderUuid),
      request: { orderUuid },
      currentState: order,
      requestedChange: { checkoutStatus: 'deleted' },
      financialImpact: { directMovement: false, preventsCheckoutCompletion: true },
      validation,
      warnings: ['Sezzle documents checkout deletion as irreversible.'],
    });
  }

  public async cancelActiveCheckout(input: TargetMutationInput): Promise<MutationExecutionResult> {
    const merchantId = await this.#merchantId();
    const order = (await this.client.getOrder(input.orderUuid)).data;
    const validation =
      order.checkout_status === 'active'
        ? valid('Checkout is active and can be cancelled.')
        : invalid('CHECKOUT_NOT_ACTIVE', 'Only an active incomplete checkout can be cancelled.');
    const identity = this.#identity('sezzle_cancel_active_checkout', merchantId, input.orderUuid);
    const request = { orderUuid: input.orderUuid };
    if (!validation.valid) {
      return this.mutations.rejectExecution(
        { ...identity, request },
        validation.code,
        validation.message,
      );
    }
    const preview = await this.mutations.confirmPreview({
      ...identity,
      confirm: input.confirm,
      previewId: input.previewId,
      request,
      currentState: order,
    });
    try {
      const response = await this.client.cancelActiveCheckout(input.orderUuid);
      const auditId = await this.mutations.recordSuccess(preview);
      return this.#executionResult(
        order,
        { checkoutStatus: 'deleted' },
        { directMovement: false, preventsCheckoutCompletion: true },
        validation,
        ['Sezzle documents checkout deletion as irreversible.'],
        auditId,
        response.requestId,
        response.httpStatus,
      );
    } catch (error: unknown) {
      return this.#throwExecutionFailure(preview, error);
    }
  }

  public async previewCreatePaymentSession(
    sessionInput: CreateSessionRequest,
  ): Promise<MutationPreviewResult> {
    const session = createSessionRequestSchema.parse(sessionInput);
    const merchantId = await this.#merchantId();
    const currentState = this.#sessionContext(merchantId);
    return this.mutations.createPreview({
      ...this.#identity(
        'sezzle_create_payment_session',
        merchantId,
        session.order.reference_id,
        'merchant_order_reference',
      ),
      request: session,
      currentState,
      requestedChange: this.#safeSessionChange(session),
      financialImpact: {
        immediateMovement: false,
        checkoutIntent: session.order.intent,
        amount: session.order.order_amount,
      },
      validation: valid('Session payload passed deterministic validation.'),
      warnings:
        session.order.intent === 'CAPTURE'
          ? ['CAPTURE intent captures automatically after successful shopper authorization.']
          : ['AUTH intent requires a later confirmed capture before authorization expires.'],
    });
  }

  public async createPaymentSession(input: SessionMutationInput): Promise<MutationExecutionResult> {
    const session = createSessionRequestSchema.parse(input.session);
    const merchantId = await this.#merchantId();
    const currentState = this.#sessionContext(merchantId);
    const identity = this.#identity(
      'sezzle_create_payment_session',
      merchantId,
      session.order.reference_id,
      'merchant_order_reference',
    );
    const preview = await this.mutations.confirmPreview({
      ...identity,
      confirm: input.confirm,
      previewId: input.previewId,
      request: session,
      currentState,
    });
    try {
      const response = await this.client.createPaymentSession(session);
      const evidenceId = response.data.order?.uuid ?? response.data.uuid;
      const auditId = await this.mutations.recordSuccess(preview, evidenceId);
      return this.#executionResult(
        currentState,
        this.#safeSessionChange(session),
        {
          immediateMovement: false,
          checkoutIntent: session.order.intent,
          amount: session.order.order_amount,
        },
        valid('Session payload passed deterministic validation.'),
        session.order.intent === 'CAPTURE'
          ? ['CAPTURE intent captures automatically after successful shopper authorization.']
          : ['AUTH intent requires a later confirmed capture before authorization expires.'],
        auditId,
        response.requestId,
        response.httpStatus,
        evidenceId,
      );
    } catch (error: unknown) {
      return this.#throwExecutionFailure(preview, error);
    }
  }

  async #previewFinancial(
    definition: FinancialOperationDefinition,
    orderUuid: string,
    amountInput: MoneyInput,
  ): Promise<MutationPreviewResult> {
    const amount = moneyInputSchema.parse(amountInput);
    const merchantId = await this.#merchantId();
    const order = (await this.client.getOrder(orderUuid)).data;
    const preview = definition.preview(order, amount, this.now());
    return this.mutations.createPreview({
      ...this.#identity(definition.tool, merchantId, orderUuid),
      request: { orderUuid, amount },
      currentState: this.#financialCurrentState(order, preview),
      requestedChange: { operation: definition.operation, amount },
      financialImpact: this.#financialImpact(definition.operation, preview),
      validation: preview.validation,
      warnings: preview.warnings,
    });
  }

  async #executeFinancial(
    definition: FinancialOperationDefinition,
    input: FinancialMutationInput,
  ): Promise<MutationExecutionResult> {
    const amount = moneyInputSchema.parse(input.amount);
    const merchantId = await this.#merchantId();
    const order = (await this.client.getOrder(input.orderUuid)).data;
    const financialPreview = definition.preview(order, amount, this.now());
    const identity = this.#identity(definition.tool, merchantId, input.orderUuid);
    const request = { orderUuid: input.orderUuid, amount };
    if (!financialPreview.validation.valid) {
      return this.mutations.rejectExecution(
        { ...identity, request },
        financialPreview.validation.code,
        financialPreview.validation.message,
      );
    }
    const currentState = this.#financialCurrentState(order, financialPreview);
    const preview = await this.mutations.confirmPreview({
      ...identity,
      confirm: input.confirm,
      previewId: input.previewId,
      request,
      currentState,
    });
    try {
      const response = await this.#callFinancial(
        definition.operation,
        input.orderUuid,
        amount,
        preview,
      );
      const approved = definition.operation === 'reauthorize' ? response.data.approved : undefined;
      if (approved === false) {
        throw new SezzleOpsError({
          code: 'REAUTHORIZATION_NOT_APPROVED',
          message: 'Sezzle accepted the reauthorization request but did not approve it.',
          retryable: false,
          httpStatus: 409,
          requestId: response.requestId,
          details: {},
        });
      }
      const auditId = await this.mutations.recordSuccess(preview, response.data.evidenceId);
      return this.#executionResult(
        currentState,
        { operation: definition.operation, amount },
        this.#financialImpact(definition.operation, financialPreview),
        financialPreview.validation,
        financialPreview.warnings,
        auditId,
        response.requestId,
        response.httpStatus,
        response.data.evidenceId,
        approved,
      );
    } catch (error: unknown) {
      return this.#throwExecutionFailure(preview, error);
    }
  }

  async #callFinancial(
    operation: FinancialOperationDefinition['operation'],
    orderUuid: string,
    amount: MoneyInput,
    preview: MutationPreviewRecord,
  ): Promise<{
    data: { evidenceId: string; approved?: boolean };
    requestId: string;
    httpStatus: number;
  }> {
    if (operation === 'capture') {
      const response = await this.client.captureOrder(orderUuid, amount, preview.idempotencyKey);
      return { ...response, data: { evidenceId: response.data.uuid } };
    }
    if (operation === 'refund') {
      const response = await this.client.refundOrder(orderUuid, amount, preview.idempotencyKey);
      return { ...response, data: { evidenceId: response.data.uuid } };
    }
    if (operation === 'release') {
      const response = await this.client.releaseAuthorization(
        orderUuid,
        amount,
        preview.idempotencyKey,
      );
      return { ...response, data: { evidenceId: response.data.uuid } };
    }
    const response = await this.client.reauthorizeOrder(orderUuid, amount, preview.idempotencyKey);
    return {
      ...response,
      data: { evidenceId: response.data.uuid, approved: response.data.authorization.approved },
    };
  }

  async #merchantId(): Promise<string> {
    return (await this.client.authenticateMerchant()).merchantUuid;
  }

  #identity(tool: string, merchantId: string, targetId: string, targetType = 'order') {
    return {
      tool,
      merchantId,
      environment: this.config.sezzle.environment,
      targetType,
      targetId,
    } as const;
  }

  #financialCurrentState(order: OrderSnapshot, preview: FinancialPreview): unknown {
    return { order, financialState: preview.state };
  }

  #financialImpact(operation: string, preview: FinancialPreview): unknown {
    return {
      operation,
      requestedAmount: preview.requested,
      remainingCapturableBefore: preview.state.remainingCapturable,
      remainingRefundableBefore: preview.state.remainingRefundable,
      remainingAfter: preview.remainingAfter,
    };
  }

  #sessionContext(merchantId: string): unknown {
    return {
      merchantId,
      environment: this.config.sezzle.environment,
      apiBaseUrl: this.config.sezzle.apiBaseUrl.origin,
    };
  }

  #safeSessionChange(session: CreateSessionRequest): unknown {
    return {
      referenceId: session.order.reference_id,
      intent: session.order.intent,
      amount: session.order.order_amount,
      itemCount: session.order.items?.length ?? 0,
      hasCustomerPrefill: session.customer !== undefined,
    };
  }

  #executionResult(
    currentKnownState: unknown,
    requestedChange: unknown,
    financialImpact: unknown,
    validationResult: FinancialValidation,
    warnings: readonly string[],
    auditId: string,
    requestId: string,
    httpStatus: number,
    evidenceId?: string,
    approved?: boolean,
  ): MutationExecutionResult {
    return {
      currentKnownState,
      requestedChange,
      financialImpact,
      validationResult,
      warnings,
      executed: true,
      auditId,
      apiEvidence: {
        requestId,
        httpStatus,
        ...(evidenceId === undefined ? {} : { evidenceId }),
        ...(approved === undefined ? {} : { approved }),
      },
    };
  }

  async #throwExecutionFailure(preview: MutationPreviewRecord, error: unknown): Promise<never> {
    const auditId = await this.mutations.recordFailure(preview, mutationErrorCode(error));
    throw withAuditId(error, auditId);
  }
}
