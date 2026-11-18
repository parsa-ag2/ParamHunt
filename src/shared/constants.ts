/** shared/constants.ts — global constants (single source of truth). */

export const APP = {
  name: 'ParamHunt',
  version: '0.0.1',
  /** Storage key prefix — everything the app persists lives under this. */
  storagePrefix: 'paramhunt:',
} as const;

export const STORAGE_KEYS = {
  engineState: `${APP.storagePrefix}engine-state`,
  findings: `${APP.storagePrefix}findings`,
  settings: `${APP.storagePrefix}settings`,
  requests: `${APP.storagePrefix}requests`,
  urls: `${APP.storagePrefix}urls`,
} as const;

/** Dedup sample-value cap: values longer than this are truncated in findings. */
export const MAX_SAMPLE_VALUE = 64;
