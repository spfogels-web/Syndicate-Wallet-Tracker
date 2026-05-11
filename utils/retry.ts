import { logger } from './logger';

export interface RetryOptions {
  retries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  /** Return true to retry; false to give up immediately. */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  label?: string;
}

const DEFAULTS: Required<Omit<RetryOptions, 'shouldRetry' | 'label'>> = {
  retries: 4,
  initialDelayMs: 250,
  maxDelayMs: 8_000,
  factor: 2,
};

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const cfg = { ...DEFAULTS, ...opts };
  let lastErr: unknown;
  for (let attempt = 0; attempt <= cfg.retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (opts.shouldRetry && !opts.shouldRetry(err, attempt)) throw err;
      if (attempt === cfg.retries) break;
      const base = Math.min(cfg.maxDelayMs, cfg.initialDelayMs * Math.pow(cfg.factor, attempt));
      const jittered = Math.floor(base * (0.5 + Math.random() * 0.5));
      logger.warn(
        { err, attempt, delayMs: jittered, label: opts.label },
        'retrying after error',
      );
      await sleep(jittered);
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
