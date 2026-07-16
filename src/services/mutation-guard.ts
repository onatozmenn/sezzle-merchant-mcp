import { randomUUID } from 'node:crypto';

import type { SezzleEnvironment } from '../config/env.js';
import { SezzleOpsError } from '../api/errors.js';
import type { FinancialValidation } from '../domain/order.js';
import type { MutationPreviewRecord, OperationRecord, Storage } from '../storage/interface.js';
import { sha256Hash } from '../utils/canonical-json.js';
import type { AuditLog } from './audit-log.js';

interface MutationIdentity {
  readonly tool: string;
  readonly merchantId: string;
  readonly environment: SezzleEnvironment;
  readonly targetType: string;
  readonly targetId: string;
}

export interface CreatePreviewInput extends MutationIdentity {
  readonly request: unknown;
  readonly currentState: unknown;
  readonly requestedChange: unknown;
  readonly financialImpact: unknown;
  readonly validation: FinancialValidation;
  readonly warnings: readonly string[];
}

export interface MutationPreviewResult {
  readonly currentKnownState: unknown;
  readonly requestedChange: unknown;
  readonly financialImpact: unknown;
  readonly validationResult: FinancialValidation;
  readonly warnings: readonly string[];
  readonly executed: false;
  readonly previewId: string;
  readonly expiresAt: string;
  readonly auditId: string;
}

export interface ConfirmPreviewInput extends MutationIdentity {
  readonly confirm: boolean;
  readonly previewId: string;
  readonly request: unknown;
  readonly currentState: unknown;
}

export class MutationGuard {
  public constructor(
    private readonly storage: Storage,
    private readonly audit: AuditLog,
    private readonly ttlSeconds: number,
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {}

  public async createPreview(input: CreatePreviewInput): Promise<MutationPreviewResult> {
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + this.ttlSeconds * 1_000);
    const requestHash = sha256Hash(input.request);
    const record: MutationPreviewRecord = {
      previewId: this.idFactory(),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      merchantId: input.merchantId,
      environment: input.environment,
      tool: input.tool,
      targetType: input.targetType,
      targetId: input.targetId,
      requestHash,
      stateHash: sha256Hash(input.currentState),
      idempotencyKey: this.idFactory(),
      validationValid: input.validation.valid,
      validationCode: input.validation.code,
    };
    await this.storage.savePreview(record);
    const audit = await this.audit.record({
      ...input,
      preview: true,
      confirmed: false,
      requestHash,
      result: 'preview',
    });
    return {
      currentKnownState: input.currentState,
      requestedChange: input.requestedChange,
      financialImpact: input.financialImpact,
      validationResult: input.validation,
      warnings: input.warnings,
      executed: false,
      previewId: record.previewId,
      expiresAt: record.expiresAt,
      auditId: audit.auditId,
    };
  }

  public async confirmPreview(input: ConfirmPreviewInput): Promise<MutationPreviewRecord> {
    const requestHash = sha256Hash(input.request);
    if (!input.confirm) {
      return this.#reject(
        input,
        requestHash,
        'CONFIRMATION_REQUIRED',
        'Mutation execution requires explicit confirm: true.',
      );
    }

    const preview = await this.storage.getPreview(input.previewId);
    if (preview === undefined) {
      return this.#reject(
        input,
        requestHash,
        'PREVIEW_NOT_FOUND',
        'Mutation preview was not found.',
      );
    }
    if (preview.consumedAt !== undefined) {
      return this.#reject(
        input,
        requestHash,
        'DUPLICATE_OPERATION',
        'Mutation preview has already been consumed.',
      );
    }
    if (Date.parse(preview.expiresAt) <= this.now().getTime()) {
      return this.#reject(input, requestHash, 'PREVIEW_EXPIRED', 'Mutation preview has expired.');
    }
    if (
      preview.tool !== input.tool ||
      preview.merchantId !== input.merchantId ||
      preview.environment !== input.environment ||
      preview.targetType !== input.targetType ||
      preview.targetId !== input.targetId
    ) {
      return this.#reject(
        input,
        requestHash,
        'PREVIEW_CONTEXT_MISMATCH',
        'Mutation preview does not match the requested target or merchant context.',
      );
    }
    if (!preview.validationValid) {
      return this.#reject(
        input,
        requestHash,
        preview.validationCode,
        'The preview validation did not permit execution.',
      );
    }
    if (preview.requestHash !== requestHash) {
      return this.#reject(
        input,
        requestHash,
        'PREVIEW_REQUEST_MISMATCH',
        'Mutation request changed after preview.',
      );
    }
    if (preview.stateHash !== sha256Hash(input.currentState)) {
      return this.#reject(
        input,
        requestHash,
        'STATE_CHANGED_SINCE_PREVIEW',
        'Target state changed after preview; create a new preview.',
      );
    }

    const operation: OperationRecord = {
      idempotencyKey: preview.idempotencyKey,
      requestHash,
      tool: input.tool,
      targetId: input.targetId,
      status: 'in_progress',
      createdAt: this.now().toISOString(),
    };
    const reservation = await this.storage.reserveOperation(operation);
    if (!reservation.reserved) {
      return this.#reject(
        input,
        requestHash,
        'DUPLICATE_OPERATION',
        'An execution attempt already exists for this preview.',
      );
    }
    const consumed = await this.storage.consumePreview(input.previewId, this.now().toISOString());
    if (consumed === undefined) {
      return this.#reject(
        input,
        requestHash,
        'DUPLICATE_OPERATION',
        'Mutation preview was consumed by another execution attempt.',
      );
    }
    return consumed;
  }

  public rejectExecution(
    input: MutationIdentity & { readonly request: unknown },
    code: string,
    message: string,
  ): Promise<never> {
    return this.#reject(input, sha256Hash(input.request), code, message);
  }

  public async recordSuccess(preview: MutationPreviewRecord, evidenceId?: string): Promise<string> {
    const audit = await this.audit.record({
      tool: preview.tool,
      merchantId: preview.merchantId,
      environment: preview.environment,
      targetType: preview.targetType,
      targetId: preview.targetId,
      preview: false,
      confirmed: true,
      requestHash: preview.requestHash,
      result: 'success',
      ...(evidenceId === undefined ? {} : { evidenceId }),
    });
    await this.storage.completeOperation(
      preview.idempotencyKey,
      'succeeded',
      audit.auditId,
      evidenceId,
    );
    return audit.auditId;
  }

  public async recordFailure(preview: MutationPreviewRecord, errorCode: string): Promise<string> {
    const audit = await this.audit.record({
      tool: preview.tool,
      merchantId: preview.merchantId,
      environment: preview.environment,
      targetType: preview.targetType,
      targetId: preview.targetId,
      preview: false,
      confirmed: true,
      requestHash: preview.requestHash,
      result: 'failure',
      errorCode,
    });
    await this.storage.completeOperation(preview.idempotencyKey, 'failed', audit.auditId);
    return audit.auditId;
  }

  async #reject(
    input: MutationIdentity,
    requestHash: string,
    code: string,
    message: string,
  ): Promise<never> {
    const audit = await this.audit.record({
      ...input,
      preview: false,
      confirmed: false,
      requestHash,
      result: 'rejected',
      errorCode: code,
    });
    throw new SezzleOpsError({
      code,
      message,
      retryable: false,
      httpStatus: code === 'DUPLICATE_OPERATION' ? 409 : 400,
      details: { auditId: audit.auditId },
    });
  }
}
