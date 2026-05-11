/**
 * Simple token-bucket rate limiter, scoped by key (e.g. Telegram user id).
 * In-memory only — fine for a single Railway instance. For multi-instance,
 * back this with Redis.
 */
interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {}

  /** Returns true if the request is allowed, false if it should be rejected. */
  take(key: string, cost = 1): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillMs: now };
      this.buckets.set(key, bucket);
    }
    const elapsedSec = (now - bucket.lastRefillMs) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec);
    bucket.lastRefillMs = now;
    if (bucket.tokens < cost) return false;
    bucket.tokens -= cost;
    return true;
  }
}

// Defaults: 30 commands per minute per user.
export const commandLimiter = new RateLimiter(30, 0.5);
