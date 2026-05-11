import type { Bot } from 'grammy';
import { adminOnly } from '../bot/middleware';
import { addAdmin, listAdmins, removeAdmin } from '../services/adminService';

export function registerAdminCommands(bot: Bot): void {
  // Admin sub-router under /admin
  bot.command('admin', adminOnly, async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/) ?? [];
    const sub = (args[0] ?? '').toLowerCase();
    const callerId = ctx.from?.id ? BigInt(ctx.from.id) : undefined;

    if (sub === 'add') {
      if (!args[1]) {
        await ctx.reply('Usage: /admin add [telegramId] (or reply to a message with /admin add)');
        return;
      }
      let id: bigint;
      try {
        id = BigInt(args[1]);
      } catch {
        await ctx.reply('Telegram ID must be numeric.');
        return;
      }
      await addAdmin(id, undefined, callerId);
      await ctx.reply(`✅ Added admin: \`${id.toString()}\``, { parse_mode: 'Markdown' });
      return;
    }
    if (sub === 'remove') {
      if (!args[1]) {
        await ctx.reply('Usage: /admin remove [telegramId]');
        return;
      }
      let id: bigint;
      try {
        id = BigInt(args[1]);
      } catch {
        await ctx.reply('Telegram ID must be numeric.');
        return;
      }
      await removeAdmin(id);
      await ctx.reply(`✅ Removed admin: \`${id.toString()}\``, { parse_mode: 'Markdown' });
      return;
    }
    if (sub === 'list' || sub === '') {
      const admins = await listAdmins();
      if (admins.length === 0) {
        await ctx.reply('No admins configured.');
        return;
      }
      const lines = admins.map(
        (a) => `• \`${a.telegramId.toString()}\`${a.username ? ` (@${a.username})` : ''}`,
      );
      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
      return;
    }
    await ctx.reply('Usage: /admin [add|remove|list] [telegramId]');
  });
}
