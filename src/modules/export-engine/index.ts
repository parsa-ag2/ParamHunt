/**
 * modules/export-engine — export serializers for collected findings.
 *
 * Real implementation (no stubs): CSV (RFC 4180-safe, formula-injection
 * guarded) and the JSON payload shape used by the panel’s Export buttons.
 */
export { findingsToCsv } from './csv';
