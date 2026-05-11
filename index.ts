import { env } from './config/env';
import { logger } from './utils/logger';
import { createApp } from './server/express';
import { startBot, stopBot } from './bot';
import { ensureBootstrapAdmins } from './services/adminService';
import { resyncSolanaWebhook } from './services/walletService';
import { disconnectPrisma } from './database/prisma';

async function main(): Promise<void> {
  logger.info({ env: env.NODE_ENV }, 'starting Crypto Syndicate Wallet Tracker');

  await ensureBootstrapAdmins();

  // HTTP server (webhook receiver + healthcheck)
  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, 'http server listening');
  });

  // Telegram bot (long polling)
  // We don't `await` startBot() because grammY's start() resolves only on shutdown.
  void startBot();

  // Initial Helius webhook sync (fires once at startup)
  void resyncSolanaWebhook();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down…');
    server.close();
    await stopBot();
    await disconnectPrisma();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'startup failed');
  process.exit(1);
});
