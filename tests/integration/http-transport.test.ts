import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { afterEach, describe, expect, it } from 'vitest';

import { createApplication, type Application } from '../../src/application.js';
import { loadConfig } from '../../src/config/env.js';
import { startHttpTransport, type HttpTransportHandle } from '../../src/server/transports/http.js';

const applications: Application[] = [];
const transports: HttpTransportHandle[] = [];
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map(async (client) => client.close()));
  await Promise.all(transports.splice(0).map(async (transport) => transport.close()));
  await Promise.all(applications.splice(0).map(async (application) => application.storage.close()));
});

const start = async (authToken?: string) => {
  const config = loadConfig({
    MCP_TRANSPORT: 'http',
    MCP_HTTP_HOST: '127.0.0.1',
    ...(authToken === undefined ? {} : { MCP_HTTP_AUTH_TOKEN: authToken }),
  });
  const application = createApplication(config);
  const transport = await startHttpTransport({
    config,
    logger: application.logger,
    createServer: application.createServer,
    portOverride: 0,
  });
  applications.push(application);
  transports.push(transport);
  return transport;
};

describe('Streamable HTTP transport', () => {
  it('serves MCP tools and a data-free health endpoint', async () => {
    const transport = await start();
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${transport.url}/mcp`)) as unknown as Transport,
    );
    clients.push(client);

    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      'sezzle_get_merchant_context',
    );
    const health = await fetch(`${transport.url}/health`);
    expect(await health.json()).toEqual({ status: 'ok', service: 'sezzle-ops' });
  });

  it('enforces configured bearer authentication', async () => {
    const transport = await start('transport-secret');
    const unauthorized = await fetch(`${transport.url}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(unauthorized.status).toBe(401);

    const client = new Client({ name: 'http-auth-test', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${transport.url}/mcp`), {
        requestInit: { headers: { Authorization: 'Bearer transport-secret' } },
      }) as unknown as Transport,
    );
    clients.push(client);
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  });

  it('rejects unapproved browser origins', async () => {
    const transport = await start();
    const response = await fetch(`${transport.url}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://evil.example',
      },
      body: '{}',
    });
    expect(response.status).toBe(403);
  });
});
