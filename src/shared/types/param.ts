/**
 * shared/types/param.ts — parameter discovery data model.
 *
 * ParamObservation = one raw sighting (module output).
 * ParamRecord      = deduplicated, merged parameter (user-facing).
 */
export type ParamSource = 'url' | 'form' | 'dom' | 'js';

export type ParamKind =
  | 'query' // URL query string of the current page
  | 'fragment' // query-style params in location.hash (#?token=…)
  | 'form-field' // named input/select/textarea inside a form
  | 'hidden' // input[type=hidden]
  | 'dom-field' // named input/select/textarea outside any form
  | 'data-attr' // data-param attribute on a control
  | 'url-literal' // query keys in <a href>/<form action> literals
  | 'js-query' // query-string keys in JS string literals / fetch URLs
  | 'js-searchparams' // URLSearchParams .get/.set/.append/.has arguments
  | 'js-object'; // keys of params/data/config object literals

export type ParamConfidence = 'high' | 'medium' | 'low';

const RANK: Record<ParamConfidence, number> = { low: 0, medium: 1, high: 2 };

export function maxConfidence(a: ParamConfidence, b: ParamConfidence): ParamConfidence {
  return RANK[a] >= RANK[b] ? a : b;
}

export interface ParamObservation {
  name: string;
  source: ParamSource;
  kind: ParamKind;
  /** Page/URL where the parameter was seen. */
  pageUrl: string;
  /** HTTP method only when the discovery context pins it (form method). */
  method?: 'GET' | 'POST';
  /** Input type only when applicable (hidden, email, number, …). */
  inputType?: string;
  /** Existing value, capped — shown as "sample", never replayed anywhere. */
  sample?: string;
  confidence: ParamConfidence;
  /** RFC 3339 discovery timestamp. */
  seenAt: string;
}

export interface ParamRecord {
  name: string;
  /** Observation counts per source. */
  sources: Partial<Record<ParamSource, number>>;
  kinds: ParamKind[];
  methods: Array<'GET' | 'POST'>;
  inputTypes: string[];
  firstPageUrl: string;
  lastPageUrl: string;
  firstSample?: string;
  /** Highest confidence across observations — never fabricated upward. */
  confidence: ParamConfidence;
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
}
