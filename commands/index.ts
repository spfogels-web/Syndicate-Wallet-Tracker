import type { Bot } from 'grammy';
import { rateLimit } from '../bot/middleware';
import { registerTokenCommands } from './token';
import { registerWalletCommands } from './wallet';
import { registerAdminCommands } from './admin';
import { registerControlCommands } from './control';

export function registerCommands(bot: Bot): void {
  bot.use(rateLimit);

  bot.command('start', (ctx) =>
    ctx.reply(
      [
        '👋 *Crypto Syndicate Wallet Tracker*',
        '',
        'Tracks investor wallet activity across Solana, Ethereum, and Base.',
        '',
        '*Token commands*',
        '/addtoken [chain] [CA] [name]',
        '/removetoken [chain] [CA]',
        '/tokens',
        '',
        '*Wallet commands*',
        '/addwallet [chain] [CA] [wallet] [label]',
        '/removewallet [wallet]',
        '/wallets [CA]',
        '',
        '*Admin*',
        '/admin add [telegramId]',
        '/admin remove [telegramId]',
        '/admin list',
        '/pause [chain] [CA]',
        '/resume [chain] [CA]',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    ),
  );

  registerTokenCommands(bot);
  registerWalletCommands(bot);
  registerAdminCommands(bot);
  registerControlCommands(bot);

  // Telegram command menu hint
  void bot.api.setMyCommands([
    { command: 'start', description: 'Show help' },
    { command: 'addtoken', description: 'Track a token: [chain] [CA] [name]' },
    { command: 'removetoken', description: 'Stop tracking a token: [chain] [CA]' },
    { command: 'tokens', description: 'List tracked tokens' },
    { command: 'addwallet', description: 'Track a wallet: [chain] [CA] [wallet] [label]' },
    { command: 'removewallet', description: 'Remove a tracked wallet' },
    { command: 'wallets', description: 'List wallets for a token: [CA]' },
    { command: 'pause', description: 'Pause alerts for a token' },
    { command: 'resume', description: 'Resume alerts for a token' },
    { command: 'admin', description: 'Manage admins' },
  ]);
}
