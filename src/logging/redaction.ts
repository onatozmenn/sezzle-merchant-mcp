import { SecretValue } from '../config/env.js';

const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /(?:api[_-]?(?:key|secret)|authorization|bearer|token|secret|signature|password|pan|cvv|customer|email|phone|address|payment[_-]?details)/i;

const redactString = (value: string, secrets: readonly SecretValue[]): string => {
  let redacted = value;
  for (const secret of secrets) {
    const revealed = secret.reveal();
    if (revealed !== '') {
      redacted = redacted.replaceAll(revealed, REDACTED);
    }
  }
  return redacted;
};

const redactInternal = (
  value: unknown,
  secrets: readonly SecretValue[],
  seen: WeakSet<object>,
): unknown => {
  if (typeof value === 'string') {
    return redactString(value, secrets);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof SecretValue) {
    return REDACTED;
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactInternal(item, secrets, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = SENSITIVE_KEY.test(key) ? REDACTED : redactInternal(child, secrets, seen);
  }
  return output;
};

export const redactForLogging = (value: unknown, secrets: readonly SecretValue[] = []): unknown =>
  redactInternal(value, secrets, new WeakSet());
