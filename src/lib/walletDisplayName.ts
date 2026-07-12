import type { WalletType } from '../hooks/useWalletType';

export function getWalletDisplayName(walletType: WalletType): string {
  switch (walletType) {
    case 'coinbase':
      return 'Coinbase Wallet';
    case 'walletconnect':
      return 'WalletConnect';
    case 'metamask':
      return 'MetaMask';
    case 'rainbow':
      return 'Rainbow Wallet';
    default:
      return 'your wallet';
  }
}
