import { prisma } from '../database/prisma';
import { Decimal } from 'decimal.js';
import { Prisma, TxType, AlertType } from '@prisma/client';
import type { ParsedTokenEvent } from '../types';
import { logger } from '../utils/logger';
import { ensureLinkedWallet, computeCombinedOwnership } from './linkedWalletService';
import { dispatchAlert } from '../alerts/dispatcher';
import { rawToHuman } from '../utils/format';
import { computeOwnershipPct } from './walletService';

// Heuristic: anything that pairs with a non-zero native amount we treat as a swap (BUY/SELL).
// A pure transfer (no native amount) is TRANSFER_IN / TRANSFER_OUT and may trigger linked-wallet logic.
function classify(event: ParsedTokenEvent): TxType {
  const isSwap = !!event.nativeAmount && Number(event.nativeAmount) > 0;
  if (event.inbound) return isSwap ? 'BUY' : 'TRANSFER_IN';
  return isSwap ? 'SELL' : 'TRANSFER_OUT';
}

export async function handleParsedEvents(events: ParsedTokenEvent[]): Promise<void> {
  // Process serially within a single webhook. Volume per webhook is low.
  for (const ev of events) {
    try {
      await handleSingleEvent(ev);
    } catch (err) {
      logger.error({ err, ev }, 'failed handling event');
    }
  }
}

async function handleSingleEvent(ev: ParsedTokenEvent): Promise<void> {
  // Look up project + wallet
  const project = await prisma.project.findUnique({
    where: { chain_contractAddress: { chain: ev.chain, contractAddress: ev.contractAddress } },
  });
  if (!project || project.isPaused) return;

  const wallet = await prisma.wallet.findUnique({
    where: { projectId_address: { projectId: project.id, address: ev.walletAddress } },
    include: { stats: true, project: true },
  });
  if (!wallet || !wallet.isActive) return;

  const type = classify(ev);
  const rawAmount = new Decimal(ev.rawAmount);
  const native = ev.nativeAmount ? new Decimal(ev.nativeAmount) : null;
  const human = rawToHuman(ev.rawAmount, project.decimals);
  const pricePerToken = native && human.gt(0) ? native.div(human) : null;

  // Idempotent insert via unique (txHash, walletId, type)
  let tx;
  try {
    tx = await prisma.transaction.create({
      data: {
        projectId: project.id,
        walletId: wallet.id,
        txHash: ev.txHash,
        type,
        amount: rawAmount,
        nativeAmount: native ?? undefined,
        pricePerToken: pricePerToken ?? undefined,
        counterparty: ev.counterparty,
        blockNumber: ev.blockNumber ?? undefined,
        timestamp: ev.timestamp,
        rawData: ev.raw as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    if ((err as { code?: string }).code === 'P2002') {
      // duplicate; already processed
      return;
    }
    throw err;
  }

  // Update wallet stats rollups
  const stats = wallet.stats ?? (await prisma.walletStats.create({ data: { walletId: wallet.id } }));
  const updatedStats = await applyStatsUpdate(stats.id, project.totalSupply, type, rawAmount, native, ev.timestamp);

  // Fire alerts (best-effort; we don't fail the tx if Telegram fails)
  try {
    if (type === 'BUY') {
      await dispatchAlert({
        type: AlertType.BUY,
        project,
        wallet: { ...wallet, stats: updatedStats },
        tx,
      });
    } else if (type === 'SELL') {
      await dispatchAlert({
        type: AlertType.SELL,
        project,
        wallet: { ...wallet, stats: updatedStats },
        tx,
      });
    } else if (type === 'TRANSFER_OUT' && ev.counterparty) {
      // Auto-link the recipient (if not already tracked) and emit a LINKED_WALLET alert
      const { child, linkCreated } = await ensureLinkedWallet(wallet, ev.counterparty, ev.txHash, ev.rawAmount);
      if (linkCreated) {
        const combined = await computeCombinedOwnership(wallet.id);
        await dispatchAlert({
          type: AlertType.LINKED_WALLET,
          project,
          wallet: { ...wallet, stats: updatedStats },
          tx,
          extra: { childAddress: child.address, combinedPct: combined },
        });
      } else {
        await dispatchAlert({
          type: AlertType.TRANSFER,
          project,
          wallet: { ...wallet, stats: updatedStats },
          tx,
        });
      }
    } else if (type === 'TRANSFER_IN') {
      await dispatchAlert({
        type: AlertType.TRANSFER,
        project,
        wallet: { ...wallet, stats: updatedStats },
        tx,
      });
    }
  } catch (err) {
    logger.error({ err, txId: tx.id }, 'alert dispatch failed');
  }
}

async function applyStatsUpdate(
  statsId: string,
  totalSupply: Decimal | null | { toString(): string },
  type: TxType,
  rawAmount: Decimal,
  native: Decimal | null,
  timestamp: Date,
) {
  // Recalc balances/totals
  const stats = await prisma.walletStats.findUnique({ where: { id: statsId } });
  if (!stats) throw new Error('stats not found');

  let balance = new Decimal(stats.currentBalance.toString());
  let totalBought = new Decimal(stats.totalBought.toString());
  let totalSold = new Decimal(stats.totalSold.toString());
  let nativeSpent = new Decimal(stats.nativeSpent.toString());
  let nativeReceived = new Decimal(stats.nativeReceived.toString());

  let firstBuyAt = stats.firstBuyAt;
  let lastBuyAt = stats.lastBuyAt;
  let lastSellAt = stats.lastSellAt;

  switch (type) {
    case 'BUY':
      balance = balance.add(rawAmount);
      totalBought = totalBought.add(rawAmount);
      if (native) nativeSpent = nativeSpent.add(native);
      if (!firstBuyAt) firstBuyAt = timestamp;
      lastBuyAt = timestamp;
      break;
    case 'SELL':
      balance = Decimal.max(0, balance.sub(rawAmount));
      totalSold = totalSold.add(rawAmount);
      if (native) nativeReceived = nativeReceived.add(native);
      lastSellAt = timestamp;
      break;
    case 'TRANSFER_IN':
      balance = balance.add(rawAmount);
      // We don't count transfers as buys for cost basis.
      break;
    case 'TRANSFER_OUT':
      balance = Decimal.max(0, balance.sub(rawAmount));
      break;
  }

  // avg entry price = nativeSpent / totalBought (in human units)
  const avgEntry =
    totalBought.gt(0) && nativeSpent.gt(0) ? nativeSpent.div(totalBought) : null;

  const ts = totalSupply ? new Decimal(totalSupply.toString()) : null;
  const ownershipPct = computeOwnershipPct(balance, ts);

  return prisma.walletStats.update({
    where: { id: statsId },
    data: {
      currentBalance: balance,
      totalBought,
      totalSold,
      nativeSpent,
      nativeReceived,
      avgEntryPrice: avgEntry ?? undefined,
      ownershipPct,
      firstBuyAt: firstBuyAt ?? undefined,
      lastBuyAt: lastBuyAt ?? undefined,
      lastSellAt: lastSellAt ?? undefined,
      lastActivityAt: timestamp,
    },
  });
}
