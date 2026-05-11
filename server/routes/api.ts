import { Router, type Request, type Response } from 'express';
import { Chain } from '@prisma/client';
import { prisma } from '../../database/prisma';
import { requireAuthApi } from '../dashboardAuth';
import { addProject, removeProject, setPaused, listProjects } from '../../services/tokenService';
import {
  addWallet,
  removeWallet,
  searchWallets,
  updateWalletMeta,
} from '../../services/walletService';
import { broadcast } from '../sse';
import { logger } from '../../utils/logger';

export const apiRouter = Router();

// All API routes require auth
apiRouter.use(requireAuthApi);

function parseChain(raw: unknown): Chain | null {
  if (typeof raw !== 'string') return null;
  const norm = raw.toUpperCase();
  if (norm === 'SOLANA' || norm === 'SOL') return 'SOLANA';
  if (norm === 'ETHEREUM' || norm === 'ETH') return 'ETHEREUM';
  if (norm === 'BASE') return 'BASE';
  return null;
}

function errorJson(res: Response, status: number, message: string): void {
  res.status(status).json({ error: message });
}

// ---- METRICS / OVERVIEW ----

apiRouter.get('/metrics', async (_req: Request, res: Response) => {
  try {
    const [tokenCount, walletCount, alertCount24h, transactionCount24h] = await Promise.all([
      prisma.project.count(),
      prisma.wallet.count({ where: { isActive: true } }),
      prisma.alert.count({ where: { sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
      prisma.transaction.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
    ]);
    res.json({
      tokens: tokenCount,
      wallets: walletCount,
      alerts24h: alertCount24h,
      transactions24h: transactionCount24h,
    });
  } catch (err) {
    logger.error({ err }, '/api/metrics failed');
    errorJson(res, 500, 'internal_error');
  }
});

// ---- TOKENS (PROJECTS) ----

apiRouter.get('/tokens', async (_req: Request, res: Response) => {
  try {
    const projects = await listProjects();
    res.json(
      projects.map((p) => ({
        id: p.id,
        chain: p.chain,
        contractAddress: p.contractAddress,
        name: p.name,
        symbol: p.symbol,
        decimals: p.decimals,
        totalSupply: p.totalSupply ? p.totalSupply.toString() : null,
        isPaused: p.isPaused,
        telegramChatId: p.telegramChatId,
        walletCount: p._count.wallets,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      })),
    );
  } catch (err) {
    logger.error({ err }, '/api/tokens GET failed');
    errorJson(res, 500, 'internal_error');
  }
});

apiRouter.post('/tokens', async (req: Request, res: Response) => {
  const { chain: chainRaw, contractAddress, name } = req.body ?? {};
  const chain = parseChain(chainRaw);
  if (!chain) return errorJson(res, 400, 'invalid_chain');
  if (typeof contractAddress !== 'string' || !contractAddress.trim()) return errorJson(res, 400, 'invalid_contract_address');
  if (typeof name !== 'string' || !name.trim()) return errorJson(res, 400, 'invalid_name');

  try {
    const project = await addProject({ chain, contractAddress: contractAddress.trim(), name: name.trim() });
    broadcast({ type: 'token_added', projectId: project.id, name: project.name, chain: project.chain });
    res.status(201).json({ id: project.id });
  } catch (err) {
    logger.warn({ err }, '/api/tokens POST failed');
    errorJson(res, 400, (err as Error).message);
  }
});

apiRouter.delete('/tokens/:id', async (req: Request, res: Response) => {
  try {
    const project = await prisma.project.findUnique({ where: { id: String(req.params.id) } });
    if (!project) return errorJson(res, 404, 'not_found');
    await removeProject(project.chain, project.contractAddress);
    broadcast({ type: 'token_removed', projectId: project.id });
    res.json({ ok: true });
  } catch (err) {
    logger.warn({ err }, '/api/tokens DELETE failed');
    errorJson(res, 400, (err as Error).message);
  }
});

apiRouter.patch('/tokens/:id/pause', async (req: Request, res: Response) => {
  const { paused } = req.body ?? {};
  if (typeof paused !== 'boolean') return errorJson(res, 400, 'invalid_paused');
  try {
    await setPaused(String(req.params.id), paused);
    res.json({ ok: true });
  } catch (err) {
    errorJson(res, 400, (err as Error).message);
  }
});

// ---- WALLETS ----

apiRouter.get('/tokens/:id/wallets', async (req: Request, res: Response) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: String(req.params.id) },
      include: {
        wallets: {
          include: { stats: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!project) return errorJson(res, 404, 'not_found');
    res.json({
      project: {
        id: project.id,
        name: project.name,
        chain: project.chain,
        symbol: project.symbol,
        decimals: project.decimals,
        totalSupply: project.totalSupply ? project.totalSupply.toString() : null,
        contractAddress: project.contractAddress,
      },
      wallets: project.wallets.map((w) => ({
        id: w.id,
        address: w.address,
        label: w.label,
        twitterHandle: w.twitterHandle,
        telegramHandle: w.telegramHandle,
        website: w.website,
        notes: w.notes,
        tags: w.tags,
        isLinked: w.isLinked,
        isActive: w.isActive,
        createdAt: w.createdAt.toISOString(),
        stats: w.stats
          ? {
              currentBalance: w.stats.currentBalance.toString(),
              totalBought: w.stats.totalBought.toString(),
              totalSold: w.stats.totalSold.toString(),
              nativeSpent: w.stats.nativeSpent.toString(),
              nativeReceived: w.stats.nativeReceived.toString(),
              avgEntryPrice: w.stats.avgEntryPrice ? w.stats.avgEntryPrice.toString() : null,
              ownershipPct: w.stats.ownershipPct.toString(),
              firstBuyAt: w.stats.firstBuyAt?.toISOString() ?? null,
              lastBuyAt: w.stats.lastBuyAt?.toISOString() ?? null,
              lastSellAt: w.stats.lastSellAt?.toISOString() ?? null,
              lastActivityAt: w.stats.lastActivityAt?.toISOString() ?? null,
            }
          : null,
      })),
    });
  } catch (err) {
    logger.error({ err }, '/api/tokens/:id/wallets failed');
    errorJson(res, 500, 'internal_error');
  }
});

function normStr(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

apiRouter.post('/tokens/:id/wallets', async (req: Request, res: Response) => {
  const { walletAddress, label, twitterHandle, telegramHandle, website, notes, tags } = req.body ?? {};
  if (typeof walletAddress !== 'string' || !walletAddress.trim()) return errorJson(res, 400, 'invalid_wallet_address');
  if (typeof label !== 'string' || !label.trim()) return errorJson(res, 400, 'invalid_label');
  try {
    const project = await prisma.project.findUnique({ where: { id: String(req.params.id) } });
    if (!project) return errorJson(res, 404, 'token_not_found');
    const wallet = await addWallet({
      chain: project.chain,
      contractAddress: project.contractAddress,
      walletAddress: walletAddress.trim(),
      label: label.trim(),
      twitterHandle: normStr(twitterHandle),
      telegramHandle: normStr(telegramHandle),
      website: normStr(website),
      notes: normStr(notes),
      tags: Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [],
    });
    broadcast({
      type: 'wallet_added',
      walletId: wallet.id,
      projectId: project.id,
      address: wallet.address,
      label: wallet.label,
    });
    res.status(201).json({ id: wallet.id });
  } catch (err) {
    logger.warn({ err }, '/api/wallets POST failed');
    errorJson(res, 400, (err as Error).message);
  }
});

apiRouter.patch('/wallets/:id', async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.wallet.findUnique({ where: { id } });
    if (!existing) return errorJson(res, 404, 'not_found');
    const body = req.body ?? {};
    const wallet = await updateWalletMeta(id, {
      label: typeof body.label === 'string' && body.label.trim() ? body.label.trim() : undefined,
      twitterHandle: 'twitterHandle' in body ? normStr(body.twitterHandle) : undefined,
      telegramHandle: 'telegramHandle' in body ? normStr(body.telegramHandle) : undefined,
      website: 'website' in body ? normStr(body.website) : undefined,
      notes: 'notes' in body ? normStr(body.notes) : undefined,
      tags: Array.isArray(body.tags)
        ? body.tags.map((t: unknown) => String(t).trim()).filter(Boolean)
        : undefined,
    });
    broadcast({
      type: 'wallet_added',
      walletId: wallet.id,
      projectId: wallet.projectId,
      address: wallet.address,
      label: wallet.label,
    });
    res.json({ ok: true });
  } catch (err) {
    logger.warn({ err }, '/api/wallets PATCH failed');
    errorJson(res, 400, (err as Error).message);
  }
});

apiRouter.delete('/wallets/:address', async (req: Request, res: Response) => {
  try {
    const count = await removeWallet(String(req.params.address));
    broadcast({ type: 'wallet_removed', walletId: String(req.params.address) });
    res.json({ ok: true, removed: count });
  } catch (err) {
    errorJson(res, 400, (err as Error).message);
  }
});

apiRouter.get('/wallets', async (req: Request, res: Response) => {
  try {
    const q = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const wallets = await searchWallets(q || null, 200);
    res.json(
      wallets.map((w) => ({
        id: w.id,
        address: w.address,
        label: w.label,
        twitterHandle: w.twitterHandle,
        telegramHandle: w.telegramHandle,
        website: w.website,
        notes: w.notes,
        tags: w.tags,
        isLinked: w.isLinked,
        isActive: w.isActive,
        createdAt: w.createdAt.toISOString(),
        project: w.project,
        stats: w.stats
          ? {
              currentBalance: w.stats.currentBalance.toString(),
              ownershipPct: w.stats.ownershipPct.toString(),
              totalBought: w.stats.totalBought.toString(),
              totalSold: w.stats.totalSold.toString(),
              nativeSpent: w.stats.nativeSpent.toString(),
              nativeReceived: w.stats.nativeReceived.toString(),
              avgEntryPrice: w.stats.avgEntryPrice?.toString() ?? null,
              firstBuyAt: w.stats.firstBuyAt?.toISOString() ?? null,
              lastBuyAt: w.stats.lastBuyAt?.toISOString() ?? null,
              lastSellAt: w.stats.lastSellAt?.toISOString() ?? null,
              lastActivityAt: w.stats.lastActivityAt?.toISOString() ?? null,
            }
          : null,
      })),
    );
  } catch (err) {
    logger.error({ err }, '/api/wallets GET failed');
    errorJson(res, 500, 'internal_error');
  }
});

// ---- RECENT ALERTS (for live feed initial load) ----

apiRouter.get('/alerts', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
  try {
    const alerts = await prisma.alert.findMany({
      orderBy: { sentAt: 'desc' },
      take: limit,
      include: {
        project: { select: { name: true, chain: true, symbol: true, decimals: true } },
        wallet: { select: { label: true, address: true } },
        transaction: {
          select: {
            txHash: true,
            amount: true,
            nativeAmount: true,
            type: true,
            timestamp: true,
          },
        },
      },
    });
    res.json(
      alerts.map((a) => ({
        id: a.id,
        type: a.type,
        sentAt: a.sentAt.toISOString(),
        project: a.project,
        wallet: a.wallet,
        transaction: a.transaction
          ? {
              txHash: a.transaction.txHash,
              amount: a.transaction.amount.toString(),
              nativeAmount: a.transaction.nativeAmount ? a.transaction.nativeAmount.toString() : null,
              type: a.transaction.type,
              timestamp: a.transaction.timestamp.toISOString(),
            }
          : null,
      })),
    );
  } catch (err) {
    logger.error({ err }, '/api/alerts failed');
    errorJson(res, 500, 'internal_error');
  }
});
