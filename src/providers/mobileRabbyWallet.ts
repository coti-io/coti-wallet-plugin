import { createConnector } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import type { Wallet } from '@rainbow-me/rainbowkit';
import { asInjectedTarget } from './injectedTarget';

/**
 * Returns true when running in a mobile browser (iOS or Android).
 * Mirrors RainbowKit's internal isMobile() utility.
 */
function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipod/i.test(navigator.userAgent)
    || /ipad/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * RainbowKit wallet factory for Rabby that works on both desktop (injected) and
 * mobile (WalletConnect deep link), ensuring it is always visible in the mobile
 * Recommended list even when the browser extension is not present.
 *
 * Mobile deep link: rabby://wc?uri=<encoded-wc-uri>
 * Fallback QR: https://rabby.io/download
 */
export const mobileRabbyWallet = ({ projectId }: { projectId: string }): Wallet => {
  const isRabbyInjected = typeof window !== 'undefined'
    && !!(window.ethereum as Record<string, unknown> | undefined)?.['isRabby'];

  // On mobile the extension is never injected — always use WalletConnect.
  const mobile = isMobileBrowser();
  const shouldUseWalletConnect = mobile || !isRabbyInjected;

  return {
    id: 'rabby',
    name: 'Rabby Wallet',
    rdns: 'io.rabby',
    iconUrl: 'https://rabby.io/favicon.png',
    iconBackground: '#8697FF',
    // Never set installed:false — that causes RainbowKit to hide the wallet.
    // Leaving it undefined defaults to "ready" (shown).
    installed: isRabbyInjected || undefined,
    downloadUrls: {
      android: 'https://play.google.com/store/apps/details?id=com.debank.rabbymobile',
      ios: 'https://apps.apple.com/us/app/rabby-wallet-crypto-evm/id6474381673',
      mobile: 'https://rabby.io/download',
      qrCode: 'https://rabby.io/download',
      chrome: 'https://chrome.google.com/webstore/detail/rabby-wallet/acmacodkjbdgmoleebolmdjonilkdbch',
      browserExtension: 'https://rabby.io',
    },
    // Mobile deep link — opens the Rabby app directly via WalletConnect URI.
    mobile: {
      getUri: shouldUseWalletConnect
        ? (uri: string) => `rabby://wc?uri=${encodeURIComponent(uri)}`
        : undefined,
    },
    // QR code for scanning from desktop.
    qrCode: shouldUseWalletConnect
      ? {
          getUri: (uri: string) => uri,
          instructions: {
            learnMoreUrl: 'https://rabby.io/',
            steps: [
              {
                step: 'install',
                title: 'Open the Rabby app',
                description: 'Download Rabby Wallet on your mobile device from the App Store or Google Play.',
              },
              {
                step: 'create',
                title: 'Create or import a wallet',
                description: 'Set up your wallet inside the Rabby mobile app.',
              },
              {
                step: 'scan',
                title: 'Scan the QR code',
                description: 'Tap the scan icon in Rabby and scan the QR code to connect.',
              },
            ],
          },
        }
      : undefined,
    extension: {
      instructions: {
        learnMoreUrl: 'https://rabby.io/',
        steps: [
          {
            step: 'install',
            title: 'Install the Rabby extension',
            description: 'Install Rabby Wallet from the Chrome Web Store.',
          },
          {
            step: 'create',
            title: 'Create or import a wallet',
            description: 'Set up your wallet in the Rabby browser extension.',
          },
          {
            step: 'refresh',
            title: 'Refresh this page',
            description: 'Refresh the page to connect with Rabby Wallet.',
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
              target: asInjectedTarget({
                id: 'rabby',
                name: 'Rabby Wallet',
                provider: (window as unknown as { ethereum?: unknown }).ethereum,
              }),
            })(config),
            ...walletDetails,
          })),
  };
};
