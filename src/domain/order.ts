import { SezzleOpsError } from '../api/errors.js';
import type { OrderSnapshot } from '../api/schemas/phase1.js';
import {
  compareMoney,
  moneyFromInput,
  moneyToJson,
  subtractMoney,
  sumMoney,
  type Money,
  type MoneyInput,
  type MoneyJson,
} from './money.js';

export interface OrderFinancialState {
  readonly authorized: MoneyJson;
  readonly captured: MoneyJson;
  readonly refunded: MoneyJson;
  readonly released: MoneyJson;
  readonly remainingCapturable: MoneyJson;
  readonly remainingRefundable: MoneyJson;
}

export interface FinancialValidation {
  readonly valid: boolean;
  readonly code: string;
  readonly message: string;
}

export interface FinancialPreview {
  readonly state: OrderFinancialState;
  readonly requested: MoneyJson;
  readonly remainingAfter: MoneyJson | undefined;
  readonly validation: FinancialValidation;
  readonly warnings: readonly string[];
}

const invalidOrderState = (message: string): never => {
  throw new SezzleOpsError({
    code: 'ORDER_STATE_INVALID',
    message,
    retryable: false,
    httpStatus: 409,
    details: {},
  });
};

const eventMoney = (
  events: readonly { readonly amount: MoneyInput }[],
  currency: Money['currency'],
): Money[] =>
  events.map((event) => {
    const money = moneyFromInput(event.amount);
    if (money.currency !== currency) {
      invalidOrderState('Order transaction currencies are inconsistent.');
    }
    return money;
  });

export const calculateOrderFinancialState = (order: OrderSnapshot): OrderFinancialState => {
  const authorization = order.authorization;
  if (authorization === undefined) {
    return invalidOrderState('Order does not have an authorization.');
  }
  const authorized = moneyFromInput(authorization.authorization_amount);
  const captured = sumMoney(
    eventMoney(authorization.captures, authorized.currency),
    authorized.currency,
  );
  const refunded = sumMoney(
    eventMoney(authorization.refunds, authorized.currency),
    authorized.currency,
  );
  const released = sumMoney(
    eventMoney(authorization.releases, authorized.currency),
    authorized.currency,
  );

  let remainingCapturable: Money;
  let remainingRefundable: Money;
  try {
    remainingCapturable = subtractMoney(subtractMoney(authorized, captured), released);
    remainingRefundable = subtractMoney(captured, refunded);
  } catch (error: unknown) {
    if (error instanceof SezzleOpsError && error.code === 'MONEY_UNDERFLOW') {
      return invalidOrderState('Order transaction totals exceed their parent amount.');
    }
    throw error;
  }

  return {
    authorized: moneyToJson(authorized),
    captured: moneyToJson(captured),
    refunded: moneyToJson(refunded),
    released: moneyToJson(released),
    remainingCapturable: moneyToJson(remainingCapturable),
    remainingRefundable: moneyToJson(remainingRefundable),
  };
};

const failure = (code: string, message: string): FinancialValidation => ({
  valid: false,
  code,
  message,
});

const success = (message: string): FinancialValidation => ({ valid: true, code: 'VALID', message });

const validateCurrency = (requested: Money, available: Money): FinancialValidation | undefined =>
  requested.currency === available.currency
    ? undefined
    : failure(
        'CURRENCY_MISMATCH',
        `Requested currency ${requested.currency} does not match order currency ${available.currency}.`,
      );

const previewAgainstAvailable = (
  order: OrderSnapshot,
  requestedInput: MoneyInput,
  availableInput: MoneyInput,
  exceedsCode: string,
  successMessage: string,
  warnings: readonly string[],
): FinancialPreview => {
  const state = calculateOrderFinancialState(order);
  const requested = moneyFromInput(requestedInput);
  const available = moneyFromInput(availableInput, true);
  const currencyFailure = validateCurrency(requested, available);
  const validation =
    currencyFailure ??
    (compareMoney(requested, available) > 0
      ? failure(exceedsCode, 'Requested amount exceeds the currently available amount.')
      : success(successMessage));
  const remainingAfter = validation.valid
    ? moneyToJson(subtractMoney(available, requested))
    : undefined;
  return {
    state,
    requested: moneyToJson(requested),
    remainingAfter,
    validation,
    warnings,
  };
};

export const previewCapture = (
  order: OrderSnapshot,
  requested: MoneyInput,
  now: Date,
): FinancialPreview => {
  const state = calculateOrderFinancialState(order);
  const authorization = order.authorization;
  if (authorization === undefined)
    return invalidOrderState('Order does not have an authorization.');
  if (!authorization.approved) {
    return {
      state,
      requested,
      remainingAfter: undefined,
      validation: failure('AUTHORIZATION_NOT_APPROVED', 'The order authorization is not approved.'),
      warnings: [],
    };
  }
  if (Date.parse(authorization.expiration) <= now.getTime()) {
    return {
      state,
      requested,
      remainingAfter: undefined,
      validation: failure('AUTHORIZATION_EXPIRED', 'The order authorization has expired.'),
      warnings: [],
    };
  }
  return previewAgainstAvailable(
    order,
    requested,
    state.remainingCapturable,
    'CAPTURE_EXCEEDS_AUTHORIZED_AMOUNT',
    'Capture amount is within the remaining authorization.',
    [
      'A successful capture creates a financial charge and cannot be inferred from natural language.',
    ],
  );
};

export const previewRefund = (order: OrderSnapshot, requested: MoneyInput): FinancialPreview => {
  const state = calculateOrderFinancialState(order);
  return previewAgainstAvailable(
    order,
    requested,
    state.remainingRefundable,
    'REFUND_EXCEEDS_AVAILABLE_AMOUNT',
    'Refund amount is within the remaining refundable amount.',
    ['A successful refund changes the customer and merchant financial position.'],
  );
};

export const previewRelease = (order: OrderSnapshot, requested: MoneyInput): FinancialPreview => {
  const state = calculateOrderFinancialState(order);
  return previewAgainstAvailable(
    order,
    requested,
    state.remainingCapturable,
    'RELEASE_EXCEEDS_AUTHORIZED_AMOUNT',
    'Release amount is within the remaining authorization.',
    ['Released authorization cannot subsequently be captured.'],
  );
};

export const previewReauthorization = (
  order: OrderSnapshot,
  requested: MoneyInput,
  now: Date,
): FinancialPreview => {
  const state = calculateOrderFinancialState(order);
  const authorization = order.authorization;
  if (authorization === undefined)
    return invalidOrderState('Order does not have an authorization.');
  if (Date.parse(authorization.expiration) > now.getTime()) {
    return {
      state,
      requested,
      remainingAfter: undefined,
      validation: failure(
        'AUTHORIZATION_NOT_EXPIRED',
        'Sezzle documents reauthorization only after the original authorization expires.',
      ),
      warnings: [],
    };
  }
  return previewAgainstAvailable(
    order,
    requested,
    state.remainingCapturable,
    'REAUTHORIZATION_EXCEEDS_AVAILABLE_AMOUNT',
    'Reauthorization amount is within the remaining uncaptured amount.',
    [
      'Reauthorization creates a new order and installment plan.',
      'HTTP success does not mean approval; authorization.approved must be true.',
    ],
  );
};

export const throwForInvalidFinancialPreview = (preview: FinancialPreview): void => {
  if (preview.validation.valid) return;
  throw new SezzleOpsError({
    code: preview.validation.code,
    message: preview.validation.message,
    retryable: false,
    httpStatus: 400,
    details: {
      requested: preview.requested,
      available:
        preview.validation.code === 'REFUND_EXCEEDS_AVAILABLE_AMOUNT'
          ? preview.state.remainingRefundable
          : preview.state.remainingCapturable,
    },
  });
};
