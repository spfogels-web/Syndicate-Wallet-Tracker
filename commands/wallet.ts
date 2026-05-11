import type { Bot } from 'grammy';
import { Chain } from '@prisma/client';
import { adminOnly } from '../bot/middleware';
import { addWallet, listWallets, removeWallet } from '../services/walletService';
import { Decimal } from 'decimal.js';
import { formatAmount, formatPercent, rawToHuman, shortenAddress } from '../utils/format';
import { logger } from '../utils/logger';

function parseChain(raw: string | undefined): Chain | null {
  if (!raw) return null;
  const norm = raw.toUpperCase();
  if (norm === 'SOLANA' || norm === 'SOL') return 'SOLANA';
  if (norm === 'ETHEREUM' || norm === 'ETH') return 'ETHEREUM';
  if (norm === 'BASE') return 'BASE';
  return null;
}

export function registerWalletCommands(bot: Bot): void {
  bot.command('addwallet', adminOnly, async (ctx) => {
    // /addwallet [chain] [CA] [wallet] [label…]
    const args = ctx.match?.toString().trim().split(/\s+/) ?? [];
    if (args.length < 4) {
      await ctx.reply('Usage: /addwallet [chain] [CA] [wallet] [label]');
      return;
    }
    const [chainRaw, ca, wa, ...labelParts] = args;
    const chain = parseChain(chainRaw);
    if (!chain) {
      await ctx.reply('Unknown chain.');
      return;
    }
    try {
      const w = await addWallet({
        chain,
        contractAddress: ca,
        walletAddress: wa,
        label: labelParts.join(' '),
      });
      await ctx.reply(`✅ Tracking wallet *${w.label}* on ${chain}\n\`${w.address}\``, {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      logger.error({ err }, '/addwallet failed');
      await ctx.reply(`❌ ${(err as Error).message}`);
    }
  });

  bot.command('removewallet', adminOnly, async (ctx) => {
    const args = ctx.match?.toString().trim().split(/\s+/) ?? [];
    if (args.length < 1) {
      await ctx.reply('Usage: /removewallet [wallet]');
      return;
    }
    const count = await removeWallet(args[0]);
    if (count === 0) {
      await ctx.reply('No matching wallet was tracked.');
    } else {
      await ctx.reply(`✅ Removed wallet from ${count} project(s).`);
    }
  });

  bot.command('wallets', async (ctx) => {
    // /wallets [CA] — chain inferred by lookup
    const args = ctx.match?.toString().trim().split(/\s+/) ?? [];
    if (args.length < 1) {
      await ctx.reply('Usage: /wallets [CA]');
      return;
    }
    const ca = args[0];
    // Try each chain
    const chains: Chain[] = ['SOLANA', 'ETHEREUM', 'BASE'];
    let found = null;
    for (const c of chains) {
      try {
        found = await listWallets(c, ca);
        if (found) break;
      } catch {
        // ignore — try next chain
      }
    }
    if (!found) {
      await ctx.reply('No project found for that CA.');
      return;
    }
    if (found.wallets.length === 0) {
      await ctx.reply(`No wallets tracked yet for *${found.name}*.`, { parse_mode: 'Markdown' });
      return;
    }
    const symbol = found.symbol ?? found.name;
    const lines = found.wallets.map((w) => {
      const balance = w.stats
        ? formatAmount(rawToHuman(w.stats.currentBalance.toString(), found.decimals))
        : '0';
      const pct = w.stats ? formatPercent(new Decimal(w.stats.ownershipPct.toString())) : '0%';
      return `• *${w.label}*${w.isLinked ? ' (linked)' : ''}\n  ${shortenAddress(w.address)} — ${balance} ${symbol} (${pct})`;
    });
    await ctx.reply(`*${found.name}* — ${found.chain}\n\n${lines.join('\n\n')}`, {
      parse_mode: 'Markdown',
    });
  });
}
