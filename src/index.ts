#!/usr/bin/env node

import { createApplication } from './application.js';
import { loadConfig } from './config/env.js';
import { startHttpTransport } from './server/transports/http.js';
import { startStdioTransport } from './server/transports/stdio.js';

const writeStartupError = (error: unknown): void => {
  const message = error instanceof Error ? error.message : 'Unknown startup error.';
  process.stderr.write(
    `${JSON.stringify({ level: 'error', service: 'sezzle-ops', code: 'STARTUP_FAILED', message })}\n`,
  );
};

const main = async (): Promise<void> => {
  const config = loadConfig();
  const application = createApplication(config);
  let closeTransport: () => Promise<void>;
  if (config.mcp.transport === 'stdio') {
    await startStdioTransport(application.server);
    closeTransport = () => application.server.close();
  } else {
    const transport = await startHttpTransport({
      config,
      logger: application.logger,
      createServer: application.createServer,
    });
    closeTransport = () => transport.close();
  }

  const shutdown = async (signal: string): Promise<void> => {
    application.logger.info({ signal }, 'Stopping SezzleOps MCP');
    await closeTransport();
    await application.storage.close();
  };
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  application.logger.info(
    {
      transport: config.mcp.transport,
      environment: config.sezzle.environment,
      readOnly: config.sezzle.readOnly,
      permissionProfile: config.sezzle.permissionProfile,
    },
    'SezzleOps MCP started',
  );
};

main().catch((error: unknown) => {
  writeStartupError(error);
  process.exitCode = 1;
});
