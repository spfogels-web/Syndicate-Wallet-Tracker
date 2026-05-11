import bs58 from 'bs58';
import { isAddress, getAddress } from 'viem';
import type { Chain } from '@prisma/client';

export function isValidSolanaAddress(addr: string): boolean {
  try {
    const decoded = bs58.decode(addr);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

export function isValidEvmAddress(addr: string): boolean {
  return isAddress(addr);
}

/**
 * Normalize an address for storage / lookups.
 * - EVM: lowercase (so DB unique constraint catches case variants)
 * - Solana: leave as-is, base58 is case-sensitive
 */
export function normalizeAddress(chain: Chain, addr: string): string {
  if (chain === 'SOLANA') return addr;
  return addr.toLowerCase();
}

/** Returns the canonical EIP-55 checksummed form for display purposes. */
export function checksumAddress(chain: Chain, addr: string): string {
  if (chain === 'SOLANA') return addr;
  try {
    return getAddress(addr);
  } catch {
    return addr;
  }
}

export function validateAddress(chain: Chain, addr: string): boolean {
  return chain === 'SOLANA' ? isValidSolanaAddress(addr) : isValidEvmAddress(addr);
}
