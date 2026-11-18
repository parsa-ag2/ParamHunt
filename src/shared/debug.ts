/**
 * shared/debug.ts — gated pipeline logging.
 *
 * Off by default (production-quiet). Enable via Options ("Debug logging")
 * or `chrome.storage.local` key `paramhunt:settings` → `debug: true`.
 * Every pipeline stage logs through here so a broken flow can be located
 * from the SW console / page console / panel console without code changes.
 */
import { STORAGE_KEYS } from './constants';

export type PipelineStage =
  | 'content-init'
  | 'collect'
  | 'extract'
  | 'dedupe'
  | 'report'
  | 'store'
  | 'message'
  | 'ui'
  | 'error';

type LogFn = (stage: PipelineStage, message: string, data?: unknown) => void;

let debugEnabled: boolean | null = null;

/** Cache-avoiding read; falls back to disabled when storage is unavailable. */
export async function refreshDebugFlag(): Promise<boolean> {
  try {
    const bag = await chrome.storage.local.get(STORAGE_KEYS.settings);
    const raw = bag[STORAGE_KEYS.settings] as { debug?: boolean } | undefined;
    debugEnabled = raw?.debug === true;
  } catch {
    debugEnabled = false;
  }
  return debugEnabled;
}

export function debugFlagCached(): boolean {
  return debugEnabled === true;
}

/** Create a gated logger for one pipeline owner (content/bg/panel). */
export function createPipelineLogger(owner: string): LogFn {
  const emit = (level: 'log' | 'warn' | 'error', stage: PipelineStage, message: string, data?: unknown) => {
    const tag = `[ParamHunt:${owner}:${stage}]`;
    if (level === 'error') console.error(tag, message, data ?? '');
    else if (level === 'warn' || debugFlagCached()) console[level](tag, message, data ?? '');
  };
  return (stage, message, data) => emit('log', stage, message, data);
}

/** Errors always surface, regardless of the debug flag. */
export function pipelineError(owner: string, stage: PipelineStage, message: string, data?: unknown): void {
  console.error(`[ParamHunt:${owner}:${stage}]`, message, data ?? '');
}
