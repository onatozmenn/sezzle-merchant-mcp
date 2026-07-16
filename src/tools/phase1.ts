import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { AppConfig } from '../config/env.js';
import type { MerchantOperations } from '../services/merchant-operations.js';
import { registerAuthTools } from './auth/register.js';
import { registerCaptureTools } from './captures/register.js';
import { registerOrderTools } from './orders/register.js';
import { registerRefundTools } from './refunds/register.js';
import { registerReleaseTools } from './releases/register.js';
import { registerSessionTools } from './sessions/register.js';

export const registerPhase1Tools = (
  server: McpServer,
  operations: MerchantOperations,
  config: AppConfig,
): void => {
  registerAuthTools(server, operations, config);
  registerSessionTools(server, operations, config);
  registerOrderTools(server, operations, config);
  registerCaptureTools(server, operations, config);
  registerRefundTools(server, operations, config);
  registerReleaseTools(server, operations, config);
};
