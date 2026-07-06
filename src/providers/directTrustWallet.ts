import { createConnector } from 'wagmi';
import { injected } from 'wagmi/connectors';
import type { Wallet } from '@rainbow-me/rainbowkit/wallets';
import { resolveTrustInjectedTarget } from '../lib/ethereum';

/**
 * RainbowKit wallet factory that connects via the Trust Browser Extension's
 * EIP-6963 provider (or window.trustwallet fallback).
 */
export const directTrustWallet = (): Wallet => ({
  id: 'trust-extension',
  name: 'Trust Wallet',
  iconUrl: 'https://trustwallet.com/assets/images/media/assets/trust_platform.svg',
  iconBackground: '#3375BB',
  downloadUrls: {
    chrome: 'https://chromewebstore.google.com/detail/trust-wallet/egjidjbpglichdcondbcbdnbeeppgdph',
    browserExtension: 'https://trustwallet.com/browser-extension',
  },
  createConnector: (walletDetails) =>
    createConnector((config) => ({
      ...injected({
        target() {
          return resolveTrustInjectedTarget();
        },
      })(config),
      ...walletDetails,
    })),
});
