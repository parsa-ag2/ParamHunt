/**
 * modules/param-discovery/lib/bundle-cache.ts — LRU cache for mined bundles.
 *
 * THE runtime cache used by the background pipeline (param-discovery):
 * a bundle URL is downloaded and analyzed exactly once per service-worker
 * lifetime. This is the single implementation — tests target this file.
 */
import type { ParamObservation } from '@shared/types/param';
import type { EndpointCandidateLike, UrlSource } from '@shared/types/http';

export interface MinedBundle {
  params: ParamObservation[];
  endpoints: EndpointCandidateLike[];
}

export type BundleFetcher = (url: string) => Promise<string>;
type EndpointExtractSource = Extract<UrlSource, 'js-bundle' | 'inline-js'>;
interface EndpointOpts { pageUrl: string; sourceUrl?: string; source: EndpointExtractSource }

export class BundleMineCache {
  private cache = new Map<string, MinedBundle>();

  constructor(
    private readonly maxEntries = 50,
    private readonly maxBundleChars = 1_000_000,
  ) {}

  get size(): number {
    return this.cache.size;
  }

  has(url: string): boolean {
    return this.cache.has(url);
  }

  get(url: string): MinedBundle | undefined {
    return this.cache.get(url);
  }

  set(url: string, bundle: MinedBundle): void {
    this.cache.set(url, bundle);
    if (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest); // LRU eviction
    }
  }

  /**
   * Fetch + analyze uncached srcs (capped), replay cached ones — the
   * exact loop the background pipeline runs. Extractors are injected so
   * tests drive the runtime implementation without chrome.* dependencies.
   */
  async mine(
    srcs: readonly string[],
    pageUrl: string,
    extractParams: (code: string, pageUrl: string, sourceUrl?: string) => ParamObservation[],
    extractEndpoints: (code: string, opts: EndpointOpts) => EndpointCandidateLike[],
    fetcher: BundleFetcher,
  ): Promise<MinedBundle> {
    const params: ParamObservation[] = [];
    let endpoints: EndpointCandidateLike[] = [];
    for (const src of srcs) {
      const cached = this.cache.get(src);
      if (cached) {
        params.push(...cached.params);
        endpoints = endpoints.concat(cached.endpoints);
        continue;
      }
      try {
        const text = (await fetcher(src)).slice(0, this.maxBundleChars);
        const minedParams = extractParams(text, pageUrl, src);
        const minedEndpoints = extractEndpoints(text, { pageUrl, sourceUrl: src, source: 'js-bundle' });
        params.push(...minedParams);
        endpoints = endpoints.concat(minedEndpoints);
        this.set(src, { params: minedParams, endpoints: minedEndpoints });
      } catch {
        // unreachable bundle — skip, never fabricate
      }
    }
    return { params, endpoints };
  }
}
