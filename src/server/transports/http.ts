import { timingSafeEqual } from 'node:crypto';
import type { Server as NodeHttpServer } from 'node:http';

import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import express, { type NextFunction, type Request, type Response } from 'express';

import type { AppConfig } from '../../config/env.js';
import type { Logger } from '../../logging/logger.js';

interface HttpTransportOptions {
  readonly config: AppConfig;
  readonly logger: Logger;
  readonly createServer: () => McpServer;
  readonly portOverride?: number;
}

export interface HttpTransportHandle {
  readonly url: string;
  close(): Promise<void>;
}

type JsonRequest = Request<Record<string, string>, unknown, unknown>;

const isLoopback = (host: string): boolean =>
  host === '127.0.0.1' || host === '::1' || host.toLowerCase() === 'localhost';

const tokensEqual = (expected: string, actual: string): boolean => {
  const expectedBytes = Buffer.from(expected, 'utf8');
  const actualBytes = Buffer.from(actual, 'utf8');
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
};

export const startHttpTransport = async ({
  config,
  logger,
  createServer,
  portOverride,
}: HttpTransportOptions): Promise<HttpTransportHandle> => {
  const allowedHosts = isLoopback(config.mcp.httpHost) ? undefined : [...config.mcp.allowedHosts];
  const app = createMcpExpressApp({
    host: config.mcp.httpHost,
    ...(allowedHosts === undefined ? {} : { allowedHosts }),
  });
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb', type: ['application/json', 'application/*+json'] }));

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok', service: 'sezzle-ops' });
  });

  const verifyOrigin = (request: Request, response: Response, next: NextFunction): void => {
    const origin = request.get('origin');
    if (origin === undefined) {
      next();
      return;
    }
    let originAllowed = config.mcp.allowedOrigins.includes(origin);
    if (!originAllowed && isLoopback(config.mcp.httpHost)) {
      try {
        originAllowed = isLoopback(new URL(origin).hostname);
      } catch {
        originAllowed = false;
      }
    }
    if (!originAllowed) {
      response.status(403).json({ error: 'Origin is not allowed.' });
      return;
    }
    next();
  };

  const verifyBearer = (request: Request, response: Response, next: NextFunction): void => {
    const configured = config.mcp.httpAuthToken;
    if (configured === undefined) {
      next();
      return;
    }
    const authorization = request.get('authorization');
    const prefix = 'Bearer ';
    if (
      authorization === undefined ||
      !authorization.startsWith(prefix) ||
      !tokensEqual(configured.reveal(), authorization.slice(prefix.length))
    ) {
      response.status(401).json({ error: 'Unauthorized.' });
      return;
    }
    next();
  };

  const active = new Set<{
    readonly server: McpServer;
    readonly transport: StreamableHTTPServerTransport;
  }>();
  const handlePost = async (request: JsonRequest, response: Response): Promise<void> => {
    const mcpServer = createServer();
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
    });
    const connection = { server: mcpServer, transport };
    active.add(connection);
    let cleaned = false;
    const cleanup = async (): Promise<void> => {
      if (cleaned) return;
      cleaned = true;
      active.delete(connection);
      await transport.close();
      await mcpServer.close();
    };
    response.once('close', () => {
      void cleanup();
    });
    try {
      // SDK v1 transport declarations predate exactOptionalPropertyTypes.
      await mcpServer.connect(transport as unknown as Transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error: unknown) {
      logger.error({ error }, 'Streamable HTTP request failed');
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal server error.' },
          id: null,
        });
      }
    }
  };

  app.post('/mcp', verifyOrigin, verifyBearer, (request: JsonRequest, response) => {
    void handlePost(request, response);
  });
  app.get('/mcp', verifyOrigin, verifyBearer, (_request, response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed in stateless mode.' },
      id: null,
    });
  });
  app.delete('/mcp', verifyOrigin, verifyBearer, (_request, response) => {
    response.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed in stateless mode.' },
      id: null,
    });
  });

  const port = portOverride ?? config.mcp.httpPort;
  const httpServer = await new Promise<NodeHttpServer>((resolve, reject) => {
    const listening = app.listen(port, config.mcp.httpHost, () => {
      resolve(listening);
    });
    listening.once('error', reject);
  });
  const address = httpServer.address();
  if (address === null || typeof address === 'string') {
    httpServer.close();
    throw new Error('HTTP transport did not bind to a TCP port.');
  }
  const urlHost = config.mcp.httpHost === '::1' ? '[::1]' : config.mcp.httpHost;
  const url = `http://${urlHost}:${String(address.port)}`;
  logger.info({ url }, 'SezzleOps Streamable HTTP transport started');

  return {
    url,
    close: async () => {
      await Promise.all(
        [...active].map(async ({ transport, server }) => {
          await transport.close();
          await server.close();
        }),
      );
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      });
    },
  };
};
