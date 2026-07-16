import { createHash } from 'node:crypto';

const serialize = (value: unknown, ancestors: WeakSet<object>): string => {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new TypeError('Canonical JSON cannot contain non-finite numbers.');
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (typeof value === 'bigint') {
    return `{"$bigint":${JSON.stringify(value.toString())}}`;
  }
  if (value === undefined) return 'null';
  if (typeof value !== 'object') {
    throw new TypeError(`Canonical JSON does not support ${typeof value} values.`);
  }
  if (ancestors.has(value)) throw new TypeError('Canonical JSON cannot contain circular values.');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => serialize(item, ancestors)).join(',')}]`;
    }
    if (value instanceof Date) return JSON.stringify(value.toISOString());
    const entries = Object.entries(value)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, child]) => `${JSON.stringify(key)}:${serialize(child, ancestors)}`)
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
};

export const canonicalJson = (value: unknown): string => serialize(value, new WeakSet());

export const sha256Hash = (value: unknown): string =>
  createHash('sha256').update(canonicalJson(value)).digest('hex');
