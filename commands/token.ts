import type { Bot } from 'grammy';
import { Chain } from '@prisma/client';
import { adminOnly } from '../bot/middleware';
import { addProject, listProjects, removeProject } from '../services/tokenService';
import { logger } from '../utils/logger';

function parseChain(raw: string | undefined): Chain | null {
  if (!raw) return null;
  const norm = raw.toUpperCase();
  if (norm === 'SOLANA' || norm === 'SOL') return 'SOLANA';
  if (norm === 'ETHEREUM' || norm === 'ETH') return 'ETHEREUM';
  if (norm === 'BASE') return 'BASE';
  return null;
}

export function registerTokenCommands(bot: Bot): void {
  bot.command('addtoken', adminOnly, async (ctx) => {
    // /addtoken [chain] [CA] [name…]
    const args = ctx.match?.toString().trim().split(/\s+/) ?? [];
    if (args.length < 3) {
      await ctx.reply('Usage: /addtoken [chain] [CA] [name]');
      return;
    }
    const [chainRaw, ca, ...nameParts] = args;
    const chain = parseChain(chainRaw);
    if (!chain) {
      await ctx.reply('Unknown chain. Use one of: solana, ethereum, base.');
      return;
    }
    const name = nameParts.join(' ');
    try {
      const project = await addProject({
        chain,
        contractAddress: ca,
        name,
        telegramChatId: String(ctx.chat.id),
      });
      await ctx.reply(
        `✅ Tracking *${project.name}* on *${project.chain}*\nCA: \`${project.contractAddress}\``,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      logger.error({ err }, '/addtoken failed');
      await ctx.reply(`❌ ${(err as Error).message}`);
    }
  });

  bot.command('removetoken', adminOnly, async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/) ?? [];
    if (args.length < 2) {
      await ctx.reply('Usage: /removetoken [chain] [CA]');
      return;
    }
    const chain = parseChain(args[0]);
    if (!chain) {
      await ctx.reply('Unknown chain.');
      return;
    }
    try {
      await removeProject(chain, args[1]);
      await ctx.reply('✅ Token removed.');
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`);
    }
  });

  bot.command('tokens', async (ctx) => {
    const projects = await listProjects();
    if (projects.length === 0) {
      await ctx.reply('No tokens tracked yet. Add one with /addtoken.');
      return;
    }
    const lines = projects.map(
      (p) =>
        `• *${p.name}* — ${p.chain}${p.isPaused ? ' (paused)' : ''}\n  CA: \`${p.contractAddress}\`\n  Wallets: ${p._count.wallets}`,
    );
    await ctx.reply(lines.join('\n\n'), { parse_mode: 'Markdown' });
  });
}
