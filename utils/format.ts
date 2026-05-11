import { Decimal } from 'decimal.js';

/**
 * Convert a raw on-chain integer amount to a human number using token decimals.
 * Returns a Decimal (do not lose precision by going through Number).
 */
export function rawToHuman(raw: string | bigint | number, decimals: number): Decimal {
  return new Decimal(raw.toString()).div(new Decimal(10).pow(decimals));
}

/** Pretty number formatter: 2,450,000 ; 1.4 ; 0.0034 */
export function formatAmount(value: Decimal | string | number, maxDp = 4): string {
  const d = value instanceof Decimal ? value : new Decimal(value);
  // Strip trailing zeros after the decimal point, but cap at maxDp
  const fixed = d.toDecimalPlaces(maxDp, Decimal.ROUND_DOWN).toFixed();
  const [intPart, decPart] = fixed.split('.');
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart && decPart !== '0' ? `${withCommas}.${decPart}` : withCommas;
}

/** 0xabc...123 — truncates an address for display. */
export function shortenAddress(address: string, head = 6, tail = 4): string {
  if (address.length <= head + tail + 2) return address;
  return `${address.slice(0, head)}...${address.slice(-tail)}`;
}

export function formatPercent(pct: Decimal | number, dp = 2): string {
  const d = pct instanceof Decimal ? pct : new Decimal(pct);
  return `${d.toFixed(dp)}%`;
}

/** Telegram MarkdownV2 escape — must escape every reserved char. */
const MDV2_ESCAPE = /([_*[\]()~`>#+\-=|{}.!\\])/g;
export function escapeMarkdownV2(text: string): string {
  return text.replace(MDV2_ESCAPE, '\\$1');
}

/** Format a Date in a human-readable way: "May 10, 2026". */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
