import type { Chain } from '@prisma/client';

export function txUrl(chain: Chain, txHash: string): string {
  switch (chain) {
    case 'SOLANA':
      return `https://solscan.io/tx/${txHash}`;
    case 'ETHEREUM':
      return `https://etherscan.io/tx/${txHash}`;
    case 'BASE':
      return `https://basescan.org/tx/${txHash}`;
  }
}

export function addressUrl(chain: Chain, address: string): string {
  switch (chain) {
    case 'SOLANA':
      return `https://solscan.io/account/${address}`;
    case 'ETHEREUM':
      return `https://etherscan.io/address/${address}`;
    case 'BASE':
      return `https://basescan.org/address/${address}`;
  }
}

export function tokenUrl(chain: Chain, contractAddress: string): string {
  switch (chain) {
    case 'SOLANA':
      return `https://solscan.io/token/${contractAddress}`;
    case 'ETHEREUM':
      return `https://etherscan.io/token/${contractAddress}`;
    case 'BASE':
      return `https://basescan.org/token/${contractAddress}`;
  }
}
