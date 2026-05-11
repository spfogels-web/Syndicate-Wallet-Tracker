import type { Bot } from 'grammy';
import { Chain } from '@prisma/client';
import { adminOnly } from '../bot/middleware';
import { findProject, setPaused } from '../services/tokenService';
import {
  getAllTrackedSolanaAddresses,
} from '../services/walletService';
import { listWebhooks, syncSolanaWebhookAddresses } from '../chains/solana/client';
import { env } from '../config/env';

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

  bot.command('diagnose', adminOnly, async (ctx) => {
    const keyHead = env.HELIUS_API_KEY.slice(0, 8);
    const keyTail = env.HELIUS_API_KEY.slice(-4);
    try {
      const webhooks = await listWebhooks();
      const lines: string[] = [
        '*🔍 Helius diagnostics*',
        '',
        `API key: \`${keyHead}…${keyTail}\` (len ${env.HELIUS_API_KEY.length})`,
        `PUBLIC_URL: \`${env.PUBLIC_URL ?? '(not set)'}\``,
        `Webhooks visible to this API key: *${webhooks.length}*`,
        '',
      ];
      if (webhooks.length === 0) {
        lines.push(
          'No webhooks. If you created one in the Helius dashboard,',
          'your Railway `HELIUS_API_KEY` is for a DIFFERENT Helius project.',
          'Check that the dashboard URL contains the same UUID as your key.',
        );
      } else {
        for (const w of webhooks.slice(0, 5)) {
          lines.push(
            `• \`${w.webhookURL}\``,
            `  type=${w.webhookType}, addresses=${w.accountAddresses.length}`,
          );
        }
      }
      await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown' });
    } catch (err) {
      const e = err as Error & { response?: { status?: number; data?: unknown }; config?: { baseURL?: string; url?: string } };
      const where = e.config ? `${e.config.baseURL ?? ''}${e.config.url ?? ''}` : '(no request info)';
      const detail = e.response
        ? `HTTP ${e.response.status} — ${JSON.stringify(e.response.data)}`
        : e.message;
      await ctx.reply(
        `❌ List webhooks failed:\n\`${detail}\`\n\nRequest URL: \`${where}\`\nAPI key: \`${keyHead}…${keyTail}\``,
        { parse_mode: 'Markdown' },
      );
    }
  });

  bot.command('resync', adminOnly, async (ctx) => {
    if (!env.PUBLIC_URL) {
      await ctx.reply('❌ PUBLIC_URL is not set in Railway. Set it before resyncing.');
      return;
    }
    const trimmed = env.PUBLIC_URL.trim().replace(/\/+$/, '');
    const expectedUrl = `${trimmed}/webhooks/solana`;
    let urlValid = false;
    try {
      const u = new URL(expectedUrl);
      urlValid = u.protocol === 'https:' && u.hostname.length > 0;
    } catch {
      urlValid = false;
    }
    if (!urlValid) {
      await ctx.reply(
        [
          '❌ Computed webhook URL is invalid:',
          `\`${expectedUrl}\``,
          '',
          `PUBLIC_URL raw value (len ${env.PUBLIC_URL.length}):`,
          `\`${env.PUBLIC_URL}\``,
          '',
          'Must be `https://your-domain.up.railway.app` — no quotes, no trailing slash, no spaces.',
        ].join('\n'),
        { parse_mode: 'Markdown' },
      );
      return;
    }
    try {
      const addresses = await getAllTrackedSolanaAddresses();
      if (addresses.length === 0) {
        await ctx.reply('No Solana wallets tracked yet — add one via /menu first.');
        return;
      }
      await ctx.reply(`Syncing webhook at:\n\`${expectedUrl}\`\nTracking ${addresses.length} address(es)…`, {
        parse_mode: 'Markdown',
      });
      await syncSolanaWebhookAddresses(addresses);
      const after = await listWebhooks();
      const ours = after.find((w) => w.webhookURL === expectedUrl);
      if (!ours) {
        await ctx.reply(
          `❌ Sync ran but no Helius webhook found at:\n\`${expectedUrl}\`\n\nCheck that HELIUS_API_KEY in Railway matches the Helius project you are viewing.`,
          { parse_mode: 'Markdown' },
        );
        return;
      }
      await ctx.reply(
        [
          '✅ *Helius webhook synced*',
          '',
          `*URL:* \`${ours.webhookURL}\``,
          `*Type:* ${ours.webhookType}`,
          `*Tracked addresses:* ${ours.accountAddresses.length}`,
          ours.accountAddresses.length > 0
            ? `\nFirst few:\n${ours.accountAddresses
                .slice(0, 5)
                .map((a) => `• \`${a}\``)
                .join('\n')}`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      const e = err as Error & {
        response?: { status?: number; data?: unknown };
        config?: { baseURL?: string; url?: string; method?: string };
      };
      const where = e.config ? `${e.config.method?.toUpperCase()} ${e.config.baseURL ?? ''}${e.config.url ?? ''}` : '(no request info)';
      const detail = e.response
        ? `HTTP ${e.response.status} — ${JSON.stringify(e.response.data)}`
        : e.message;
      await ctx.reply(
        `❌ Resync failed:\n\`${detail}\`\n\nRequest: \`${where}\`\nWebhook URL we sent: \`${expectedUrl}\``,
        { parse_mode: 'Markdown' },
      );
    }
  });
}
