import type { ParsedTokenEvent } from '../../types';

/**
 * Helius enhanced webhook payload (subset we care about).
 * https://docs.helius.dev/webhooks-and-websockets/api-reference/webhook-events
 */
export interface HeliusEnhancedTx {
  signature: string;
  slot?: number;
  timestamp?: number; // unix seconds
  type?: string;
  source?: string;
  feePayer?: string;
  tokenTransfers?: Array<{
    fromUserAccount?: string | null;
    toUserAccount?: string | null;
    fromTokenAccount?: string | null;
    toTokenAccount?: string | null;
    tokenAmount?: number; // human-readable
    rawTokenAmount?: { tokenAmount: string; decimals: number };
    mint: string;
    tokenStandard?: string;
  }>;
  nativeTransfers?: Array<{
    fromUserAccount?: string | null;
    toUserAccount?: string | null;
    amount: number; // lamports
  }>;
  events?: {
    swap?: {
      nativeInput?: { account?: string; amount?: string };
      nativeOutput?: { account?: string; amount?: string };
      tokenInputs?: Array<{ userAccount?: string; mint: string; rawTokenAmount?: { tokenAmount: string; decimals: number } }>;
      tokenOutputs?: Array<{ userAccount?: string; mint: string; rawTokenAmount?: { tokenAmount: string; decimals: number } }>;
    };
  };
}

/** trackedAddresses must be a Set of Solana base58 wallet addresses we monitor. */
export function parseHeliusTransactions(
  txs: HeliusEnhancedTx[],
  trackedAddresses: Set<string>,
  trackedMints: Set<string>,
): ParsedTokenEvent[] {
  const events: ParsedTokenEvent[] = [];

  for (const tx of txs) {
    if (!tx.signature || !tx.timestamp) continue;
    const ts = new Date(tx.timestamp * 1000);

    // Estimate native amount tied to the tracked wallet in this tx (SOL).
    // Use the swap event when present; otherwise sum nativeTransfers involving the wallet.
    const swap = tx.events?.swap;

    for (const transfer of tx.tokenTransfers ?? []) {
      const mint = transfer.mint;
      if (!mint || !trackedMints.has(mint)) continue;
      const from = transfer.fromUserAccount ?? null;
      const to = transfer.toUserAccount ?? null;
      const fromTracked = from && trackedAddresses.has(from);
      const toTracked = to && trackedAddresses.has(to);
      if (!fromTracked && !toTracked) continue;

      const rawAmount = transfer.rawTokenAmount?.tokenAmount ?? null;
      if (!rawAmount) continue;

      // Compute native amount (SOL) attributable, prefer swap-derived; fall back to nativeTransfers
      let nativeAmount: string | null = null;
      if (swap) {
        if (swap.nativeInput?.amount && toTracked) {
          // wallet bought tokens: SOL went out from somewhere paired with this swap
          nativeAmount = lamportsToSol(swap.nativeInput.amount);
        } else if (swap.nativeOutput?.amount && fromTracked) {
          nativeAmount = lamportsToSol(swap.nativeOutput.amount);
        }
      }
      if (nativeAmount === null) {
        const lamports = (tx.nativeTransfers ?? [])
          .filter((n) => n.fromUserAccount === (toTracked ? to : from) || n.toUserAccount === (toTracked ? to : from))
          .reduce((acc, n) => acc + BigInt(Math.trunc(n.amount)), 0n);
        if (lamports > 0n) nativeAmount = lamportsToSol(lamports.toString());
      }

      // Emit one event from the tracked wallet's perspective.
      if (toTracked && to) {
        events.push({
          chain: 'SOLANA',
          txHash: tx.signature,
          blockNumber: tx.slot ? BigInt(tx.slot) : null,
          timestamp: ts,
          contractAddress: mint,
          walletAddress: to,
          counterparty: from,
          rawAmount,
          inbound: true,
          nativeAmount,
          raw: tx,
        });
      }
      if (fromTracked && from) {
        events.push({
          chain: 'SOLANA',
          txHash: tx.signature,
          blockNumber: tx.slot ? BigInt(tx.slot) : null,
          timestamp: ts,
          contractAddress: mint,
          walletAddress: from,
          counterparty: to,
          rawAmount,
          inbound: false,
          nativeAmount,
          raw: tx,
        });
      }
    }
  }

  return events;
}

function lamportsToSol(lamports: string): string {
  // 1 SOL = 1e9 lamports
  const n = BigInt(lamports);
  const whole = n / 1_000_000_000n;
  const frac = n % 1_000_000_000n;
  const fracStr = frac.toString().padStart(9, '0').replace(/0+$/, '');
  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
}
