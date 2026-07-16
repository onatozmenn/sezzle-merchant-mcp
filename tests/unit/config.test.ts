import { describe, expect, it } from 'vitest';

import {
  ConfigurationError,
  loadConfig,
  SecretValue,
  sezzleApiUrls,
} from '../../src/config/env.js';

describe('loadConfig', () => {
  it('defaults to sandbox, stdio, read-only, and the read permission profile', () => {
    const config = loadConfig({});

    expect(config.sezzle.environment).toBe('sandbox');
    expect(config.sezzle.apiBaseUrl.origin).toBe(sezzleApiUrls.sandbox);
    expect(config.sezzle.readOnly).toBe(true);
    expect(config.sezzle.requireConfirmation).toBe(true);
    expect(config.sezzle.permissionProfile).toBe('read');
    expect(config.mcp.transport).toBe('stdio');
  });

  it('parses false explicitly instead of using truthy string coercion', () => {
    const config = loadConfig({
      SEZZLE_READ_ONLY: 'false',
      SEZZLE_REQUIRE_CONFIRMATION: 'true',
      SEZZLE_PERMISSION_PROFILE: 'finance',
    });

    expect(config.sezzle.readOnly).toBe(false);
    expect(config.sezzle.requireConfirmation).toBe(true);
  });

  it('rejects write mode when confirmations are disabled', () => {
    expect(() =>
      loadConfig({ SEZZLE_READ_ONLY: 'false', SEZZLE_REQUIRE_CONFIRMATION: 'false' }),
    ).toThrow(ConfigurationError);
  });

  it('requires explicit production credentials and the exact production URL', () => {
    expect(() => loadConfig({ SEZZLE_ENV: 'production' })).toThrow(
      'SEZZLE_API_BASE_URL is required in production',
    );

    expect(() =>
      loadConfig({
        SEZZLE_ENV: 'production',
        SEZZLE_API_BASE_URL: sezzleApiUrls.sandbox,
        SEZZLE_MERCHANT_UUID: 'merchant-id',
        SEZZLE_API_KEY: 'public',
        SEZZLE_API_SECRET: 'private',
      }),
    ).toThrow(`Production requires SEZZLE_API_BASE_URL=${sezzleApiUrls.production}`);
  });

  it('rejects a production API URL while sandbox is configured', () => {
    expect(() => loadConfig({ SEZZLE_API_BASE_URL: sezzleApiUrls.production })).toThrow(
      'Sandbox configuration cannot target the production API URL',
    );
  });

  it('allows an HTTP loopback URL for mocked integration tests', () => {
    const config = loadConfig({ SEZZLE_API_BASE_URL: 'http://127.0.0.1:43123' });

    expect(config.sezzle.apiBaseUrl.origin).toBe('http://127.0.0.1:43123');
  });

  it('requires authentication before exposing HTTP on a non-loopback host', () => {
    expect(() => loadConfig({ MCP_TRANSPORT: 'http', MCP_HTTP_HOST: '0.0.0.0' })).toThrow(
      'Non-loopback HTTP transport requires MCP_HTTP_AUTH_TOKEN',
    );
  });

  it('requires allowed hosts for non-loopback HTTP even when authentication is set', () => {
    expect(() =>
      loadConfig({
        MCP_TRANSPORT: 'http',
        MCP_HTTP_HOST: '0.0.0.0',
        MCP_HTTP_AUTH_TOKEN: 'transport-secret',
      }),
    ).toThrow('Non-loopback HTTP transport requires MCP_HTTP_ALLOWED_HOSTS');
  });
});

describe('SecretValue', () => {
  it('redacts string, inspection, and JSON representations', () => {
    const secret = new SecretValue('top-secret');

    expect(String(secret)).toBe('[REDACTED]');
    expect(JSON.stringify({ secret })).toBe('{"secret":"[REDACTED]"}');
    expect(secret.reveal()).toBe('top-secret');
  });
});
