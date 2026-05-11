import type { ParsedTokenEvent } from '../../types';

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

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

      // Compute native amount (SOL) attributable, in order of preference:
      // 1. events.swap.nativeInput/Output — set on Jupiter and some DEXes
      // 2. tx.nativeTransfers — native SOL movement involving the wallet
      // 3. WSOL transfers in tokenTransfers — pump.fun and other AMMs wrap SOL,
      //    so the "SOL spent/received" lives inside tokenTransfers under WSOL mint
      let nativeAmount: string | null = null;
      const userAddr = toTracked && to ? to : fromTracked && from ? from : null;

      if (swap) {
        if (swap.nativeInput?.amount && toTracked) {
          nativeAmount = lamportsToSol(swap.nativeInput.amount);
        } else if (swap.nativeOutput?.amount && fromTracked) {
          nativeAmount = lamportsToSol(swap.nativeOutput.amount);
        }
      }
      if (nativeAmount === null && userAddr) {
        const lamports = (tx.nativeTransfers ?? [])
          .filter((n) => n.fromUserAccount === userAddr || n.toUserAccount === userAddr)
          .reduce((acc, n) => acc + BigInt(Math.trunc(n.amount)), 0n);
        if (lamports > 0n) nativeAmount = lamportsToSol(lamports.toString());
      }
      if (nativeAmount === null && userAddr) {
        // WSOL fallback for AMM swaps (pump.fun, Raydium, Orca, etc.)
        // BUY:  user sent WSOL out → look for WSOL transfers with fromUserAccount = user
        // SELL: user received WSOL in → look for WSOL transfers with toUserAccount = user
        const wsolTransfers = (tx.tokenTransfers ?? []).filter(
          (t) =>
            t.mint === WSOL_MINT &&
            (toTracked ? t.fromUserAccount === userAddr : t.toUserAccount === userAddr),
        );
        const lamports = wsolTransfers.reduce((acc, t) => {
          const raw = t.rawTokenAmount?.tokenAmount ?? '0';
          try {
            return acc + BigInt(raw);
          } catch {
            return acc;
          }
        }, 0n);
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
