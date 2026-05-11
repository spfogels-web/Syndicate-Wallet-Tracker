import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';

const COOKIE_NAME = 'syndicate_session';
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function dashboardEnabled(): boolean {
  return Boolean(env.DASHBOARD_PASSWORD && env.DASHBOARD_SESSION_SECRET);
}

function getSecret(): string {
  if (!env.DASHBOARD_SESSION_SECRET) {
    throw new Error('DASHBOARD_SESSION_SECRET not configured');
  }
  return env.DASHBOARD_SESSION_SECRET;
}

/** Sign a payload with HMAC-SHA256. Returns `<payload>.<sig>` base64url-encoded. */
function sign(payload: string): string {
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

/** Verify a signed cookie. Returns the payload if valid+unexpired, else null. */
function verify(cookieValue: string): { issuedAt: number } | null {
  const dot = cookieValue.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = cookieValue.slice(0, dot);
  const providedSig = cookieValue.slice(dot + 1);
  const expectedSig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  if (providedSig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))) return null;
  const issuedAt = Number(payload);
  if (!Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > COOKIE_MAX_AGE_MS) return null;
  return { issuedAt };
}

export function buildSessionCookie(): string {
  const value = sign(String(Date.now()));
  const expires = new Date(Date.now() + COOKIE_MAX_AGE_MS).toUTCString();
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure; Expires=${expires}`;
}

export function buildLogoutCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

function readSessionCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return null;
}

export function isAuthenticated(req: Request): boolean {
  const cookie = readSessionCookie(req);
  if (!cookie) return false;
  return verify(cookie) !== null;
}

export function checkPassword(submitted: string): boolean {
  const expected = env.DASHBOARD_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Express middleware: require auth for API endpoints; return 401 JSON on missing/bad session. */
export function requireAuthApi(req: Request, res: Response, next: NextFunction): void {
  if (!dashboardEnabled()) {
    res.status(404).json({ error: 'dashboard_disabled' });
    return;
  }
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

/** Express middleware: require auth for HTML pages; redirect to /login on miss. */
export function requireAuthPage(req: Request, res: Response, next: NextFunction): void {
  if (!dashboardEnabled()) {
    res.status(404).send('Dashboard not configured.');
    return;
  }
  if (!isAuthenticated(req)) {
    res.redirect(302, '/login');
    return;
  }
  next();
}
