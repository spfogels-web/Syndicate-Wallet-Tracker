import { Connection, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddress, getAccount, getMint } from '@solana/spl-token';
import axios, { AxiosInstance } from 'axios';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { withRetry } from '../../utils/retry';

const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`;
const HELIUS_API_BASE = 'https://api.helius.xyz/v0';

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
  const { data } = await heliusApi.get<HeliusWebhookConfig[] | null>('/webhooks');
  // Helius returns an empty array as null/undefined for projects with no webhooks
  return Array.isArray(data) ? data : [];
}

/** Raw GET /webhooks — never throws on non-2xx, returns status + body for diagnostics. */
export async function listWebhooksRaw(): Promise<{ status: number; data: unknown }> {
  const resp = await heliusApi.get('/webhooks', { validateStatus: () => true });
  return { status: resp.status, data: resp.data };
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
  const unique = Array.from(new Set(addresses));

  // Find existing webhook by URL path suffix (forgiving — Helius's create-via-API
  // has been rejecting our valid URLs, so the user creates the webhook once via
  // the Helius dashboard and this sync keeps its address list up to date).
  const list = await listWebhooks();
  const ours = list.find(
    (w) => typeof w.webhookURL === 'string' && w.webhookURL.toLowerCase().includes('/webhooks/solana'),
  );

  if (!ours || !ours.webhookID) {
    logger.warn(
      { count: list.length },
      'no Helius webhook with /webhooks/solana found — create one in the Helius dashboard once, then sync will keep its address list current',
    );
    return;
  }

  // PUT update. Helius requires webhookURL in the body (returns "Webhook URL is required" otherwise).
  // Use the URL Helius itself returned to avoid any string-mismatch validation.
  const updateBody: Omit<HeliusWebhookConfig, 'webhookID'> = {
    webhookURL: ours.webhookURL,
    transactionTypes: ['ANY'],
    accountAddresses: unique,
    webhookType: (ours.webhookType ?? 'enhanced') as HeliusWebhookConfig['webhookType'],
    ...(env.HELIUS_WEBHOOK_AUTH_HEADER ? { authHeader: env.HELIUS_WEBHOOK_AUTH_HEADER } : {}),
  };
  await updateWebhook(ours.webhookID, updateBody);
  logger.info({ id: ours.webhookID, count: unique.length }, 'Helius webhook addresses synced');
}
