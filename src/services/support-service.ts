import { SezzleOpsError } from '../api/errors.js';
import type { SezzleClient } from '../api/sezzle-client.js';
import type { SezzleEnvironment } from '../config/env.js';
import { sha256Hash } from '../utils/canonical-json.js';
import type { AuditLog } from './audit-log.js';
import type {
  ActionEvidence,
  SupportPolicyEngine,
  SupportRequest,
} from './support-policy-engine.js';

export class SupportService {
  public constructor(
    private readonly client: SezzleClient,
    private readonly policy: SupportPolicyEngine,
    private readonly audit: AuditLog,
    private readonly environment: SezzleEnvironment,
  ) {}

  public classify(request: SupportRequest) {
    return { classification: this.policy.classify(request) };
  }

  public determineSafeRoute(request: SupportRequest) {
    return this.policy.determineSafeRoute(request);
  }

  public identifyRequiredEscalation(request: SupportRequest) {
    return this.policy.identifyRequiredEscalation(request);
  }

  public draftCustomerResponse(
    request: SupportRequest,
    facts: readonly string[],
    actionEvidence: readonly ActionEvidence[],
  ) {
    return this.policy.draftCustomerResponse(request, facts, actionEvidence);
  }

  public async explainOrderStatus(orderUuid: string, merchantOrderReference: string) {
    const authentication = await this.client.authenticateMerchant();
    const order = (await this.client.getOrder(orderUuid)).data;
    if (order.reference_id === undefined || order.reference_id !== merchantOrderReference) {
      const audit = await this.audit.record({
        tool: 'sezzle_explain_order_status_for_support',
        merchantId: authentication.merchantUuid,
        environment: this.environment,
        targetType: 'order',
        targetId: orderUuid,
        preview: false,
        confirmed: false,
        requestHash: sha256Hash({ orderUuid, merchantOrderReference }),
        result: 'rejected',
        errorCode: 'ORDER_OWNERSHIP_NOT_VERIFIED',
      });
      throw new SezzleOpsError({
        code: 'ORDER_OWNERSHIP_NOT_VERIFIED',
        message: 'Order reference did not match the authorized merchant reference.',
        retryable: false,
        httpStatus: 403,
        details: { auditId: audit.auditId },
      });
    }
    return this.policy.explainOrderStatus(order);
  }
}
