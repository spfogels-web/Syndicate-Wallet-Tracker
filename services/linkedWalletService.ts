import { prisma } from '../database/prisma';
import { Decimal } from 'decimal.js';
import type { Project, Wallet, WalletStats } from '@prisma/client';
import { addWallet, computeOwnershipPct } from './walletService';
import { logger } from '../utils/logger';

/**
 * Called when a tracked wallet sends tokens to a previously-untracked address.
 * Creates a new linked wallet and records the link edge.
 */
export async function ensureLinkedWallet(
  parentWallet: Wallet & { project: Project },
  newAddress: string,
  txHash: string,
  rawAmountTransferred: string,
): Promise<{ child: Wallet; linkCreated: boolean }> {
  // Already tracked under this project?
  const existingChild = await prisma.wallet.findUnique({
    where: { projectId_address: { projectId: parentWallet.projectId, address: newAddress } },
  });
  let child = existingChild;

  if (!child) {
    child = await addWallet({
      chain: parentWallet.project.chain,
      contractAddress: parentWallet.project.contractAddress,
      walletAddress: newAddress,
      label: `Linked ← ${parentWallet.label}`,
      isLinked: true,
    });
  }

  // Upsert the directed edge parent → child
  const edge = await prisma.linkedWallet.upsert({
    where: { parentWalletId_childWalletId: { parentWalletId: parentWallet.id, childWalletId: child.id } },
    create: {
      parentWalletId: parentWallet.id,
      childWalletId: child.id,
      transferTxHash: txHash,
      amountTransferred: new Decimal(rawAmountTransferred),
    },
    update: {},
  });

  return { child, linkCreated: edge.transferTxHash === txHash };
}

/**
 * Walk the link graph rooted at `walletId` (in either direction) and compute combined
 * ownership %. We treat the graph as undirected: any wallet reachable through linked
 * edges contributes to the combined ownership.
 */
export async function computeCombinedOwnership(walletId: string): Promise<Decimal> {
  const seed = await prisma.wallet.findUnique({
    where: { id: walletId },
    include: { project: true },
  });
  if (!seed) return new Decimal(0);

  // BFS the undirected link graph, but only across wallets in the same project.
  const visited = new Set<string>([seed.id]);
  const queue: string[] = [seed.id];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const edges = await prisma.linkedWallet.findMany({
      where: { OR: [{ parentWalletId: current }, { childWalletId: current }] },
      select: { parentWalletId: true, childWalletId: true },
    });
    for (const e of edges) {
      const other = e.parentWalletId === current ? e.childWalletId : e.parentWalletId;
      if (!visited.has(other)) {
        visited.add(other);
        queue.push(other);
      }
    }
  }

  const wallets = await prisma.wallet.findMany({
    where: { id: { in: Array.from(visited) }, projectId: seed.projectId },
    include: { stats: true },
  });

  const totalBalance = wallets
    .map((w) => (w.stats?.currentBalance ? new Decimal(w.stats.currentBalance.toString()) : new Decimal(0)))
    .reduce((acc, b) => acc.add(b), new Decimal(0));

  return computeOwnershipPct(totalBalance, seed.project.totalSupply ? new Decimal(seed.project.totalSupply.toString()) : null);
}

export async function getLinkedSiblings(walletId: string): Promise<Wallet[]> {
  const edges = await prisma.linkedWallet.findMany({
    where: { OR: [{ parentWalletId: walletId }, { childWalletId: walletId }] },
    include: { parentWallet: true, childWallet: true },
  });
  const out: Wallet[] = [];
  const seen = new Set<string>([walletId]);
  for (const e of edges) {
    for (const w of [e.parentWallet, e.childWallet]) {
      if (!seen.has(w.id)) {
        seen.add(w.id);
        out.push(w);
      }
    }
  }
  return out;
}

export async function getRootWallet(walletId: string): Promise<Wallet | null> {
  // Walk up the parent chain. If the wallet is not linked, it's its own root.
  let current: Wallet | null = await prisma.wallet.findUnique({ where: { id: walletId } });
  if (!current) return null;
  let depth = 0;
  while (current?.isLinked && depth < 32) {
    const edge = await prisma.linkedWallet.findFirst({
      where: { childWalletId: current.id },
      orderBy: { linkedAt: 'asc' },
    });
    if (!edge) break;
    const parent = await prisma.wallet.findUnique({ where: { id: edge.parentWalletId } });
    if (!parent) break;
    current = parent;
    depth++;
  }
  if (depth === 32) logger.warn({ walletId }, 'getRootWallet hit depth limit; possible cycle');
  return current;
}
