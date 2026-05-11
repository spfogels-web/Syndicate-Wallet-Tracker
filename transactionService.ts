import { Router } from 'express';
import { prisma } from '../../database/prisma';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: (err as Error).message });
  }
});
