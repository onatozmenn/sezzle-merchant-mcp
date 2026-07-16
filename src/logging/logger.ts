import pino, { type Logger as PinoLogger, type DestinationStream } from 'pino';

import type { AppConfig, SecretValue } from '../config/env.js';
import { redactForLogging } from './redaction.js';

export type LogContext = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(context: LogContext, message: string): void;
  info(context: LogContext, message: string): void;
  warn(context: LogContext, message: string): void;
  error(context: LogContext, message: string): void;
}

class RedactingLogger implements Logger {
  public constructor(
    private readonly logger: PinoLogger,
    private readonly secrets: readonly SecretValue[],
  ) {}

  public debug(context: LogContext, message: string): void {
    this.logger.debug(redactForLogging(context, this.secrets), message);
  }

  public info(context: LogContext, message: string): void {
    this.logger.info(redactForLogging(context, this.secrets), message);
  }

  public warn(context: LogContext, message: string): void {
    this.logger.warn(redactForLogging(context, this.secrets), message);
  }

  public error(context: LogContext, message: string): void {
    this.logger.error(redactForLogging(context, this.secrets), message);
  }
}

const configuredSecrets = (config: AppConfig): readonly SecretValue[] =>
  [
    config.sezzle.apiKey,
    config.sezzle.apiSecret,
    config.sezzle.webhookSecret,
    config.mcp.httpAuthToken,
  ].filter((value): value is SecretValue => value !== undefined);

export const createLogger = (
  config: AppConfig,
  destination: DestinationStream = pino.destination({ dest: 2, sync: false }),
): Logger =>
  new RedactingLogger(
    pino(
      {
        level: config.logging.level,
        base: { service: 'sezzle-ops' },
        messageKey: 'message',
        timestamp: pino.stdTimeFunctions.isoTime,
      },
      destination,
    ),
    configuredSecrets(config),
  );
