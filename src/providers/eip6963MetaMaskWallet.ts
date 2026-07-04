import { createConnector } from 'wagmi';
import { injected } from 'wagmi/connectors';
import type { Wallet } from '@rainbow-me/rainbowkit/wallets';
import {
  getEip6963MetaMaskProvider,
  getEthereumProvider,
  type EIP1193Provider,
} from '../lib/ethereum';

function findMetaMaskInProviders(providers: EIP1193Provider[]): EIP1193Provider | undefined {
  return providers.find(
    (p) => p.isMetaMask && !p.isRabby && !p.isPhantom && !p.isTrust,
  );
}

function resolveEip6963MetaMaskTarget() {
  const eip6963 = getEip6963MetaMaskProvider();
  if (eip6963) {
    return { id: 'io.metamask', name: 'MetaMask', provider: eip6963 };
  }

  const eth = getEthereumProvider();
  if (eth?.providers?.length) {
    const mm = findMetaMaskInProviders(eth.providers);
    if (mm) {
      return { id: 'io.metamask', name: 'MetaMask', provider: mm };
    }
  }

  if (eth) {
    return { id: 'io.metamask', name: 'MetaMask', provider: eth };
  }

  return undefined;
}

/**
 * RainbowKit wallet factory that connects via EIP-6963-discovered MetaMask provider,
 * avoiding window.ethereum hijacking by other installed wallets.
 */
export const eip6963MetaMaskWallet = (): Wallet => ({
  id: 'io.metamask',
  name: 'MetaMask',
  rdns: 'io.metamask',
  iconUrl: 'https://raw.githubusercontent.com/MetaMask/brand-resources/master/SVG/metamask-fox.svg',
  iconBackground: '#fff',
  downloadUrls: {
    android: 'https://play.google.com/store/apps/details?id=io.metamask',
    ios: 'https://apps.apple.com/us/app/metamask/id1438144202',
    mobile: 'https://metamask.io/download',
    qrCode: 'https://metamask.io/download',
    chrome: 'https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn',
    edge: 'https://microsoftedge.microsoft.com/addons/detail/metamask/ejbalbakoplchlghecdalmeeeajnimhm',
    firefox: 'https://addons.mozilla.org/firefox/addon/ether-metamask',
    opera: 'https://addons.opera.com/extensions/details/metamask-10',
    browserExtension: 'https://metamask.io/download',
  },
  createConnector: (walletDetails) =>
    createConnector((config) => ({
      ...injected({
        target() {
          return resolveEip6963MetaMaskTarget();
        },
      })(config),
      ...walletDetails,
    })),
});
