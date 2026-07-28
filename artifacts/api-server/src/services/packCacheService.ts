/**
 * packCacheService — Sprint 9.6
 *
 * In-process TTL cache for the public pack catalogue.
 * The DB remains authoritative. Invalidated on pack or price mutations.
 *
 * TTL: 5 minutes. Safe to call from request handlers with no await overhead
 * on cache hits.
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

let publicPacksCache: CacheEntry<unknown> | null = null;

export function getPublicPacksFromCache<T>(): T | null {
  if (!publicPacksCache) return null;
  if (Date.now() > publicPacksCache.expiresAt) {
    publicPacksCache = null;
    return null;
  }
  return publicPacksCache.value as T;
}

export function setPublicPacksCache<T>(value: T): void {
  publicPacksCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
}

export function invalidatePublicPacksCache(): void {
  publicPacksCache = null;
}
