import { InlineKeyboard, type Bot, type Context } from 'grammy';
import { Chain } from '@prisma/client';
import { prisma } from '../database/prisma';
import { isAdmin } from '../services/adminService';
import { listProjects, addProject, setPaused } from '../services/tokenService';
import { addWallet } from '../services/walletService';
import { logger } from '../utils/logger';
import { HELP_TEXT } from '../commands/help-text';

type Pending =
  | { type: 'addtoken'; chain: Chain }
  | { type: 'addwallet'; projectId: string }
  | { type: 'addadmin' };

const PENDING_TTL_MS = 5 * 60 * 1000;
const pending = new Map<number, { p: Pending; expiresAt: number }>();

function setPending(uid: number, p: Pending): void {
  pending.set(uid, { p, expiresAt: Date.now() + PENDING_TTL_MS });
}

function getPending(uid: number): Pending | undefined {
  const r = pending.get(uid);
  if (!r) return undefined;
  if (r.expiresAt < Date.now()) {
    pending.delete(uid);
    return undefined;
  }
  return r.p;
}

function clearPending(uid: number): void {
  pending.delete(uid);
}

function escapeMd(s: string): string {
  return s.replace(/([*_`[\]])/g, '\\$1');
}

// ---------- Keyboard builders ----------

function mainKb(): InlineKeyboard {
  return new InlineKeyboard()
    .text('🪙 Tokens', 'm:tokens')
    .text('👛 Wallets', 'm:wallets')
    .row()
    .text('👤 Admin', 'm:admin')
    .text('📖 Help', 'm:help');
}

function tokensKb(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📋 List Tokens', 'tok:list')
    .row()
    .text('➕ Add Solana', 'tok:add:SOLANA')
    .row()
    .text('➕ Add Ethereum', 'tok:add:ETHEREUM')
    .row()
    .text('➕ Add Base', 'tok:add:BASE')
    .row()
    .text('◀️ Back', 'm:home');
}

function walletsKb(): InlineKeyboard {
  return new InlineKeyboard()
    .text('➕ Add Wallet to Token', 'wal:pick')
    .row()
    .text('◀️ Back', 'm:home');
}

function adminKb(): InlineKeyboard {
  return new InlineKeyboard()
    .text('📋 List Admins', 'adm:list')
    .row()
    .text('➕ Add Admin', 'adm:add')
    .row()
    .text('◀️ Back', 'm:home');
}

function tokenRowKb(projectId: string, isPaused: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text(isPaused ? '▶️ Resume' : '⏸ Pause', `tok:pause:${projectId}`)
    .text('👛 Wallets', `tok:wallets:${projectId}`)
    .text('🗑 Remove', `tok:rmask:${projectId}`);
}

function tokenRemoveConfirmKb(projectId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('✅ Yes, remove', `tok:rm:${projectId}`)
    .text('❌ Cancel', `tok:rmno:${projectId}`);
}

// ---------- Public ----------

export async function showMenu(ctx: Context): Promise<void> {
  await ctx.reply('*Main Menu*\nChoose an action:', {
    parse_mode: 'Markdown',
    reply_markup: mainKb(),
  });
}

async function ensureAdmin(ctx: Context): Promise<boolean> {
  const uid = ctx.from?.id;
  if (!uid || !(await isAdmin(uid))) {
    await ctx.answerCallbackQuery({ text: '🔒 Admin only', show_alert: true });
    return false;
  }
  return true;
}

// ---------- Registration ----------

export function registerMenuHandlers(bot: Bot): void {
  // -------- Navigation --------
  bot.callbackQuery(/^m:/, async (ctx) => {
    const action = (ctx.callbackQuery.data ?? '').slice(2);
    try {
      if (action === 'home') {
        await ctx.editMessageText('*Main Menu*\nChoose an action:', {
          parse_mode: 'Markdown',
          reply_markup: mainKb(),
        });
      } else if (action === 'tokens') {
        await ctx.editMessageText('*🪙 Tokens*', {
          parse_mode: 'Markdown',
          reply_markup: tokensKb(),
        });
      } else if (action === 'wallets') {
        await ctx.editMessageText('*👛 Wallets*', {
          parse_mode: 'Markdown',
          reply_markup: walletsKb(),
        });
      } else if (action === 'admin') {
        await ctx.editMessageText('*👤 Admin*', {
          parse_mode: 'Markdown',
          reply_markup: adminKb(),
        });
      } else if (action === 'help') {
        await ctx.reply(HELP_TEXT, { parse_mode: 'Markdown' });
      }
    } catch (err) {
      logger.warn({ err }, 'menu nav failed');
    }
    await ctx.answerCallbackQuery();
  });

  // -------- Tokens --------
  bot.callbackQuery(/^tok:list$/, async (ctx) => {
    const projects = await listProjects();
    if (projects.length === 0) {
      await ctx.editMessageText('No tokens tracked yet. Use ➕ to add one.', {
        reply_markup: tokensKb(),
      });
    } else {
      await ctx.editMessageText(`🪙 *${projects.length}* token(s) tracked:`, {
        parse_mode: 'Markdown',
        reply_markup: tokensKb(),
      });
      for (const p of projects) {
        await ctx.reply(
          `*${escapeMd(p.name)}* — ${p.chain}${p.isPaused ? ' ⏸' : ''}\nCA: \`${p.contractAddress}\`\nWallets: ${p._count.wallets}`,
          { parse_mode: 'Markdown', reply_markup: tokenRowKb(p.id, p.isPaused) },
        );
      }
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^tok:add:/, async (ctx) => {
    if (!(await ensureAdmin(ctx))) return;
    const chain = ((ctx.callbackQuery.data ?? '').slice(8)) as Chain;
    setPending(ctx.from!.id, { type: 'addtoken', chain });
    await ctx.editMessageText(
      `*➕ Add ${chain} Token*\n\nReply with the contract address and name as one message:\n\`<CA> Token Name\`\n\nSend /cancel to abort.`,
      { parse_mode: 'Markdown' },
    );
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^tok:pause:/, async (ctx) => {
    if (!(await ensureAdmin(ctx))) return;
    const id = (ctx.callbackQuery.data ?? '').slice(10);
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) {
      await ctx.answerCallbackQuery({ text: 'Token not found', show_alert: true });
      return;
    }
    const updated = await setPaused(id, !p.isPaused);
    const wcount = await prisma.wallet.count({ where: { projectId: id } });
    await ctx.editMessageText(
      `*${escapeMd(updated.name)}* — ${updated.chain}${updated.isPaused ? ' ⏸' : ''}\nCA: \`${updated.contractAddress}\`\nWallets: ${wcount}`,
      { parse_mode: 'Markdown', reply_markup: tokenRowKb(updated.id, updated.isPaused) },
    );
    await ctx.answerCallbackQuery(updated.isPaused ? 'Paused' : 'Resumed');
  });

  bot.callbackQuery(/^tok:wallets:/, async (ctx) => {
    const id = (ctx.callbackQuery.data ?? '').slice(12);
    const p = await prisma.project.findUnique({
      where: { id },
      include: { wallets: { include: { stats: true }, orderBy: { createdAt: 'asc' } } },
    });
    if (!p) {
      await ctx.answerCallbackQuery({ text: 'Token not found', show_alert: true });
      return;
    }
    if (p.wallets.length === 0) {
      await ctx.reply(`No wallets tracked for *${escapeMd(p.name)}* yet.`, {
        parse_mode: 'Markdown',
      });
    } else {
      const lines = p.wallets.map(
        (w) =>
          `• \`${w.address}\` — ${escapeMd(w.label)}${w.isLinked ? ' (linked)' : ''}`,
      );
      await ctx.reply(`*${escapeMd(p.name)}* wallets:\n\n${lines.join('\n')}`, {
        parse_mode: 'Markdown',
      });
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^tok:rmask:/, async (ctx) => {
    if (!(await ensureAdmin(ctx))) return;
    const id = (ctx.callbackQuery.data ?? '').slice(10);
    await ctx.editMessageReplyMarkup({ reply_markup: tokenRemoveConfirmKb(id) });
    await ctx.answerCallbackQuery('Confirm removal');
  });

  bot.callbackQuery(/^tok:rm:/, async (ctx) => {
    if (!(await ensureAdmin(ctx))) return;
    const id = (ctx.callbackQuery.data ?? '').slice(7);
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) {
      await ctx.answerCallbackQuery({ text: 'Already removed', show_alert: false });
      return;
    }
    await prisma.project.delete({ where: { id } });
    await ctx.editMessageText(`✅ Removed *${escapeMd(p.name)}* (${p.chain}).`, {
      parse_mode: 'Markdown',
    });
    await ctx.answerCallbackQuery('Removed');
  });

  bot.callbackQuery(/^tok:rmno:/, async (ctx) => {
    const id = (ctx.callbackQuery.data ?? '').slice(9);
    const p = await prisma.project.findUnique({ where: { id } });
    if (!p) {
      await ctx.answerCallbackQuery();
      return;
    }
    await ctx.editMessageReplyMarkup({ reply_markup: tokenRowKb(p.id, p.isPaused) });
    await ctx.answerCallbackQuery('Cancelled');
  });

  // -------- Wallets --------
  bot.callbackQuery(/^wal:pick$/, async (ctx) => {
    if (!(await ensureAdmin(ctx))) return;
    const projects = await listProjects();
    if (projects.length === 0) {
      await ctx.answerCallbackQuery({
        text: 'Add a token first.',
        show_alert: true,
      });
      return;
    }
    const kb = new InlineKeyboard();
    for (const p of projects) {
      kb.text(`${p.name} (${p.chain})`, `wal:add:${p.id}`).row();
    }
    kb.text('◀️ Back', 'm:wallets');
    await ctx.editMessageText('*👛 Add wallet — pick a token:*', {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^wal:add:/, async (ctx) => {
    if (!(await ensureAdmin(ctx))) return;
    const projectId = (ctx.callbackQuery.data ?? '').slice(8);
    const p = await prisma.project.findUnique({ where: { id: projectId } });
    if (!p) {
      await ctx.answerCallbackQuery({ text: 'Token not found', show_alert: true });
      return;
    }
    setPending(ctx.from!.id, { type: 'addwallet', projectId });
    await ctx.editMessageText(
      `*➕ Add wallet to ${escapeMd(p.name)} (${p.chain})*\n\nReply with the wallet address and a label:\n\`<wallet> Whale 1\`\n\nSend /cancel to abort.`,
      { parse_mode: 'Markdown' },
    );
    await ctx.answerCallbackQuery();
  });

  // -------- Admin --------
  bot.callbackQuery(/^adm:list$/, async (ctx) => {
    if (!(await ensureAdmin(ctx))) return;
    const admins = await prisma.admin.findMany({ orderBy: { addedAt: 'asc' } });
    if (admins.length === 0) {
      await ctx.reply('No admins configured.');
    } else {
      const lines = admins.map(
        (a) => `• \`${a.telegramId.toString()}\`${a.username ? ` (@${a.username})` : ''}`,
      );
      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    }
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^adm:add$/, async (ctx) => {
    if (!(await ensureAdmin(ctx))) return;
    setPending(ctx.from!.id, { type: 'addadmin' });
    await ctx.editMessageText(
      '*➕ Add Admin*\n\nReply with the numeric Telegram user ID.\n\nSend /cancel to abort.',
      { parse_mode: 'Markdown' },
    );
    await ctx.answerCallbackQuery();
  });

  // -------- Cancel pending --------
  bot.command('cancel', async (ctx) => {
    if (!ctx.from) return;
    if (getPending(ctx.from.id)) {
      clearPending(ctx.from.id);
      await ctx.reply('Cancelled.');
    } else {
      await ctx.reply('Nothing to cancel.');
    }
  });

  // -------- Free-text capture for pending flows --------
  bot.on('message:text', async (ctx, next) => {
    if (!ctx.from) return next();
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return next();
    const p = getPending(ctx.from.id);
    if (!p) return next();

    // Don't clear pending state on recoverable format errors — let the user retry
    // by sending another message. Clear only on success or on terminal errors.
    let success = false;
    try {
      if (p.type === 'addtoken') {
        const parts = text.split(/\s+/);
        if (parts.length < 2) {
          await ctx.reply(
            'Need both the contract address AND a name in one message:\n`<CA> Token Name`\n\nTry again, or send /cancel to abort.',
            { parse_mode: 'Markdown' },
          );
          return;
        }
        const [ca, ...nameParts] = parts;
        const project = await addProject({
          chain: p.chain,
          contractAddress: ca,
          name: nameParts.join(' '),
          telegramChatId: String(ctx.chat.id),
        });
        await ctx.reply(
          `✅ Tracking *${escapeMd(project.name)}* on *${project.chain}*\nCA: \`${project.contractAddress}\`\n\nUse the menu to add wallets.`,
          { parse_mode: 'Markdown' },
        );
        success = true;
      } else if (p.type === 'addwallet') {
        const parts = text.split(/\s+/);
        if (parts.length < 2) {
          await ctx.reply(
            'Need both the wallet address AND a label in one message:\n`<wallet> Whale 1`\n\nTry again, or send /cancel to abort.',
            { parse_mode: 'Markdown' },
          );
          return;
        }
        const project = await prisma.project.findUnique({ where: { id: p.projectId } });
        if (!project) {
          await ctx.reply('Token no longer exists.');
          success = true; // terminal — clear state
          return;
        }
        const [wa, ...labelParts] = parts;
        const wallet = await addWallet({
          chain: project.chain,
          contractAddress: project.contractAddress,
          walletAddress: wa,
          label: labelParts.join(' '),
        });
        await ctx.reply(
          `✅ Tracking wallet *${escapeMd(wallet.label)}* on ${project.chain}\n\`${wallet.address}\``,
          { parse_mode: 'Markdown' },
        );
        success = true;
      } else if (p.type === 'addadmin') {
        let tid: bigint;
        try {
          tid = BigInt(text.trim());
        } catch {
          await ctx.reply('Telegram ID must be numeric. Try again, or send /cancel to abort.');
          return;
        }
        await prisma.admin.upsert({
          where: { telegramId: tid },
          update: {},
          create: { telegramId: tid, addedById: BigInt(ctx.from.id) },
        });
        await ctx.reply(`✅ Added admin: \`${tid.toString()}\``, { parse_mode: 'Markdown' });
        success = true;
      }
    } catch (err) {
      logger.error({ err }, 'pending action failed');
      await ctx.reply(`❌ ${(err as Error).message}\n\nTry again, or send /cancel to abort.`);
      // Keep pending state — service errors (bad address, network) are usually recoverable.
    }
    if (success) clearPending(ctx.from.id);
  });
}
