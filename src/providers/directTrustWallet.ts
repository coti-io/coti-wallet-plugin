import { createConnector } from 'wagmi';
import { injected } from 'wagmi/connectors';
import type { Wallet } from '@rainbow-me/rainbowkit/wallets';

function resolveDirectTrustWalletTarget() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  const provider = window.trustwallet;
  if (!provider) {
    return undefined;
  }

  return { id: 'trust-extension', name: 'Trust Wallet', provider };
}

/**
 * RainbowKit wallet factory that connects via the Trust Browser Extension's
 * window.trustwallet provider directly, instead of generic injection or WalletConnect.
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
          return resolveDirectTrustWalletTarget();
        },
      })(config),
      ...walletDetails,
    })),
});
