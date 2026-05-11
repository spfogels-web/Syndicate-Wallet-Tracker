import type { Chain, TxType, AlertType } from '@prisma/client';

export { Chain, TxType, AlertType };

/** Normalized event the chain parsers emit; the tracker consumes this regardless of chain. */
export interface ParsedTokenEvent {
  chain: Chain;
  txHash: string;
  blockNumber?: bigint | null;
  timestamp: Date;
  /** Lowercased contract / mint address */
  contractAddress: string;
  /** Lowercased wallet address that we observed */
  walletAddress: string;
  /** Lowercased counterparty address (the other side of the transfer) */
  counterparty: string | null;
  /** Raw on-chain amount (no decimals applied), as a string to preserve precision */
  rawAmount: string;
  /** Whether the wallet received (true) or sent (false) tokens */
  inbound: boolean;
  /** Native amount paid/received in this tx attributable to the swap (SOL/ETH), if known */
  nativeAmount?: string | null;
  /** Raw payload, for debugging */
  raw?: unknown;
}

export interface OwnershipSnapshot {
  individualPct: number; // e.g. 1.22
  combinedPct: number; // includes linked wallets
}
