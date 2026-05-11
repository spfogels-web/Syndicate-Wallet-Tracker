import type { Response } from 'express';
import { logger } from '../utils/logger';

/**
 * Lightweight server-sent events broadcaster.
 * Dashboard subscribes via GET /api/stream and receives JSON-serialized events
 * any time alerts fire or wallet stats change.
 */

type Client = {
  id: number;
  res: Response;
};

const clients = new Map<number, Client>();
let nextId = 1;

export function addClient(res: Response): number {
  const id = nextId++;
  clients.set(id, { id, res });
  logger.info({ clientId: id, total: clients.size }, 'dashboard SSE client connected');
  return id;
}

export function removeClient(id: number): void {
  if (clients.delete(id)) {
    logger.info({ clientId: id, total: clients.size }, 'dashboard SSE client disconnected');
  }
}

export type DashboardEvent =
  | {
      type: 'alert';
      alertType: 'BUY' | 'SELL' | 'TRANSFER' | 'LINKED_WALLET';
      projectId: string;
      projectName: string;
      chain: string;
      walletId: string;
      walletLabel: string;
      walletAddress: string;
      txHash: string;
      amount: string; // raw
      humanAmount: string;
      symbol: string | null;
      nativeAmount: string | null;
      currentBalance: string;
      ownershipPct: string;
      timestamp: string;
    }
  | { type: 'token_added'; projectId: string; name: string; chain: string }
  | { type: 'token_removed'; projectId: string }
  | { type: 'wallet_added'; walletId: string; projectId: string; address: string; label: string }
  | { type: 'wallet_removed'; walletId: string };

export function broadcast(event: DashboardEvent): void {
  if (clients.size === 0) return;
  const data = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients.values()) {
    try {
      client.res.write(data);
    } catch (err) {
      logger.warn({ err, clientId: client.id }, 'failed to write SSE event; dropping client');
      removeClient(client.id);
    }
  }
}
