import axios from 'axios';
import { logger } from '../../utils/logger';

/**
 * Jupiter Price API client with 30s in-memory cache.
 * Returns the token's price in SOL (the unit the bot tracks native amounts in).
 * Returns null on any failure — callers must treat price as best-effort.
 */

interface CacheEntry {
  priceSol: number | null;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 30_000;

const SOL_MINT = 'So11111111111111111111111111111111111111112';

/** Returns price of `mint` denominated in SOL, or null if unavailable. */
export async function getSolanaTokenPriceInSol(mint: string): Promise<number | null> {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.priceSol;
  }
  try {
    // Jupiter Price API v2: ids=<mint>&vsToken=<SOL mint>
    const resp = await axios.get<{ data?: Record<string, { price?: string | number }> }>(
      'https://api.jup.ag/price/v2',
      {
        params: { ids: mint, vsToken: SOL_MINT },
        timeout: 5_000,
        validateStatus: () => true,
      },
    );
    const raw = resp.data?.data?.[mint]?.price;
    const num = typeof raw === 'number' ? raw : raw ? Number(raw) : NaN;
    const priceSol = Number.isFinite(num) && num > 0 ? num : null;
    cache.set(mint, { priceSol, fetchedAt: Date.now() });
    return priceSol;
  } catch (err) {
    logger.debug({ err, mint }, 'Jupiter price fetch failed');
    cache.set(mint, { priceSol: null, fetchedAt: Date.now() });
    return null;
  }
}

/** Batch fetch prices for multiple mints. Returns map of mint -> price (in SOL) or null. */
export async function getSolanaTokenPricesBatch(mints: string[]): Promise<Record<string, number | null>> {
  if (mints.length === 0) return {};
  // Jupiter accepts comma-separated ids. Filter to ones not in fresh cache.
  const fresh: Record<string, number | null> = {};
  const toFetch: string[] = [];
  for (const m of mints) {
    const cached = cache.get(m);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      fresh[m] = cached.priceSol;
    } else {
      toFetch.push(m);
    }
  }
  if (toFetch.length === 0) return fresh;
  try {
    const resp = await axios.get<{ data?: Record<string, { price?: string | number }> }>(
      'https://api.jup.ag/price/v2',
      {
        params: { ids: toFetch.join(','), vsToken: SOL_MINT },
        timeout: 5_000,
        validateStatus: () => true,
      },
    );
    const now = Date.now();
    for (const m of toFetch) {
      const raw = resp.data?.data?.[m]?.price;
      const num = typeof raw === 'number' ? raw : raw ? Number(raw) : NaN;
      const priceSol = Number.isFinite(num) && num > 0 ? num : null;
      cache.set(m, { priceSol, fetchedAt: now });
      fresh[m] = priceSol;
    }
  } catch (err) {
    logger.debug({ err, count: toFetch.length }, 'Jupiter batch price fetch failed');
    for (const m of toFetch) fresh[m] = null;
  }
  return fresh;
}
