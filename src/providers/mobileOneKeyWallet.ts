import { createConnector } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import type { Wallet } from '@rainbow-me/rainbowkit/wallets';

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
 * RainbowKit wallet factory for OneKey that works on both desktop (injected via
 * $onekey.ethereum) and mobile (WalletConnect deep link), ensuring it is always
 * visible in the mobile Recommended list even when the extension is not present.
 *
 * Mobile universal link: https://onekeywallet.app.link/wc?uri=<encoded-wc-uri>
 */
export const mobileOneKeyWallet = ({ projectId }: { projectId: string }): Wallet => {
  const isOneKeyInjected = typeof window !== 'undefined'
    && !!(window as Record<string, unknown>)['$onekey'];

  // On mobile the extension is never injected — always use WalletConnect.
  const mobile = isMobileBrowser();
  const shouldUseWalletConnect = mobile || !isOneKeyInjected;

  return {
    id: 'onekey',
    name: 'OneKey',
    rdns: 'so.onekey.app.wallet',
    iconUrl: 'https://common.onekey-asset.com/logo/onekey-x256.png',
    iconBackground: '#44D62C',
    // Never set installed:false — that causes RainbowKit to hide the wallet.
    installed: isOneKeyInjected || undefined,
    downloadUrls: {
      android: 'https://play.google.com/store/apps/details?id=so.onekey.app.wallet',
      ios: 'https://apps.apple.com/us/app/onekey-open-source-wallet/id1609559473',
      mobile: 'https://www.onekey.so/download/',
      qrCode: 'https://www.onekey.so/download/',
      chrome: 'https://chrome.google.com/webstore/detail/onekey/jnmbobjmhlngoefaiojfljckilhhlhcj',
      edge: 'https://microsoftedge.microsoft.com/addons/detail/onekey/obffkkagpmohennipjokmpllocnlndac',
      browserExtension: 'https://www.onekey.so/download/',
    },
    // Mobile deep link — opens the OneKey app directly via WalletConnect URI.
    // OneKey uses a universal link (https://onekeywallet.app.link/wc) which
    // works reliably across iOS and Android without custom URI scheme issues.
    mobile: {
      getUri: shouldUseWalletConnect
        ? (uri: string) => `https://onekeywallet.app.link/wc?uri=${encodeURIComponent(uri)}`
        : undefined,
    },
    // QR code for scanning from desktop.
    qrCode: shouldUseWalletConnect
      ? {
          getUri: (uri: string) => uri,
          instructions: {
            learnMoreUrl: 'https://help.onekey.so/hc/en-us/categories/360000170236',
            steps: [
              {
                step: 'install',
                title: 'Open the OneKey app',
                description: 'Download OneKey on your mobile device from the App Store or Google Play.',
              },
              {
                step: 'create',
                title: 'Create or import a wallet',
                description: 'Set up your wallet inside the OneKey mobile app.',
              },
              {
                step: 'scan',
                title: 'Scan the QR code',
                description: 'Tap the scan icon in OneKey and scan the QR code to connect.',
              },
            ],
          },
        }
      : undefined,
    extension: {
      instructions: {
        learnMoreUrl: 'https://help.onekey.so/hc/en-us/categories/360000170236',
        steps: [
          {
            step: 'install',
            title: 'Install the OneKey extension',
            description: 'Install OneKey from the Chrome Web Store or Edge Add-ons.',
          },
          {
            step: 'create',
            title: 'Create or import a wallet',
            description: 'Set up your wallet in the OneKey browser extension.',
          },
          {
            step: 'refresh',
            title: 'Refresh this page',
            description: 'Refresh the page to connect with OneKey.',
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
                id: 'onekey',
                name: 'OneKey',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                provider: (window as any)['$onekey']?.ethereum,
              },
            })(config),
            ...walletDetails,
          })),
  };
};
