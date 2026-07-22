import { createConnector } from 'wagmi';
import { injected, walletConnect } from 'wagmi/connectors';
import type { Wallet } from '@rainbow-me/rainbowkit';
import { isUnsupportedRpcMethodError } from '../utils/walletErrors';
import { asInjectedTarget } from './injectedTarget';

function isMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android|iphone|ipod/i.test(navigator.userAgent)
    || /ipad/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/**
 * Window CustomEvent fired when a Zerion WalletConnect connection attempt fails
 * for a reason other than the user cancelling. Zerion only approves sessions for
 * networks it already knows, so a host app should listen for this event and show
 * instructions for adding the COTI network manually in Zerion before retrying.
 */
export const WALLET_CONNECT_FAILURE_EVENT = 'coti-wallet-plugin:wallet-connect-failure';

export interface WalletConnectFailureDetail {
  walletId: string;
  message: string;
}

const isUserCancellation = (message: string): boolean =>
  /user rejected|user disconnected|connection request reset/i.test(message);

const dispatchConnectFailure = (walletId: string, error: unknown): void => {
  if (typeof window === 'undefined') return;
  const message = error instanceof Error ? error.message : String(error);
  if (isUserCancellation(message)) return;
  window.dispatchEvent(
    new CustomEvent<WalletConnectFailureDetail>(WALLET_CONNECT_FAILURE_EVENT, {
      detail: { walletId, message },
    }),
  );
};

const ZERION_ICON_URL =
  'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20fill%3D%22none%22%20viewBox%3D%220%200%2028%2028%22%3E%3Cpath%20fill%3D%22%232962EF%22%20d%3D%22M0%200h28v28H0z%22%2F%3E%3Cpath%20fill%3D%22%23fff%22%20d%3D%22M6.073%207c-.48%200-.665.593-.262.841l10.073%206.074a.577.577%200%200%200%20.758-.139l4.43-5.814c.3-.404-.004-.962-.525-.962H6.073ZM21.904%2021c.48%200%20.67-.596.267-.844l-10.075-6.073a.569.569%200%200%200-.751.146l-4.437%205.813c-.301.404.012.958.534.958h14.462Z%22%2F%3E%3C%2Fsvg%3E';

type Eip1193RequestArgs = { method: string; params?: unknown };

type ZerionProvider = {
  request: (args: Eip1193RequestArgs) => Promise<unknown>;
  __cotiRevokeSafe?: ZerionProvider;
};

/**
 * Zerion rejects `wallet_revokePermissions` with -32601. Wagmi's injected
 * connector calls that method on disconnect; swallow the unsupported-method
 * error so disconnect completes cleanly.
 */
function wrapZerionProvider(provider: ZerionProvider): ZerionProvider {
  if (provider.__cotiRevokeSafe) return provider.__cotiRevokeSafe;

  const wrapped: ZerionProvider = new Proxy(provider, {
    get(target, prop, receiver) {
      if (prop === 'request') {
        return async (args: Eip1193RequestArgs) => {
          try {
            return await target.request(args);
          } catch (error) {
            if (
              args?.method === 'wallet_revokePermissions' &&
              isUnsupportedRpcMethodError(error)
            ) {
              return null;
            }
            throw error;
          }
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });

  provider.__cotiRevokeSafe = wrapped;
  return wrapped;
}

function getZerionInjectedProvider(): ZerionProvider | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const provider = (window as any).zerionWallet as ZerionProvider | undefined;
  if (!provider?.request) return undefined;
  return wrapZerionProvider(provider);
}

/**
 * RainbowKit wallet factory for Zerion that works on both desktop (injected via
 * window.zerionWallet) and mobile (WalletConnect deep link), ensuring it is always
 * visible in the Recommended list even when the browser extension is not present.
 *
 * Mobile deep link (iOS): zerion://wc?uri=<encoded-wc-uri>
 */
export const mobileZerionWallet = ({ projectId }: { projectId: string }): Wallet => {
  const isZerionInjected = typeof window !== 'undefined'
    && !!(window as unknown as Record<string, unknown>)['zerionWallet'];

  const mobile = isMobileBrowser();
  const shouldUseWalletConnect = mobile || !isZerionInjected;

  const getUri = (uri: string) =>
    isIOS() ? `zerion://wc?uri=${encodeURIComponent(uri)}` : uri;

  return {
    id: 'zerion',
    name: 'Zerion',
    rdns: 'io.zerion.wallet',
    iconUrl: ZERION_ICON_URL,
    iconBackground: '#2962EF',
    installed: isZerionInjected || undefined,
    downloadUrls: {
      android: 'https://play.google.com/store/apps/details?id=io.zerion.android',
      ios: 'https://apps.apple.com/app/apple-store/id1456732565',
      mobile: 'https://link.zerion.io/pt3gdRP0njb',
      qrCode: 'https://link.zerion.io/pt3gdRP0njb',
      chrome: 'https://chrome.google.com/webstore/detail/klghhnkeealcohjjanjjdaeeggmfmlpl',
      browserExtension: 'https://zerion.io/extension',
    },
    mobile: {
      getUri: shouldUseWalletConnect ? getUri : undefined,
    },
    qrCode: shouldUseWalletConnect
      ? {
          getUri,
          instructions: {
            learnMoreUrl: 'https://zerion.io/blog/announcing-the-zerion-smart-wallet/',
            steps: [
              {
                step: 'install',
                title: 'Open the Zerion app',
                description: 'Download Zerion on your mobile device from the App Store or Google Play.',
              },
              {
                step: 'create',
                title: 'Create or import a wallet',
                description: 'Set up your wallet inside the Zerion mobile app.',
              },
              {
                step: 'scan',
                title: 'Scan the QR code',
                description: 'Tap the scan icon in Zerion and scan the QR code to connect.',
              },
            ],
          },
        }
      : undefined,
    extension: {
      instructions: {
        learnMoreUrl: 'https://help.zerion.io/en/',
        steps: [
          {
            step: 'install',
            title: 'Install the Zerion extension',
            description: 'Install Zerion from the Chrome Web Store.',
          },
          {
            step: 'create',
            title: 'Create or import a wallet',
            description: 'Set up your wallet in the Zerion browser extension.',
          },
          {
            step: 'refresh',
            title: 'Refresh this page',
            description: 'Refresh the page to connect with Zerion.',
          },
        ],
      },
    },
    createConnector: (walletDetails) =>
      shouldUseWalletConnect
        ? createConnector((config) => {
            const wcConnector = walletConnect({ projectId, showQrModal: false })(config);
            return {
              ...wcConnector,
              ...walletDetails,
              // Zerion only approves WalletConnect sessions for chains it already
              // knows. RainbowKit connects with chainId = the COTI initial chain,
              // and wagmi's in-connect switchChain then aborts the freshly approved
              // session when Zerion rejects the resulting wallet_addEthereumChain.
              // Connect chain-agnostic instead; NetworkGuard pushes the COTI chain
              // once the session is established.
              connect: (async function (
                this: unknown,
                parameters: Parameters<typeof wcConnector.connect>[0] = {},
              ) {
                try {
                  return await wcConnector.connect.call(this, { ...parameters, chainId: undefined });
                } catch (error) {
                  dispatchConnectFailure('zerion', error);
                  throw error;
                }
              }) as unknown as typeof wcConnector.connect,
            };
          })
        : createConnector((config) => {
            // wagmi injected#disconnect calls wallet_revokePermissions (EIP-2255).
            // Zerion does not implement it and rejects with -32601.
            const base = injected({
              target: asInjectedTarget({
                id: 'zerion',
                name: 'Zerion',
                provider: getZerionInjectedProvider,
              }),
            })(config);
            return {
              ...base,
              ...walletDetails,
              disconnect: (async (...args: Parameters<typeof base.disconnect>) => {
                try {
                  await base.disconnect(...args);
                } catch (error) {
                  if (!isUnsupportedRpcMethodError(error)) throw error;
                }
              }) as typeof base.disconnect,
            };
          }),
  };
};
