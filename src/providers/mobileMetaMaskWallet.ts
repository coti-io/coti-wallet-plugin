import { createConnector } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import type { Wallet } from '@rainbow-me/rainbowkit';
import { asInjectedTarget } from './injectedTarget';

function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipod/i.test(navigator.userAgent)
    || /ipad/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isMetaMaskInjected(): boolean {
  if (typeof window === 'undefined') return false;
  const eth = window.ethereum as Record<string, unknown> | undefined;
  if (!eth) return false;
  if (eth.providers && Array.isArray(eth.providers)) {
    return eth.providers.some(
      (p: Record<string, unknown>) => p.isMetaMask && !p.isRabby && !p.isPhantom && !p.isTrust,
    );
  }
  return !!eth.isMetaMask && !eth.isRabby && !eth.isPhantom && !eth.isTrust;
}

/**
 * RainbowKit wallet factory for MetaMask that works on both desktop (injected) and
 * mobile (WalletConnect deep link), ensuring it is always visible in the mobile
 * Recommended list even when the browser extension is not present.
 *
 * Mobile deep link: https://metamask.app.link/wc?uri=<encoded-wc-uri>
 */
export const mobileMetaMaskWallet = ({ projectId }: { projectId: string }): Wallet => {
  const mobile = isMobileBrowser();
  const shouldUseWalletConnect = mobile || !isMetaMaskInjected();

  return {
    id: 'metamask',
    name: 'MetaMask',
    rdns: 'io.metamask',
    iconUrl: 'https://raw.githubusercontent.com/MetaMask/brand-resources/master/SVG/metamask-fox.svg',
    iconBackground: '#fff',
    installed: isMetaMaskInjected() || undefined,
    downloadUrls: {
      android: 'https://play.google.com/store/apps/details?id=io.metamask',
      ios: 'https://apps.apple.com/us/app/metamask/id1438144202',
      mobile: 'https://metamask.io/download',
      qrCode: 'https://metamask.io/download/',
      chrome: 'https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn',
      browserExtension: 'https://metamask.io/download/',
    },
    mobile: {
      getUri: shouldUseWalletConnect
        ? (uri: string) => `https://metamask.app.link/wc?uri=${encodeURIComponent(uri)}`
        : undefined,
    },
    qrCode: shouldUseWalletConnect
      ? {
          getUri: (uri: string) => uri,
          instructions: {
            learnMoreUrl: 'https://metamask.io/download/',
            steps: [
              {
                step: 'install',
                title: 'Open the MetaMask app',
                description: 'Download MetaMask on your mobile device from the App Store or Google Play.',
              },
              {
                step: 'create',
                title: 'Create or import a wallet',
                description: 'Set up your wallet inside the MetaMask mobile app.',
              },
              {
                step: 'scan',
                title: 'Scan the QR code',
                description: 'Tap the scan icon in MetaMask and scan the QR code to connect.',
              },
            ],
          },
        }
      : undefined,
    extension: {
      instructions: {
        learnMoreUrl: 'https://metamask.io/download/',
        steps: [
          {
            step: 'install',
            title: 'Install the MetaMask extension',
            description: 'Install MetaMask from the Chrome Web Store.',
          },
          {
            step: 'create',
            title: 'Create or import a wallet',
            description: 'Set up your wallet in the MetaMask browser extension.',
          },
          {
            step: 'refresh',
            title: 'Refresh this page',
            description: 'Refresh the page to connect with MetaMask.',
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
              target: asInjectedTarget(() => {
                const eth = (window as unknown as { ethereum?: Record<string, unknown> }).ethereum;
                if (eth?.providers && Array.isArray(eth.providers)) {
                  const mm = eth.providers.find(
                    (p: Record<string, unknown>) =>
                      p.isMetaMask && !p.isRabby && !p.isPhantom && !p.isTrust,
                  );
                  if (mm) return { id: 'metamask', name: 'MetaMask', provider: mm };
                }
                return { id: 'metamask', name: 'MetaMask', provider: eth };
              }),
            })(config),
            ...walletDetails,
          })),
  };
};
