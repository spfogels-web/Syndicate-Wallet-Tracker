import { AlertType, Project, Transaction, Wallet, WalletStats } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { prisma } from '../database/prisma';
import { logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { env } from '../config/env';
import { getBot } from '../bot';
import { renderBuy, renderLinkedWallet, renderSell, renderTransfer } from './templates';
import { broadcast } from '../server/sse';
import { rawToHuman } from '../utils/format';

export interface DispatchInput {
  type: AlertType;
  project: Project;
  wallet: Wallet & { stats: WalletStats | null };
  tx: Transaction;
  extra?: { combinedPct?: Decimal; childAddress?: string };
}

export async function dispatchAlert(input: DispatchInput): Promise<void> {
  const chatId = input.project.telegramChatId ?? env.TELEGRAM_DEFAULT_CHAT_ID;
  if (!chatId) {
    logger.warn({ projectId: input.project.id }, 'no telegram chatId configured; skipping alert');
    return;
  }

  let message: string;
  switch (input.type) {
    case 'BUY':
      message = renderBuy({ project: input.project, wallet: input.wallet, tx: input.tx });
      break;
    case 'SELL':
      message = renderSell({ project: input.project, wallet: input.wallet, tx: input.tx });
      break;
    case 'LINKED_WALLET':
      message = renderLinkedWallet({
        project: input.project,
        wallet: input.wallet,
        tx: input.tx,
        combinedPct: input.extra?.combinedPct,
        childAddress: input.extra?.childAddress,
      });
      break;
    case 'TRANSFER':
    default:
      message = renderTransfer({ project: input.project, wallet: input.wallet, tx: input.tx });
      break;
  }

  const bot = getBot();
  let messageId: string | undefined;
  try {
    const sent = await withRetry(
      () =>
        bot.api.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          link_preview_options: { is_disabled: true },
        }),
      {
        retries: 3,
        initialDelayMs: 500,
        label: 'telegram.sendMessage',
        // 429 + 5xx are retriable; 4xx (400 Bad Request, 403 Forbidden) are not
        shouldRetry: (err) => {
          const code = (err as { error_code?: number }).error_code;
          if (!code) return true; // network errors
          return code === 429 || code >= 500;
        },
      },
    );
    messageId = String(sent.message_id);
  } catch (err) {
    logger.error({ err, chatId, projectId: input.project.id }, 'telegram send failed');
  }

  await prisma.alert
    .create({
      data: {
        projectId: input.project.id,
        walletId: input.wallet.id,
        transactionId: input.tx.id,
        type: input.type,
        message,
        telegramChatId: chatId,
        telegramMessageId: messageId,
      },
    })
    .catch((err) => logger.warn({ err }, 'failed to persist alert row'));

  // Broadcast to dashboard SSE clients (best-effort, never throws)
  try {
    const humanAmount = rawToHuman(input.tx.amount.toString(), input.project.decimals).toString();
    broadcast({
      type: 'alert',
      alertType: input.type,
      projectId: input.project.id,
      projectName: input.project.name,
      chain: input.project.chain,
      walletId: input.wallet.id,
      walletLabel: input.wallet.label,
      walletAddress: input.wallet.address,
      txHash: input.tx.txHash,
      amount: input.tx.amount.toString(),
      humanAmount,
      symbol: input.project.symbol,
      nativeAmount: input.tx.nativeAmount ? input.tx.nativeAmount.toString() : null,
      currentBalance: input.wallet.stats?.currentBalance.toString() ?? '0',
      ownershipPct: input.wallet.stats?.ownershipPct.toString() ?? '0',
      timestamp: input.tx.timestamp.toISOString(),
    });
  } catch (err) {
    logger.warn({ err }, 'dashboard broadcast failed');
  }
}
