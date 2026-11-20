/**
 * modules/export-engine/lib/csv.ts — CSV serialization for findings.
 *
 * Escaping rules (tested):
 *  - cells with , " \n are quoted; inner quotes doubled (RFC 4180);
 *  - formula-injection guard: cells starting with = + - @ get a leading
 *    apostrophe so a spreadsheet cannot execute them;
 *  - evidence is reduced to a count + first URL (compact, not sensitive).
 */
import type { Finding } from '@shared/types/finding';

const HEADERS = [
  'name',
  'source',
  'severity',
  'status',
  'occurrences',
  'first_seen',
  'last_seen',
  'location',
  'method',
  'type',
  'confidence',
  'evidence_count',
  'evidence_url',
  'note',
];

function escapeCell(raw: string): string {
  let v = raw;
  // formula-injection guard: leading spreadsheet operators get neutralized
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  // RFC 4180 quoting
  if (/[",\n\r]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

function cellFor(f: Finding, header: string): string {
  const d = f.detail as Record<string, unknown>;
  const evidence = (d?.evidence ?? []) as Array<{ url?: string }>;
  const name = f.title.startsWith('param: ') ? f.title.slice(7) : f.title;
  switch (header) {
    case 'name':
      return name;
    case 'source':
      return f.source;
    case 'severity':
      return f.severity;
    case 'status':
      return f.status;
    case 'occurrences':
      return String(f.occurrences);
    case 'first_seen':
      return f.firstSeenAt;
    case 'last_seen':
      return f.lastSeenAt;
    case 'location':
      return f.location;
    case 'method':
      return ((d?.methods ?? []) as string[]).join(' | ');
    case 'type':
      return ((d?.kinds ?? []) as string[]).join(' | ');
    case 'confidence':
      return String(d?.confidence ?? 'low');
    case 'evidence_count':
      return String(evidence.length);
    case 'evidence_url':
      return evidence[0]?.url ?? '';
    case 'note':
      return f.note ?? '';
    default:
      return '';
  }
}

/** Serialize findings to RFC 4180-safe CSV (with formula-injection guard). */
export function findingsToCsv(findings: readonly Finding[]): string {
  const lines = [HEADERS.join(',')];
  for (const f of findings) {
    lines.push(HEADERS.map((h) => escapeCell(cellFor(f, h))).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}
