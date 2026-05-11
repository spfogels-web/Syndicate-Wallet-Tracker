import { createPublicClient, http, erc20Abi, getAddress, type Address, type PublicClient } from 'viem';
import { mainnet, base } from 'viem/chains';
import axios, { AxiosInstance } from 'axios';
import crypto from 'node:crypto';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { withRetry } from '../../utils/retry';
import type { Chain } from '@prisma/client';

// ---- viem clients (one per chain) ----
function rpcUrl(chain: Chain): string {
  if (chain === 'ETHEREUM') return `https://eth-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
  if (chain === 'BASE') return `https://base-mainnet.g.alchemy.com/v2/${env.ALCHEMY_API_KEY}`;
  throw new Error(`Unsupported EVM chain: ${chain}`);
}

const clients: Partial<Record<Chain, PublicClient>> = {};

export function getEvmClient(chain: Chain): PublicClient {
  if (clients[chain]) return clients[chain]!;
  const c = createPublicClient({
    chain: chain === 'ETHEREUM' ? mainnet : base,
    transport: http(rpcUrl(chain)),
  }) as PublicClient;
  clients[chain] = c;
  return c;
}

export async function getErc20Info(
  chain: Chain,
  contract: string,
): Promise<{ decimals: number; symbol: string; totalSupply: bigint }> {
  const client = getEvmClient(chain);
  const address = getAddress(contract) as Address;
  return withRetry(
    async () => {
      const [decimals, symbol, totalSupply] = await Promise.all([
        client.readContract({ address, abi: erc20Abi, functionName: 'decimals' }),
        client.readContract({ address, abi: erc20Abi, functionName: 'symbol' }),
        client.readContract({ address, abi: erc20Abi, functionName: 'totalSupply' }),
      ]);
      return { decimals: Number(decimals), symbol: symbol as string, totalSupply: totalSupply as bigint };
    },
    { label: `evm.getErc20Info:${chain}:${contract}` },
  );
}

export async function getErc20Balance(chain: Chain, contract: string, wallet: string): Promise<bigint> {
  const client = getEvmClient(chain);
  return withRetry(
    async () => {
      const balance = await client.readContract({
        address: getAddress(contract) as Address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [getAddress(wallet) as Address],
      });
      return balance as bigint;
    },
    { label: `evm.getErc20Balance:${chain}:${wallet}` },
  );
}

// ---- Alchemy Notify (webhooks) ----
const alchemyNotifyApi: AxiosInstance = axios.create({
  baseURL: 'https://dashboard.alchemy.com/api',
  timeout: 15_000,
  headers: { 'X-Alchemy-Token': env.ALCHEMY_WEBHOOK_SIGNING_KEY ?? '' },
});

/** Verify HMAC-SHA256 signature on incoming Alchemy webhook (X-Alchemy-Signature). */
export function verifyAlchemySignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.ALCHEMY_WEBHOOK_SIGNING_KEY) return true; // not configured = skip
  if (!signatureHeader) return false;
  const hmac = crypto.createHmac('sha256', env.ALCHEMY_WEBHOOK_SIGNING_KEY);
  hmac.update(rawBody);
  const digest = hmac.digest('hex');
  // timing-safe compare
  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(signatureHeader, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Convenience wrapper if you want to programmatically manage Alchemy webhooks.
 * In practice we recommend creating an "Address Activity" webhook in the Alchemy
 * dashboard once per chain, then using these methods to keep the address list
 * in sync with our tracked wallets.
 */
export async function alchemyAddAddresses(webhookId: string, addresses: string[]): Promise<void> {
  if (addresses.length === 0) return;
  await alchemyNotifyApi.patch('/update-webhook-addresses', {
    webhook_id: webhookId,
    addresses_to_add: addresses,
    addresses_to_remove: [],
  });
  logger.info({ webhookId, count: addresses.length }, 'alchemy: added addresses');
}

export async function alchemyRemoveAddresses(webhookId: string, addresses: string[]): Promise<void> {
  if (addresses.length === 0) return;
  await alchemyNotifyApi.patch('/update-webhook-addresses', {
    webhook_id: webhookId,
    addresses_to_add: [],
    addresses_to_remove: addresses,
  });
}
