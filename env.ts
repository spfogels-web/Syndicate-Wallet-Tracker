import type { ParsedTokenEvent } from '../../types';
import type { Chain } from '@prisma/client';

/**
 * Alchemy "ADDRESS_ACTIVITY" webhook payload (subset).
 * https://docs.alchemy.com/reference/address-activity-webhook
 */
export interface AlchemyAddressActivityPayload {
  webhookId: string;
  id: string;
  createdAt: string;
  type: 'ADDRESS_ACTIVITY';
  event: {
    network: string;
    activity: AlchemyActivity[];
  };
}

export interface AlchemyActivity {
  fromAddress: string;
  toAddress: string;
  blockNum: string; // hex
  hash: string;
  value: number; // human-readable
  asset?: string;
  category: 'token' | 'external' | 'internal' | 'erc20' | 'erc721' | 'erc1155';
  rawContract: { address?: string; rawValue: string; decimals?: number };
  log?: { transactionHash?: string };
  // Some payloads include a nested `typeTraceAddress` etc; we ignore those.
}

export function parseAlchemyActivity(
  chain: Chain,
  payload: AlchemyAddressActivityPayload,
  trackedAddresses: Set<string>, // lowercased
  trackedContracts: Set<string>, // lowercased
  blockTimestamps: Map<string, Date>, // blockNum (hex) → date; pre-fetched
): ParsedTokenEvent[] {
  const events: ParsedTokenEvent[] = [];

  for (const a of payload.event?.activity ?? []) {
    if (a.category !== 'erc20' && a.category !== 'token') continue;
    const contract = a.rawContract?.address?.toLowerCase();
    if (!contract || !trackedContracts.has(contract)) continue;

    const from = a.fromAddress?.toLowerCase();
    const to = a.toAddress?.toLowerCase();
    if (!from && !to) continue;

    const fromTracked = !!from && trackedAddresses.has(from);
    const toTracked = !!to && trackedAddresses.has(to);
    if (!fromTracked && !toTracked) continue;

    const ts = blockTimestamps.get(a.blockNum) ?? new Date();
    const blockNumber = a.blockNum ? BigInt(a.blockNum) : null;
    const rawAmount = a.rawContract?.rawValue?.startsWith('0x')
      ? BigInt(a.rawContract.rawValue).toString()
      : a.rawContract?.rawValue ?? '0';

    if (toTracked && to) {
      events.push({
        chain,
        txHash: a.hash,
        blockNumber,
        timestamp: ts,
        contractAddress: contract,
        walletAddress: to,
        counterparty: from ?? null,
        rawAmount,
        inbound: true,
        nativeAmount: null, // EVM swap native amount must be derived from receipt logs (see note in README)
        raw: a,
      });
    }
    if (fromTracked && from) {
      events.push({
        chain,
        txHash: a.hash,
        blockNumber,
        timestamp: ts,
        contractAddress: contract,
        walletAddress: from,
        counterparty: to ?? null,
        rawAmount,
        inbound: false,
        nativeAmount: null,
        raw: a,
      });
    }
  }

  return events;
}
