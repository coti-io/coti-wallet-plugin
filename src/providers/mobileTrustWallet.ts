import { createConnector } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import type { Wallet } from '@rainbow-me/rainbowkit/wallets';

function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipod/i.test(navigator.userAgent)
    || /ipad/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * RainbowKit wallet factory for Trust Wallet that works on both desktop (injected) and
 * mobile (WalletConnect deep link), ensuring it is always visible in the mobile
 * Recommended list even when the browser extension is not present.
 *
 * Mobile deep link: https://link.trustwallet.com/wc?uri=<encoded-wc-uri>
 */
export const mobileTrustWallet = ({ projectId }: { projectId: string }): Wallet => {
  const isTrustInjected = typeof window !== 'undefined'
    && !!(window as Record<string, unknown>).trustwallet;

  const mobile = isMobileBrowser();
  const shouldUseWalletConnect = mobile || !isTrustInjected;

  return {
    id: 'trust',
    name: 'Trust Wallet',
    iconUrl: 'https://trustwallet.com/assets/images/media/assets/trust_platform.svg',
    iconBackground: '#3375BB',
    installed: isTrustInjected || undefined,
    downloadUrls: {
      android: 'https://play.google.com/store/apps/details?id=com.wallet.crypto.trustapp',
      ios: 'https://apps.apple.com/app/trust-crypto-bitcoin-wallet/id1288339409',
      mobile: 'https://trustwallet.com/download',
      qrCode: 'https://trustwallet.com/download',
      chrome: 'https://chromewebstore.google.com/detail/trust-wallet/egjidjbpglichdcondbcbdnbeeppgdph',
      browserExtension: 'https://trustwallet.com/browser-extension',
    },
    mobile: {
      getUri: shouldUseWalletConnect
        ? (uri: string) => `https://link.trustwallet.com/wc?uri=${encodeURIComponent(uri)}`
        : undefined,
    },
    qrCode: shouldUseWalletConnect
      ? {
          getUri: (uri: string) => uri,
          instructions: {
            learnMoreUrl: 'https://trustwallet.com/download',
            steps: [
              {
                step: 'install',
                title: 'Open the Trust Wallet app',
                description: 'Download Trust Wallet on your mobile device from the App Store or Google Play.',
              },
              {
                step: 'create',
                title: 'Create or import a wallet',
                description: 'Set up your wallet inside the Trust Wallet mobile app.',
              },
              {
                step: 'scan',
                title: 'Scan the QR code',
                description: 'Tap the scan icon in Trust Wallet and scan the QR code to connect.',
              },
            ],
          },
        }
      : undefined,
    extension: {
      instructions: {
        learnMoreUrl: 'https://trustwallet.com/download',
        steps: [
          {
            step: 'install',
            title: 'Install the Trust Wallet extension',
            description: 'Install Trust Wallet from the Chrome Web Store.',
          },
          {
            step: 'create',
            title: 'Create or import a wallet',
            description: 'Set up your wallet in the Trust Wallet browser extension.',
          },
          {
            step: 'refresh',
            title: 'Refresh this page',
            description: 'Refresh the page to connect with Trust Wallet.',
          },
        ],
      },
    },
    createConnector: (walletDetails) =>
      shouldUseWalletConnect
        ? createConnector((config) => ({
            ...walletConnect({ projectId, showQrModal: false })(config),
            ...walletDetails,
          }))
        : createConnector((config) => ({
            ...injected({
              target: {
                id: 'trust-extension',
                name: 'Trust Wallet',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                provider: (window as any).trustwallet,
              },
            })(config),
            ...walletDetails,
          })),
  };
};
