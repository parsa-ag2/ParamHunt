/**
 * modules/param-discovery/lib/mine-cache.ts — the bundle-mining cache.
 *
 * Shipped code (used by the background pipeline) so the tested behavior IS
 * the runtime behavior: a bundle URL is downloaded and analyzed exactly
 * once per cache lifetime; repeats return the cached observations.
 * LRU-capped (default 50 entries) to bound memory.
 */
import type { ParamObservation } from '@shared/types/param';

export type BundleFetcher = (url: string) => Promise<string>;
export type JsExtractor = (code: string, pageUrl: string) => ParamObservation[];

export class BundleMineCache {
  private cache = new Map<string, ParamObservation[]>();

  constructor(
    private readonly maxEntries = 50,
    private readonly maxBundleChars = 1_000_000,
  ) {}

  /**
   * Mine every uncached src (capped by the caller); cached srcs replay
   * their observations without any fetch or regex work.
   */
  async mine(
    srcs: readonly string[],
    pageUrl: string,
    extract: JsExtractor,
    fetcher: BundleFetcher,
  ): Promise<ParamObservation[]> {
    const observations: ParamObservation[] = [];
    for (const src of srcs) {
      const cached = this.cache.get(src);
      if (cached) {
        observations.push(...cached);
        continue;
      }
      try {
        const text = (await fetcher(src)).slice(0, this.maxBundleChars);
        const mined = extract(text, pageUrl || src);
        observations.push(...mined);
        this.cache.set(src, mined);
        if (this.cache.size > this.maxEntries) {
          const oldest = this.cache.keys().next().value;
          if (oldest) this.cache.delete(oldest); // LRU eviction
        }
      } catch {
        // unreachable bundle — skip, never fabricate
      }
    }
    return observations;
  }

  get size(): number {
    return this.cache.size;
  }
}
