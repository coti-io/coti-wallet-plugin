/**
 * Optional RainbowKit + wagmi wrapper.
 * Import from `@coti-io/coti-wallet-plugin/rainbowkit`.
 * Hosts that already mount `WagmiProvider` should use `CotiPluginProvider` from the main entry.
 */
import './version';

export {
  WagmiRainbowKitProvider,
  getWagmiConfig,
  wagmiConfig,
  type WagmiConfigOptions,
} from './providers/WagmiRainbowKitProvider';
export {
  mobileZerionWallet,
  WALLET_CONNECT_FAILURE_EVENT,
  type WalletConnectFailureDetail,
} from './providers/mobileZerionWallet';
export { useConnectModal } from '@rainbow-me/rainbowkit';
