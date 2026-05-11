import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { prisma } from '../../database/prisma';
import { parseHeliusTransactions, HeliusEnhancedTx } from './parser';
import { handleParsedEvents } from '../../services/transactionService';

export async function handleSolanaWebhook(req: Request, res: Response): Promise<void> {
  // Verify auth header if configured
  if (env.HELIUS_WEBHOOK_AUTH_HEADER) {
    const got = req.header('authorization') ?? req.header('Authorization');
    if (got !== env.HELIUS_WEBHOOK_AUTH_HEADER) {
      logger.warn('rejected solana webhook: bad auth header');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
  }

  // ack quickly so Helius doesn't retry; do work async
  res.status(200).json({ ok: true });

  const payload = req.body;
  const txs: HeliusEnhancedTx[] = Array.isArray(payload) ? payload : [payload];

  try {
    // Build in-memory tracked sets to avoid DB roundtrips per transfer
    const wallets = await prisma.wallet.findMany({
      where: { project: { chain: 'SOLANA', isPaused: false }, isActive: true },
      select: { address: true, project: { select: { contractAddress: true } } },
    });
    const trackedAddresses = new Set(wallets.map((w) => w.address));
    const trackedMints = new Set(wallets.map((w) => w.project.contractAddress));

    const events = parseHeliusTransactions(txs, trackedAddresses, trackedMints);
    if (events.length === 0) return;
    await handleParsedEvents(events);
  } catch (err) {
    logger.error({ err }, 'failed processing solana webhook');
  }
}
