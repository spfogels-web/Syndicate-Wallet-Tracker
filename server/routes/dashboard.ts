import { Router, type Request, type Response } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import {
  buildLogoutCookie,
  buildSessionCookie,
  checkPassword,
  dashboardEnabled,
  isAuthenticated,
  requireAuthPage,
} from '../dashboardAuth';
import { addClient, removeClient } from '../sse';
import { requireAuthApi } from '../dashboardAuth';

export const dashboardRouter = Router();

const VIEW_DIR = path.join(__dirname, '..', 'views');

function readView(file: string): string {
  return fs.readFileSync(path.join(VIEW_DIR, file), 'utf8');
}

// Root → /dashboard or /login depending on auth
dashboardRouter.get('/', (req: Request, res: Response) => {
  if (!dashboardEnabled()) {
    res.status(404).send('Dashboard not configured. Set DASHBOARD_PASSWORD and DASHBOARD_SESSION_SECRET.');
    return;
  }
  res.redirect(302, isAuthenticated(req) ? '/dashboard' : '/login');
});

// Login page
dashboardRouter.get('/login', (_req: Request, res: Response) => {
  if (!dashboardEnabled()) {
    res.status(404).send('Dashboard not configured.');
    return;
  }
  res.type('html').send(readView('login.html'));
});

// Login form submission
dashboardRouter.post('/login', (req: Request, res: Response) => {
  if (!dashboardEnabled()) {
    res.status(404).json({ error: 'dashboard_disabled' });
    return;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!checkPassword(password)) {
    res.status(401).type('html').send(readView('login.html').replace('<!--ERROR-->', '<p class="text-red-400 text-sm">Wrong password.</p>'));
    return;
  }
  res.setHeader('Set-Cookie', buildSessionCookie());
  res.redirect(302, '/dashboard');
});

// Logout
dashboardRouter.post('/logout', (_req: Request, res: Response) => {
  res.setHeader('Set-Cookie', buildLogoutCookie());
  res.redirect(302, '/login');
});

// Main dashboard page (auth required)
dashboardRouter.get('/dashboard', requireAuthPage, (_req: Request, res: Response) => {
  res.type('html').send(readView('dashboard.html'));
});

// SSE event stream (auth required)
dashboardRouter.get('/api/stream', requireAuthApi, (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx-style buffering if present
  res.flushHeaders?.();

  // Initial hello so the client knows the connection is up
  res.write(`: connected ${Date.now()}\n\n`);

  const clientId = addClient(res);

  // Periodic heartbeat to prevent intermediaries from closing idle connections
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      // ignore — disconnect handler will clean up
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(clientId);
  });
});
