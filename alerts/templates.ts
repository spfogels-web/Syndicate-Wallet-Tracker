import type { Project, Transaction, Wallet, WalletStats } from '@prisma/client';
import { Decimal } from 'decimal.js';
import { formatAmount, formatDate, formatPercent, rawToHuman, shortenAddress } from '../utils/format';
import { formatDuration } from '../utils/duration';
import { txUrl } from '../utils/explorer';

export interface AlertContext {
  project: Project;
  wallet: Wallet & { stats: WalletStats | null };
  tx: Transaction;
  combinedPct?: Decimal;
  childAddress?: string;
}

const chainLabel = (c: Project['chain']) => (c === 'SOLANA' ? 'Solana' : c === 'ETHEREUM' ? 'Ethereum' : 'Base');

export function renderBuy(ctx: AlertContext): string {
  const { project, wallet, tx } = ctx;
  const human = formatAmount(rawToHuman(tx.amount.toString(), project.decimals));
  const balance = wallet.stats
    ? formatAmount(rawToHuman(wallet.stats.currentBalance.toString(), project.decimals))
    : '0';
  const ownership = wallet.stats ? formatPercent(new Decimal(wallet.stats.ownershipPct.toString())) : '0%';
  const native = tx.nativeAmount ? `${formatAmount(tx.nativeAmount.toString(), 4)} ${nativeSymbol(project.chain)}` : '—';
  const firstBuy = wallet.stats?.firstBuyAt ? formatDate(wallet.stats.firstBuyAt) : '—';
  const heldFor = wallet.stats?.firstBuyAt ? formatDuration(wallet.stats.firstBuyAt.getTime(), tx.timestamp.getTime()) : '—';
  const symbol = project.symbol ?? project.name;
  return [
    '🟢 *BUY DETECTED*',
    `Project: ${project.name}`,
    `Chain: ${chainLabel(project.chain)}`,
    `Wallet: ${wallet.label}`,
    `Bought: ${human} ${symbol}`,
    `Spent: ${native}`,
    `Current Balance: ${balance} ${symbol}`,
    `Ownership: ${ownership}`,
    `First Buy: ${firstBuy}`,
    `Holding Time: ${heldFor}`,
    `TX: ${txUrl(project.chain, tx.txHash)}`,
  ].join('\n');
}

export function renderSell(ctx: AlertContext): string {
  const { project, wallet, tx } = ctx;
  const human = formatAmount(rawToHuman(tx.amount.toString(), project.decimals));
  const balance = wallet.stats
    ? formatAmount(rawToHuman(wallet.stats.currentBalance.toString(), project.decimals))
    : '0';
  const ownership = wallet.stats ? formatPercent(new Decimal(wallet.stats.ownershipPct.toString())) : '0%';
  const heldFor = wallet.stats?.firstBuyAt
    ? formatDuration(wallet.stats.firstBuyAt.getTime(), tx.timestamp.getTime())
    : '—';
  const symbol = project.symbol ?? project.name;
  return [
    '🔴 *SELL DETECTED*',
    `Project: ${project.name}`,
    `Wallet: ${wallet.label}`,
    `Sold: ${human} ${symbol}`,
    `Remaining Balance: ${balance} ${symbol}`,
    `Ownership After Sell: ${ownership}`,
    `Held For: ${heldFor}`,
    `TX: ${txUrl(project.chain, tx.txHash)}`,
  ].join('\n');
}

export function renderTransfer(ctx: AlertContext): string {
  const { project, wallet, tx } = ctx;
  const human = formatAmount(rawToHuman(tx.amount.toString(), project.decimals));
  const symbol = project.symbol ?? project.name;
  const direction = tx.type === 'TRANSFER_IN' ? 'received' : 'sent';
  return [
    '🟡 *TRANSFER DETECTED*',
    `Project: ${project.name}`,
    `Wallet: ${wallet.label}`,
    `${direction === 'received' ? 'Received' : 'Sent'}: ${human} ${symbol}`,
    `Counterparty: ${tx.counterparty ? shortenAddress(tx.counterparty) : '—'}`,
    `TX: ${txUrl(project.chain, tx.txHash)}`,
  ].join('\n');
}

export function renderLinkedWallet(ctx: AlertContext): string {
  const { project, wallet, tx, combinedPct, childAddress } = ctx;
  const human = formatAmount(rawToHuman(tx.amount.toString(), project.decimals));
  const symbol = project.symbol ?? project.name;
  return [
    '🟡 *LINKED WALLET DETECTED*',
    `Project: ${project.name}`,
    `Original Wallet: ${wallet.label}`,
    `Transferred: ${human} ${symbol}`,
    `New Wallet: ${childAddress ? shortenAddress(childAddress) : '—'}`,
    'This wallet is now being tracked automatically.',
    `Combined Ownership: ${combinedPct ? formatPercent(combinedPct) : '—'}`,
    `TX: ${txUrl(project.chain, tx.txHash)}`,
  ].join('\n');
}

function nativeSymbol(chain: Project['chain']): string {
  return chain === 'SOLANA' ? 'SOL' : 'ETH';
}
