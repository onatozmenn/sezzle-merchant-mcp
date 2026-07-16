import { inspect } from 'node:util';

import { z } from 'zod';

const SANDBOX_API_BASE_URL = 'https://sandbox.gateway.sezzle.com';
const PRODUCTION_API_BASE_URL = 'https://gateway.sezzle.com';

const emptyToUndefined = (value: unknown): unknown => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
};

const optionalString = z.preprocess(emptyToUndefined, z.string().trim().min(1).optional());

const envBoolean = (defaultValue: boolean) =>
  z.preprocess(
    emptyToUndefined,
    z
      .enum(['true', 'false'])
      .default(defaultValue ? 'true' : 'false')
      .transform((value) => value === 'true'),
  );

const envInteger = (defaultValue: number, minimum: number, maximum: number) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().min(minimum).max(maximum).default(defaultValue),
  );

const rawEnvironmentSchema = z.object({
  SEZZLE_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  SEZZLE_API_BASE_URL: optionalString,
  SEZZLE_MERCHANT_UUID: optionalString,
  SEZZLE_API_KEY: optionalString,
  SEZZLE_API_SECRET: optionalString,
  SEZZLE_WEBHOOK_SECRET: optionalString,
  SEZZLE_READ_ONLY: envBoolean(true),
  SEZZLE_REQUIRE_CONFIRMATION: envBoolean(true),
  SEZZLE_PERMISSION_PROFILE: z
    .enum(['read', 'finance', 'webhooks', 'support', 'admin'])
    .default('read'),
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCP_HTTP_HOST: z.string().trim().min(1).default('127.0.0.1'),
  MCP_HTTP_PORT: envInteger(3000, 1, 65_535),
  MCP_HTTP_AUTH_TOKEN: optionalString,
  MCP_HTTP_ALLOWED_HOSTS: optionalString,
  MCP_HTTP_ALLOWED_ORIGINS: optionalString,
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),
  SEZZLE_REQUEST_TIMEOUT_MS: envInteger(10_000, 100, 120_000),
  SEZZLE_MAX_CONCURRENCY: envInteger(5, 1, 100),
  SEZZLE_MAX_RETRIES: envInteger(2, 0, 8),
  SEZZLE_PREVIEW_TTL_SECONDS: envInteger(300, 30, 3_600),
  SEZZLE_STORAGE: z.enum(['memory', 'sqlite']).default('memory'),
  SEZZLE_SQLITE_PATH: z.string().trim().min(1).default('./data/sezzle-ops.db'),
});

export type SezzleEnvironment = z.infer<typeof rawEnvironmentSchema>['SEZZLE_ENV'];
export type PermissionProfile = z.infer<typeof rawEnvironmentSchema>['SEZZLE_PERMISSION_PROFILE'];
export type McpTransport = z.infer<typeof rawEnvironmentSchema>['MCP_TRANSPORT'];
export type LogLevel = z.infer<typeof rawEnvironmentSchema>['LOG_LEVEL'];
export type StorageKind = z.infer<typeof rawEnvironmentSchema>['SEZZLE_STORAGE'];

export class SecretValue {
  readonly #value: string;

  public constructor(value: string) {
    this.#value = value;
  }

  public reveal(): string {
    return this.#value;
  }

  public toJSON(): string {
    return '[REDACTED]';
  }

  public toString(): string {
    return '[REDACTED]';
  }

  public [inspect.custom](): string {
    return '[REDACTED]';
  }
}

export interface AppConfig {
  readonly sezzle: {
    readonly environment: SezzleEnvironment;
    readonly apiBaseUrl: URL;
    readonly merchantUuid: string | undefined;
    readonly apiKey: SecretValue | undefined;
    readonly apiSecret: SecretValue | undefined;
    readonly webhookSecret: SecretValue | undefined;
    readonly readOnly: boolean;
    readonly requireConfirmation: boolean;
    readonly permissionProfile: PermissionProfile;
  };
  readonly mcp: {
    readonly transport: McpTransport;
    readonly httpHost: string;
    readonly httpPort: number;
    readonly httpAuthToken: SecretValue | undefined;
    readonly allowedHosts: readonly string[];
    readonly allowedOrigins: readonly string[];
  };
  readonly logging: {
    readonly level: LogLevel;
  };
  readonly request: {
    readonly timeoutMs: number;
    readonly maxConcurrency: number;
    readonly maxRetries: number;
  };
  readonly preview: {
    readonly ttlSeconds: number;
  };
  readonly storage: {
    readonly kind: StorageKind;
    readonly sqlitePath: string;
  };
}

export class ConfigurationError extends Error {
  public override readonly name = 'ConfigurationError';
}

const isLoopbackHost = (host: string): boolean =>
  host === '127.0.0.1' || host === '::1' || host.toLowerCase() === 'localhost';

const parseApiBaseUrl = (rawUrl: string, environment: SezzleEnvironment): URL => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ConfigurationError('SEZZLE_API_BASE_URL must be an absolute URL.');
  }

  const hasUnexpectedParts =
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    (url.pathname !== '' && url.pathname !== '/');
  if (hasUnexpectedParts) {
    throw new ConfigurationError(
      'SEZZLE_API_BASE_URL must not include credentials, a path, query, or fragment.',
    );
  }

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) {
    throw new ConfigurationError(
      'SEZZLE_API_BASE_URL must use HTTPS, except for loopback integration tests.',
    );
  }

  if (environment === 'production' && url.origin !== PRODUCTION_API_BASE_URL) {
    throw new ConfigurationError(
      `Production requires SEZZLE_API_BASE_URL=${PRODUCTION_API_BASE_URL}.`,
    );
  }
  if (environment === 'sandbox' && url.origin === PRODUCTION_API_BASE_URL) {
    throw new ConfigurationError('Sandbox configuration cannot target the production API URL.');
  }

  return new URL(url.origin);
};

const requireProductionValue = (value: string | undefined, variableName: string): string => {
  if (value === undefined) {
    throw new ConfigurationError(`${variableName} is required in production.`);
  }
  return value;
};

const parseCsvList = (value: string | undefined): readonly string[] =>
  value === undefined
    ? []
    : [
        ...new Set(
          value
            .split(',')
            .map((item) => item.trim())
            .filter((item) => item !== ''),
        ),
      ];

export const loadConfig = (environment: NodeJS.ProcessEnv = process.env): AppConfig => {
  const result = rawEnvironmentSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(
      ', ',
    );
    throw new ConfigurationError(`Invalid environment configuration: ${fields}.`);
  }

  const raw = result.data;
  if (!raw.SEZZLE_READ_ONLY && !raw.SEZZLE_REQUIRE_CONFIRMATION) {
    throw new ConfigurationError(
      'Write mode requires SEZZLE_REQUIRE_CONFIRMATION=true; unsafe write mode is not supported.',
    );
  }

  if (
    raw.MCP_TRANSPORT === 'http' &&
    !isLoopbackHost(raw.MCP_HTTP_HOST) &&
    raw.MCP_HTTP_AUTH_TOKEN === undefined
  ) {
    throw new ConfigurationError(
      'Non-loopback HTTP transport requires MCP_HTTP_AUTH_TOKEN to be configured.',
    );
  }
  const allowedHosts = parseCsvList(raw.MCP_HTTP_ALLOWED_HOSTS);
  if (
    raw.MCP_TRANSPORT === 'http' &&
    !isLoopbackHost(raw.MCP_HTTP_HOST) &&
    allowedHosts.length === 0
  ) {
    throw new ConfigurationError(
      'Non-loopback HTTP transport requires MCP_HTTP_ALLOWED_HOSTS to be configured.',
    );
  }

  let apiBaseUrlRaw = raw.SEZZLE_API_BASE_URL;
  let merchantUuid = raw.SEZZLE_MERCHANT_UUID;
  let apiKey = raw.SEZZLE_API_KEY;
  let apiSecret = raw.SEZZLE_API_SECRET;
  if (raw.SEZZLE_ENV === 'production') {
    apiBaseUrlRaw = requireProductionValue(apiBaseUrlRaw, 'SEZZLE_API_BASE_URL');
    merchantUuid = requireProductionValue(merchantUuid, 'SEZZLE_MERCHANT_UUID');
    apiKey = requireProductionValue(apiKey, 'SEZZLE_API_KEY');
    apiSecret = requireProductionValue(apiSecret, 'SEZZLE_API_SECRET');
  }

  const apiBaseUrl = parseApiBaseUrl(apiBaseUrlRaw ?? SANDBOX_API_BASE_URL, raw.SEZZLE_ENV);

  return {
    sezzle: {
      environment: raw.SEZZLE_ENV,
      apiBaseUrl,
      merchantUuid,
      apiKey: apiKey === undefined ? undefined : new SecretValue(apiKey),
      apiSecret: apiSecret === undefined ? undefined : new SecretValue(apiSecret),
      webhookSecret:
        raw.SEZZLE_WEBHOOK_SECRET === undefined
          ? undefined
          : new SecretValue(raw.SEZZLE_WEBHOOK_SECRET),
      readOnly: raw.SEZZLE_READ_ONLY,
      requireConfirmation: raw.SEZZLE_REQUIRE_CONFIRMATION,
      permissionProfile: raw.SEZZLE_PERMISSION_PROFILE,
    },
    mcp: {
      transport: raw.MCP_TRANSPORT,
      httpHost: raw.MCP_HTTP_HOST,
      httpPort: raw.MCP_HTTP_PORT,
      httpAuthToken:
        raw.MCP_HTTP_AUTH_TOKEN === undefined
          ? undefined
          : new SecretValue(raw.MCP_HTTP_AUTH_TOKEN),
      allowedHosts,
      allowedOrigins: parseCsvList(raw.MCP_HTTP_ALLOWED_ORIGINS),
    },
    logging: {
      level: raw.LOG_LEVEL,
    },
    request: {
      timeoutMs: raw.SEZZLE_REQUEST_TIMEOUT_MS,
      maxConcurrency: raw.SEZZLE_MAX_CONCURRENCY,
      maxRetries: raw.SEZZLE_MAX_RETRIES,
    },
    preview: {
      ttlSeconds: raw.SEZZLE_PREVIEW_TTL_SECONDS,
    },
    storage: {
      kind: raw.SEZZLE_STORAGE,
      sqlitePath: raw.SEZZLE_SQLITE_PATH,
    },
  };
};

export const sezzleApiUrls = {
  sandbox: SANDBOX_API_BASE_URL,
  production: PRODUCTION_API_BASE_URL,
} as const;
