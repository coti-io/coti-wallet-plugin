import { injected } from 'wagmi/connectors';
import type { Wallet } from '@rainbow-me/rainbowkit';
import { resolveMetaMaskInjectedTarget } from '../lib/ethereum';
import { asInjectedTarget } from './injectedTarget';

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
    (config) => {
      const base = injected({
        target: asInjectedTarget(resolveMetaMaskInjectedTarget),
      })(config);
      return {
        ...base,
        ...walletDetails,
        connect: base.connect.bind(base),
        disconnect: base.disconnect.bind(base),
        getProvider: base.getProvider.bind(base),
        getAccounts: base.getAccounts.bind(base),
        getChainId: base.getChainId.bind(base),
      };
    },
});
