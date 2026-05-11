import type { Request, Response } from 'express';
import { logger } from '../../utils/logger';
import { prisma } from '../../database/prisma';
import { verifyAlchemySignature, getEvmClient } from './client';
import { parseAlchemyActivity, AlchemyAddressActivityPayload } from './parser';
import { handleParsedEvents } from '../../services/transactionService';
import type { Chain } from '@prisma/client';

/** Handler factory — same logic for ETHEREUM and BASE, only differ by `chain` enum. */
export function makeEvmWebhookHandler(chain: Chain) {
  return async function handleEvmWebhook(req: Request, res: Response): Promise<void> {
    // Alchemy signs the raw body. Express must capture it as Buffer (see server/express.ts).
    const raw: Buffer | undefined = (req as Request & { rawBody?: Buffer }).rawBody;
    const signature = req.header('x-alchemy-signature');
    if (raw && !verifyAlchemySignature(raw, signature)) {
      logger.warn({ chain }, 'rejected EVM webhook: bad signature');
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    res.status(200).json({ ok: true });

    const payload = req.body as AlchemyAddressActivityPayload;
    if (payload?.type !== 'ADDRESS_ACTIVITY' || !payload.event?.activity?.length) return;

    try {
      const wallets = await prisma.wallet.findMany({
        where: { project: { chain, isPaused: false }, isActive: true },
        select: { address: true, project: { select: { contractAddress: true } } },
      });
      const trackedAddresses = new Set(wallets.map((w) => w.address.toLowerCase()));
      const trackedContracts = new Set(wallets.map((w) => w.project.contractAddress.toLowerCase()));

      // Fetch block timestamps for unique blocks in payload (Alchemy doesn't include them)
      const uniqueBlocks = Array.from(new Set(payload.event.activity.map((a) => a.blockNum)));
      const client = getEvmClient(chain);
      const blockTimestamps = new Map<string, Date>();
      await Promise.all(
        uniqueBlocks.map(async (hex) => {
          try {
            const block = await client.getBlock({ blockNumber: BigInt(hex) });
            blockTimestamps.set(hex, new Date(Number(block.timestamp) * 1000));
          } catch (err) {
            logger.warn({ err, chain, hex }, 'failed to fetch block timestamp');
          }
        }),
      );

      const events = parseAlchemyActivity(chain, payload, trackedAddresses, trackedContracts, blockTimestamps);
      if (events.length === 0) return;
      await handleParsedEvents(events);
    } catch (err) {
      logger.error({ err, chain }, 'failed processing evm webhook');
    }
  };
}
