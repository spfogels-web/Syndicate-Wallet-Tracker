import { prisma } from '../database/prisma';
import { Decimal } from 'decimal.js';
import { Chain, Wallet } from '@prisma/client';
import { normalizeAddress, validateAddress } from '../utils/validation';
import { getTokenBalance, syncSolanaWebhookAddresses } from '../chains/solana/client';
import { getErc20Balance } from '../chains/evm/client';
import { logger } from '../utils/logger';

export interface AddWalletInput {
  chain: Chain;
  contractAddress: string;
  walletAddress: string;
  label: string;
  isLinked?: boolean;
}

export async function addWallet(input: AddWalletInput): Promise<Wallet> {
  if (!validateAddress(input.chain, input.walletAddress)) {
    throw new Error(`Invalid ${input.chain} wallet address: ${input.walletAddress}`);
  }
  const ca = normalizeAddress(input.chain, input.contractAddress);
  const wa = normalizeAddress(input.chain, input.walletAddress);

  const project = await prisma.project.findUnique({
    where: { chain_contractAddress: { chain: input.chain, contractAddress: ca } },
  });
  if (!project) throw new Error('Project not found. Add the token first with /addtoken.');

  // Idempotency: same wallet on same project = no-op
  const existing = await prisma.wallet.findUnique({
    where: { projectId_address: { projectId: project.id, address: wa } },
  });
  if (existing) throw new Error('Wallet is already tracked for this project.');

  // Pull current on-chain balance so first-buy and ownership work even when the wallet
  // already holds tokens before tracking begins.
  let balance: bigint = 0n;
  try {
    balance =
      input.chain === 'SOLANA'
        ? await getTokenBalance(wa, ca)
        : await getErc20Balance(input.chain, ca, wa);
  } catch (err) {
    logger.warn({ err, chain: input.chain, ca, wa }, 'could not seed balance from chain');
  }

  const ownershipPct = computeOwnershipPct(new Decimal(balance.toString()), project.totalSupply);

  const wallet = await prisma.wallet.create({
    data: {
      projectId: project.id,
      address: wa,
      label: input.label,
      isLinked: !!input.isLinked,
      stats: {
        create: {
          currentBalance: new Decimal(balance.toString()),
          ownershipPct,
          // We don't know the historical first_buy_at yet; backfill via Etherscan/Helius history is optional.
          lastActivityAt: balance > 0n ? new Date() : null,
        },
      },
    },
  });

  // Keep Helius webhook in sync for SOL projects
  if (input.chain === 'SOLANA') void resyncSolanaWebhook();

  return wallet;
}

export async function removeWallet(walletAddress: string, chain?: Chain): Promise<number> {
  const wa = chain ? normalizeAddress(chain, walletAddress) : walletAddress.toLowerCase();
  // We delete across all projects this wallet is tracked under.
  const result = await prisma.wallet.deleteMany({
    where: { OR: [{ address: wa }, { address: walletAddress }] },
  });
  void resyncSolanaWebhook();
  return result.count;
}

export async function listWallets(chain: Chain, contractAddress: string) {
  const ca = normalizeAddress(chain, contractAddress);
  const project = await prisma.project.findUnique({
    where: { chain_contractAddress: { chain, contractAddress: ca } },
    include: {
      wallets: {
        include: { stats: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  if (!project) throw new Error('Project not found.');
  return project;
}

export async function getAllTrackedSolanaAddresses(): Promise<string[]> {
  const rows = await prisma.wallet.findMany({
    where: { project: { chain: 'SOLANA' }, isActive: true },
    select: { address: true },
  });
  return Array.from(new Set(rows.map((r) => r.address)));
}

export async function resyncSolanaWebhook(): Promise<void> {
  try {
    const addresses = await getAllTrackedSolanaAddresses();
    await syncSolanaWebhookAddresses(addresses);
  } catch (err) {
    logger.warn({ err }, 'resyncSolanaWebhook failed');
  }
}

export function computeOwnershipPct(balance: Decimal, totalSupply: Decimal | null): Decimal {
  if (!totalSupply || totalSupply.lte(0)) return new Decimal(0);
  return balance.div(totalSupply).mul(100);
}
