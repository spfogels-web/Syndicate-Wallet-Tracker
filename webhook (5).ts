import type { Context, NextFunction } from 'grammy';
import { commandLimiter } from '../utils/rateLimit';
import { isAdmin } from '../services/adminService';

export async function rateLimit(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return next();
  if (!commandLimiter.take(String(userId))) {
    await ctx.reply('⏱️ Slow down — too many commands. Try again in a moment.');
    return;
  }
  return next();
}

export async function adminOnly(ctx: Context, next: NextFunction): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) {
    await ctx.reply('❌ Unable to identify user.');
    return;
  }
  if (!(await isAdmin(userId))) {
    await ctx.reply('🔒 This command is admin-only.');
    return;
  }
  return next();
}
