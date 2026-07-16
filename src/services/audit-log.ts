import { randomUUID } from 'node:crypto';

import type { SezzleEnvironment } from '../config/env.js';
import type { AuditEvent, AuditFilter, AuditResult, Storage } from '../storage/interface.js';

export interface AuditInput {
  readonly tool: string;
  readonly merchantId: string;
  readonly environment: SezzleEnvironment;
  readonly targetType: string;
  readonly targetId: string;
  readonly preview: boolean;
  readonly confirmed: boolean;
  readonly requestHash: string;
  readonly result: AuditResult;
  readonly errorCode?: string;
  readonly evidenceId?: string;
}

export class AuditLog {
  public constructor(
    private readonly storage: Storage,
    private readonly now: () => Date = () => new Date(),
    private readonly idFactory: () => string = randomUUID,
  ) {}

  public async record(input: AuditInput): Promise<AuditEvent> {
    const event: AuditEvent = {
      auditId: this.idFactory(),
      timestamp: this.now().toISOString(),
      tool: input.tool,
      merchantId: input.merchantId,
      environment: input.environment,
      targetType: input.targetType,
      targetId: input.targetId,
      preview: input.preview,
      confirmed: input.confirmed,
      requestHash: input.requestHash,
      result: input.result,
      ...(input.errorCode === undefined ? {} : { errorCode: input.errorCode }),
      ...(input.evidenceId === undefined ? {} : { evidenceId: input.evidenceId }),
    };
    await this.storage.appendAudit(event);
    return event;
  }

  public get(auditId: string): Promise<AuditEvent | undefined> {
    return this.storage.getAudit(auditId);
  }

  public list(filter: AuditFilter): Promise<readonly AuditEvent[]> {
    return this.storage.listAudits(filter);
  }
}
