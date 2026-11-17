/** shared/logger.ts — namespaced logger (console-backed; SW console goes to inspect view). */
import type { Logger } from '@shared/types/module';

export function createLogger(ns: string): Logger {
  const tag = `[ParamHunt:${ns}]`;
  return {
    debug: (msg, ...meta) => console.debug(tag, msg, ...meta),
    info: (msg, ...meta) => console.info(tag, msg, ...meta),
    warn: (msg, ...meta) => console.warn(tag, msg, ...meta),
    error: (msg, ...meta) => console.error(tag, msg, ...meta),
  };
}
