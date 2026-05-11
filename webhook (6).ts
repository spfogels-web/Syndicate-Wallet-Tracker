import { Bot } from 'grammy';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import { registerCommands } from '../commands';

let bot: Bot | undefined;

export function getBot(): Bot {
  if (!bot) {
    bot = new Bot(env.TELEGRAM_BOT_TOKEN);
    registerCommands(bot);
    bot.catch((err) => {
      logger.error({ err }, 'unhandled bot error');
    });
  }
  return bot;
}

export async function startBot(): Promise<void> {
  const b = getBot();
  // Long-polling. (Switch to webhook mode behind Express if you want a single ingress.)
  await b.start({
    drop_pending_updates: false,
    onStart: (info) => logger.info({ username: info.username }, 'telegram bot started'),
  });
}

export async function stopBot(): Promise<void> {
  if (bot) await bot.stop();
}
