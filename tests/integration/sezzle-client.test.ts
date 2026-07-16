import { afterEach, describe, expect, it } from 'vitest';

import { createSezzleClient } from '../../src/api/sezzle-client.js';
import { loadConfig } from '../../src/config/env.js';
import type { Logger } from '../../src/logging/logger.js';
import { startMockSezzleServer, type MockSezzleServer } from '../fixtures/mock-sezzle-server.js';

const noOpLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const authResponse = (token: string) => ({
  token,
  expiration_date: '2026-07-16T15:00:00Z',
  merchant_uuid: 'merchant-1',
});

const openServers: MockSezzleServer[] = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(async (server) => server.close()));
});

const configFor = (baseUrl: string) =>
  loadConfig({
    SEZZLE_API_BASE_URL: baseUrl,
    SEZZLE_API_KEY: 'sz_pub_test',
    SEZZLE_API_SECRET: 'sz_pr_test',
    SEZZLE_MERCHANT_UUID: 'merchant-1',
    SEZZLE_MAX_RETRIES: '2',
  });

describe('SezzleClient integration with a mock API server', () => {
  it('authenticates, strips customer PII, and sends a bearer token', async () => {
    const server = await startMockSezzleServer((request) => {
      if (request.url === '/v2/authentication')
        return { status: 201, body: authResponse('token-1') };
      return {
        status: 200,
        body: {
          uuid: 'order-1',
          order_amount: { amount_in_cents: 2_500, currency: 'USD' },
          customer: { email: 'private@example.com' },
        },
      };
    });
    openServers.push(server);
    const client = createSezzleClient(configFor(server.baseUrl), noOpLogger, {
      now: () => Date.parse('2026-07-16T12:00:00Z'),
    });

    const order = await client.getOrder('order-1');

    expect(order.data).toEqual({
      uuid: 'order-1',
      order_amount: { amount_in_cents: 2_500, currency: 'USD' },
    });
    expect(server.requests[1]?.headers['authorization']).toBe('Bearer token-1');
  });

  it('respects Retry-After on a safe GET request', async () => {
    let orderAttempts = 0;
    const server = await startMockSezzleServer((request) => {
      if (request.url === '/v2/authentication')
        return { status: 201, body: authResponse('token-1') };
      orderAttempts += 1;
      if (orderAttempts === 1) {
        return {
          status: 429,
          headers: { 'retry-after': '2' },
          body: [{ code: 'rate_limited', message: 'Slow down' }],
        };
      }
      return { status: 200, body: { uuid: 'order-1' } };
    });
    openServers.push(server);
    const delays: number[] = [];
    const client = createSezzleClient(configFor(server.baseUrl), noOpLogger, {
      now: () => Date.parse('2026-07-16T12:00:00Z'),
      sleep: (milliseconds) => {
        delays.push(milliseconds);
        return Promise.resolve();
      },
    });

    await client.getOrder('order-1');

    expect(orderAttempts).toBe(2);
    expect(delays).toEqual([2_000]);
  });

  it('does not retry a non-idempotent order update', async () => {
    let updateAttempts = 0;
    const server = await startMockSezzleServer((request) => {
      if (request.url === '/v2/authentication')
        return { status: 201, body: authResponse('token-1') };
      updateAttempts += 1;
      return { status: 503, body: [{ code: 'unavailable' }] };
    });
    openServers.push(server);
    const client = createSezzleClient(configFor(server.baseUrl), noOpLogger, {
      now: () => Date.parse('2026-07-16T12:00:00Z'),
      sleep: () => Promise.resolve(),
    });

    await expect(
      client.updateOrderReference('order-1', { reference_id: 'merchant_order_1' }),
    ).rejects.toMatchObject({ code: 'SEZZLE_API_ERROR' });
    expect(updateAttempts).toBe(1);
  });

  it('retries an idempotent capture with the same Sezzle request ID', async () => {
    let captureAttempts = 0;
    const seenKeys: (string | undefined)[] = [];
    const server = await startMockSezzleServer((request) => {
      if (request.url === '/v2/authentication')
        return { status: 201, body: authResponse('token-1') };
      captureAttempts += 1;
      seenKeys.push(request.headers['sezzle-request-id'] as string | undefined);
      if (captureAttempts === 1) return { status: 503, body: [{ code: 'unavailable' }] };
      return { status: 200, body: { uuid: 'capture-1' } };
    });
    openServers.push(server);
    const client = createSezzleClient(configFor(server.baseUrl), noOpLogger, {
      now: () => Date.parse('2026-07-16T12:00:00Z'),
      sleep: () => Promise.resolve(),
    });

    const result = await client.captureOrder(
      'order-1',
      { amount_in_cents: 500, currency: 'USD' },
      'idempotency-1',
    );

    expect(result.data.uuid).toBe('capture-1');
    expect(captureAttempts).toBe(2);
    expect(seenKeys).toEqual(['idempotency-1', 'idempotency-1']);
  });

  it('sends a stable documented idempotency header for every financial POST', async () => {
    const seen: { url: string; requestId: string | undefined }[] = [];
    const server = await startMockSezzleServer((request) => {
      if (request.url === '/v2/authentication')
        return { status: 201, body: authResponse('token-1') };
      seen.push({
        url: request.url,
        requestId: request.headers['sezzle-request-id'] as string | undefined,
      });
      if (request.url.endsWith('/reauthorize')) {
        return {
          status: 200,
          body: {
            uuid: 'reauthorized-order-1',
            intent: 'AUTH',
            order_amount: { amount_in_cents: 500, currency: 'USD' },
            authorization: {
              authorization_amount: { amount_in_cents: 500, currency: 'USD' },
              approved: true,
              expiration: '2026-07-17T12:00:00Z',
            },
          },
        };
      }
      return { status: 200, body: { uuid: 'transaction-1' } };
    });
    openServers.push(server);
    const client = createSezzleClient(configFor(server.baseUrl), noOpLogger, {
      now: () => Date.parse('2026-07-16T12:00:00Z'),
    });
    const amount = { amount_in_cents: 500, currency: 'USD' as const };

    await client.captureOrder('order-1', amount, 'fixture-capture-operation');
    await client.refundOrder('order-1', amount, 'fixture-refund-operation');
    await client.releaseAuthorization('order-1', amount, 'fixture-release-operation');
    await client.reauthorizeOrder('order-1', amount, 'fixture-reauthorize-operation');

    expect(seen).toEqual([
      {
        url: '/v2/order/order-1/capture',
        requestId: 'fixture-capture-operation',
      },
      {
        url: '/v2/order/order-1/refund',
        requestId: 'fixture-refund-operation',
      },
      {
        url: '/v2/order/order-1/release',
        requestId: 'fixture-release-operation',
      },
      {
        url: '/v2/order/order-1/reauthorize',
        requestId: 'fixture-reauthorize-operation',
      },
    ]);
  });

  it('normalizes settlement summaries from lossless response text', async () => {
    const server = await startMockSezzleServer((request) => {
      if (request.url === '/v2/authentication')
        return { status: 201, body: authResponse('token-1') };
      return {
        status: 200,
        body: [
          {
            uuid: 'payout-1',
            payout_currency: 'USD',
            settlement_currency: 'USD',
            payout_date: '2026-07-15T00:00:00Z',
            final_payout_amount: 950.8,
            net_settlement_amount: 693.61,
            forex_fees: 0,
            status: 'Complete',
          },
        ],
      };
    });
    openServers.push(server);
    const client = createSezzleClient(configFor(server.baseUrl), noOpLogger, {
      now: () => Date.parse('2026-07-16T12:00:00Z'),
    });

    const result = await client.listSettlementSummaries({
      startDate: '2026-07-15',
      endDate: '2026-07-16',
      offset: 0,
      currency: 'USD',
    });

    expect(result.data[0]?.netSettlementAmount.amount_in_cents).toBe(69_361);
    expect(server.requests[1]?.url).toContain('/v2/settlements/summaries?');
  });

  it('uses only documented webhook endpoints and does not retry webhook mutations', async () => {
    let mutationAttempts = 0;
    const server = await startMockSezzleServer((request) => {
      if (request.url === '/v2/authentication')
        return { status: 201, body: authResponse('token-1') };
      if (request.method === 'GET') {
        return {
          status: 200,
          body: [
            {
              uuid: 'webhook-1',
              url: 'https://merchant.example/hooks',
              events: ['order.captured'],
            },
          ],
        };
      }
      mutationAttempts += 1;
      return { status: 503, body: [{ code: 'unavailable' }] };
    });
    openServers.push(server);
    const client = createSezzleClient(configFor(server.baseUrl), noOpLogger, {
      now: () => Date.parse('2026-07-16T12:00:00Z'),
      sleep: () => Promise.resolve(),
    });

    expect((await client.listWebhooks()).data).toHaveLength(1);
    await expect(
      client.createWebhook({
        url: 'https://merchant.example/hooks',
        events: ['order.captured'],
      }),
    ).rejects.toMatchObject({ code: 'SEZZLE_API_ERROR' });
    expect(mutationAttempts).toBe(1);
  });
});
