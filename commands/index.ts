import type { Bot } from 'grammy';
import { rateLimit } from '../bot/middleware';
import { registerTokenCommands } from './token';
import { registerWalletCommands } from './wallet';
import { registerAdminCommands } from './admin';
import { registerControlCommands } from './control';
import { registerMenuHandlers, showMenu } from '../bot/menu';
import { HELP_TEXT } from './help-text';

export function registerCommands(bot: Bot): void {
  bot.use(rateLimit);

  bot.command('start', async (ctx) => {
    await ctx.reply(
      [
        '👋 *Crypto Syndicate Wallet Tracker*',
        '',
        'Tracks investor wallet activity across Solana, Ethereum, and Base.',
        'Pick an option below, or send /help for the full guide.',
      ].join('\n'),
      { parse_mode: 'Markdown' },
    );
    await showMenu(ctx);
  });

  bot.command('menu', (ctx) => showMenu(ctx));

  bot.command('help', (ctx) => ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' }));

  registerTokenCommands(bot);
  registerWalletCommands(bot);
  registerAdminCommands(bot);
  registerControlCommands(bot);
  registerMenuHandlers(bot);

  // Telegram command menu hint
  void bot.api.setMyCommands([
    { command: 'start', description: 'Open menu' },
    { command: 'menu', description: 'Open the button menu' },
    { command: 'help', description: 'Full setup guide with examples' },
    { command: 'cancel', description: 'Cancel a pending action' },
    { command: 'tokens', description: 'List tracked tokens' },
    { command: 'wallets', description: 'List wallets for a token: [CA]' },
    { command: 'addtoken', description: 'Track a token: [chain] [CA] [name]' },
    { command: 'addwallet', description: 'Track a wallet: [chain] [CA] [wallet] [label]' },
    { command: 'removetoken', description: 'Stop tracking a token: [chain] [CA]' },
    { command: 'removewallet', description: 'Remove a tracked wallet' },
    { command: 'pause', description: 'Pause alerts for a token' },
    { command: 'resume', description: 'Resume alerts for a token' },
    { command: 'setchat', description: 'Send alerts for a token to this chat' },
    { command: 'clearchat', description: "Revert token's alerts to the default chat" },
    { command: 'resync', description: 'Force-sync Helius webhook (Solana)' },
    { command: 'diagnose', description: 'Show what webhooks the API key can see' },
    { command: 'admin', description: 'Manage admins' },
  ]);
}
