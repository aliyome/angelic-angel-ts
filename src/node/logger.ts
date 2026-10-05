import pino from 'pino';
import type { Logger } from '../core/logger.js';

export function createLogger(verbose: boolean): Logger {
  const level = verbose ? 'debug' : 'warn';
  const pinoInstance = pino(
    {
      level,
      // Default to stdout to mirror Rust's tracing_subscriber::fmt()
    },
    process.stdout
  );

  return {
    debug(obj: Record<string, unknown> | string, msg?: string): void {
      if (typeof obj === 'string') {
        pinoInstance.debug(obj);
      } else {
        pinoInstance.debug(obj, msg);
      }
    },
    info(obj: Record<string, unknown> | string, msg?: string): void {
      if (typeof obj === 'string') {
        pinoInstance.info(obj);
      } else {
        pinoInstance.info(obj, msg);
      }
    },
    warn(obj: Record<string, unknown> | string, msg?: string): void {
      if (typeof obj === 'string') {
        pinoInstance.warn(obj);
      } else {
        pinoInstance.warn(obj, msg);
      }
    },
    error(obj: Record<string, unknown> | string, msg?: string): void {
      if (typeof obj === 'string') {
        pinoInstance.error(obj);
      } else {
        pinoInstance.error(obj, msg);
      }
    },
  };
}
