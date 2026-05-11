import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, getMint } from '@solana/spl-token';
import axios, { AxiosInstance } from 'axios';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { withRetry } from '../../utils/retry';

const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
const HELIUS_API_BASE = 'https://api-mainnet.helius-rpc.com/v0';

export const solanaConnection = new Connection(HELIUS_RPC, 'confirmed');

const heliusApi: AxiosInstance = axios.create({
  baseURL: HELIUS_API_BASE,
  timeout: 15_000,
  params: { 'api-key': env.HELIUS_API_KEY },
});

/** Fetch SPL token mint info (decimals, supply). */
export async function getMintInfo(mint: string): Promise<{ decimals: number; supply: bigint }> {
  return withRetry(
    async () => {
      const mintPubkey = new PublicKey(mint);
      const info = await getMint(solanaConnection, mintPubkey);
      return { decimals: info.decimals, supply: info.supply };
    },
    { label: `solana.getMintInfo:${mint}` },
  );
}

/** Get an SPL token balance for a wallet (raw amount). Returns 0n if no ATA exists. */
export async function getTokenBalance(walletAddress: string, mint: string): Promise<bigint> {
  return withRetry(
    async () => {
      const wallet = new PublicKey(walletAddress);
      const mintPubkey = new PublicKey(mint);
      const ata = await getAssociatedTokenAddress(mintPubkey, wallet, true);
      try {
        const acct = await getAccount(solanaConnection, ata);
        return acct.amount;
      } catch {
        // Account may not exist; treat as zero balance
        return 0n;
      }
    },
    { label: `solana.getTokenBalance:${walletAddress}` },
  );
}

// ---- Helius webhook management ----

export interface HeliusWebhookConfig {
  webhookID?: string;
  webhookURL: string;
  transactionTypes: string[];
  accountAddresses: string[];
  webhookType: 'enhanced' | 'enhancedDevnet' | 'raw' | 'rawDevnet';
  authHeader?: string;
}

export async function listWebhooks(): Promise<HeliusWebhookConfig[]> {
  const { data } = await heliusApi.get<HeliusWebhookConfig[]>('/webhooks');
  return data;
}

export async function createWebhook(cfg: Omit<HeliusWebhookConfig, 'webhookID'>): Promise<HeliusWebhookConfig> {
  const { data } = await heliusApi.post<HeliusWebhookConfig>('/webhooks', cfg);
  logger.info({ id: data.webhookID }, 'Helius webhook created');
  return data;
}

export async function updateWebhook(id: string, cfg: Omit<HeliusWebhookConfig, 'webhookID'>): Promise<HeliusWebhookConfig> {
  const { data } = await heliusApi.put<HeliusWebhookConfig>(`/webhooks/${id}`, cfg);
  return data;
}

export async function deleteWebhook(id: string): Promise<void> {
  await heliusApi.delete(`/webhooks/${id}`);
}

/**
 * Sync the set of tracked Solana wallet addresses to a single Helius webhook.
 * Helius limits ~100k addresses per webhook; one webhook is plenty here.
 */
export async function syncSolanaWebhookAddresses(addresses: string[]): Promise<void> {
  if (!env.PUBLIC_URL) {
    logger.warn('PUBLIC_URL not set; skipping Helius webhook sync');
    return;
  }
  const webhookURL = `${env.PUBLIC_URL.replace(/\/+$/, '')}/webhooks/solana`;
  const desired: Omit<HeliusWebhookConfig, 'webhookID'> = {
    webhookURL,
    transactionTypes: ['ANY'],
    accountAddresses: Array.from(new Set(addresses)),
    webhookType: 'enhanced',
    ...(env.HELIUS_WEBHOOK_AUTH_HEADER ? { authHeader: env.HELIUS_WEBHOOK_AUTH_HEADER } : {}),
  };

  const existing = await listWebhooks();
  const ours = existing.find((w) => w.webhookURL === webhookURL);
  if (!ours) {
    if (desired.accountAddresses.length === 0) return; // no addresses → don't create empty webhook
    await createWebhook(desired);
  } else if (ours.webhookID) {
    await updateWebhook(ours.webhookID, desired);
  }
}
