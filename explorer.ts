import { prisma } from '../database/prisma';
import { Chain } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { getMintInfo } from '../chains/solana/client';
import { getErc20Info } from '../chains/evm/client';
import { normalizeAddress, validateAddress } from '../utils/validation';
import { logger } from '../utils/logger';

export interface AddProjectInput {
  chain: Chain;
  contractAddress: string;
  name: string;
  telegramChatId?: string | null;
}

/** Idempotently create a Project (token tracking entry). */
export async function addProject(input: AddProjectInput) {
  if (!validateAddress(input.chain, input.contractAddress)) {
    throw new Error(`Invalid ${input.chain} contract address: ${input.contractAddress}`);
  }
  const ca = normalizeAddress(input.chain, input.contractAddress);

  const existing = await prisma.project.findUnique({
    where: { chain_contractAddress: { chain: input.chain, contractAddress: ca } },
  });
  if (existing) throw new Error('Token is already being tracked for this chain.');

  // Fetch supply / decimals on-chain so we can compute ownership pct correctly.
  let decimals = 0;
  let totalSupply: bigint = 0n;
  let symbol: string | null = null;
  try {
    if (input.chain === 'SOLANA') {
      const m = await getMintInfo(ca);
      decimals = m.decimals;
      totalSupply = m.supply;
    } else {
      const m = await getErc20Info(input.chain, ca);
      decimals = m.decimals;
      totalSupply = m.totalSupply;
      symbol = m.symbol;
    }
  } catch (err) {
    logger.warn({ err, chain: input.chain, ca }, 'failed to fetch token metadata; saving with placeholders');
  }

  return prisma.project.create({
    data: {
      chain: input.chain,
      contractAddress: ca,
      name: input.name,
      symbol,
      decimals,
      totalSupply: new Decimal(totalSupply.toString()),
      telegramChatId: input.telegramChatId ?? null,
    },
  });
}

export async function removeProject(chain: Chain, contractAddress: string) {
  const ca = normalizeAddress(chain, contractAddress);
  return prisma.project.delete({
    where: { chain_contractAddress: { chain, contractAddress: ca } },
  });
}

export async function listProjects() {
  return prisma.project.findMany({
    orderBy: [{ chain: 'asc' }, { createdAt: 'asc' }],
    include: { _count: { select: { wallets: true } } },
  });
}

export async function findProject(chain: Chain, contractAddress: string) {
  const ca = normalizeAddress(chain, contractAddress);
  return prisma.project.findUnique({
    where: { chain_contractAddress: { chain, contractAddress: ca } },
  });
}

export async function setPaused(projectId: string, paused: boolean) {
  return prisma.project.update({ where: { id: projectId }, data: { isPaused: paused } });
}

export async function refreshTotalSupply(projectId: string): Promise<void> {
  const p = await prisma.project.findUnique({ where: { id: projectId } });
  if (!p) return;
  try {
    if (p.chain === 'SOLANA') {
      const m = await getMintInfo(p.contractAddress);
      await prisma.project.update({
        where: { id: projectId },
        data: { totalSupply: new Decimal(m.supply.toString()), decimals: m.decimals },
      });
    } else {
      const m = await getErc20Info(p.chain, p.contractAddress);
      await prisma.project.update({
        where: { id: projectId },
        data: { totalSupply: new Decimal(m.totalSupply.toString()), decimals: m.decimals, symbol: m.symbol },
      });
    }
  } catch (err) {
    logger.warn({ err, projectId }, 'refreshTotalSupply failed');
  }
}
