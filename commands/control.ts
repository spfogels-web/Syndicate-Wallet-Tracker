import type { Bot } from 'grammy';
import { Chain } from '@prisma/client';
import { adminOnly } from '../bot/middleware';
import { findProject, setPaused } from '../services/tokenService';

function parseChain(raw: string | undefined): Chain | null {
  if (!raw) return null;
  const norm = raw.toUpperCase();
  if (norm === 'SOLANA' || norm === 'SOL') return 'SOLANA';
  if (norm === 'ETHEREUM' || norm === 'ETH') return 'ETHEREUM';
  if (norm === 'BASE') return 'BASE';
  return null;
}

export function registerControlCommands(bot: Bot): void {
  for (const verb of ['pause', 'resume'] as const) {
    bot.command(verb, adminOnly, async (ctx) => {
      const args = ctx.match?.toString().trim().split(/\s+/) ?? [];
      if (args.length < 2) {
        await ctx.reply(`Usage: /${verb} [chain] [CA]`);
        return;
      }
      const chain = parseChain(args[0]);
      if (!chain) {
        await ctx.reply('Unknown chain.');
        return;
      }
      const project = await findProject(chain, args[1]);
      if (!project) {
        await ctx.reply('Project not found.');
        return;
      }
      await setPaused(project.id, verb === 'pause');
      await ctx.reply(`✅ ${verb === 'pause' ? 'Paused' : 'Resumed'} alerts for *${project.name}*.`, {
        parse_mode: 'Markdown',
      });
    });
  }
}
