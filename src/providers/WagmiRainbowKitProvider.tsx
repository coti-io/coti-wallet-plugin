import React, { useMemo } from 'react';
import { type Chain } from 'viem';
import { createConfig, http, fallback, WagmiProvider, type Config } from 'wagmi';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  metaMaskWallet,
  coinbaseWallet,
  walletConnectWallet,
  rabbyWallet,
  ledgerWallet,
  oneKeyWallet,
  trustWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import {
  cotiMainnet,
  cotiTestnet,
  sepolia,
  avalancheFuji,
  COTI_MAINNET_RPC,
  COTI_TESTNET_RPC,
  SEPOLIA_RPC,
  SEPOLIA_RPC_FALLBACK,
  AVALANCHE_FUJI_RPC,
  AVALANCHE_FUJI_RPC_FALLBACK,
} from '../config/chains';
import { getPluginConfig } from '../config/plugin';
import { resolveWalletConnectProjectId } from '../config/walletConnect';

/** RainbowKit-compatible mobile detection (iOS, Android, iPad). */
const isMobileBrowser = (): boolean => {
  if (typeof navigator === 'undefined') return false;
  return (
    /android|iphone|ipod/i.test(navigator.userAgent)
    || (/ipad/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))
  );
};

type WalletFactory = Parameters<typeof connectorsForWallets>[0][number]['wallets'][number];

const DESKTOP_WALLET_GROUPS: { groupName: string; wallets: WalletFactory[] }[] = [
  {
    groupName: 'Recommended',
    wallets: [metaMaskWallet, rabbyWallet, trustWallet, oneKeyWallet, walletConnectWallet],
  },
  {
    groupName: 'Other',
    wallets: [coinbaseWallet, ledgerWallet],
  },
];

const MOBILE_WALLET_GROUPS: { groupName: string; wallets: WalletFactory[] }[] = [
  {
    groupName: 'Recommended',
    wallets: [walletConnectWallet, metaMaskWallet, rabbyWallet, trustWallet, oneKeyWallet],
  },
];

const getWalletGroups = () => (isMobileBrowser() ? MOBILE_WALLET_GROUPS : DESKTOP_WALLET_GROUPS);

interface WagmiRainbowKitProviderProps {
  children: React.ReactNode;
  /** WalletConnect Cloud project ID (falls back to configureCotiPlugin or VITE_WALLETCONNECT_PROJECT_ID). */
  walletConnectProjectId?: string;
  /** Override the chain pre-selected in the RainbowKit connect modal. Defaults to cotiTestnet. */
  initialChain?: Chain;
  /** Override the app name shown in the RainbowKit modal. Defaults to 'COTI Wallet'. */
  appName?: string;
}

function createWagmiConfig(walletConnectProjectId?: string) {
  const projectId = resolveWalletConnectProjectId(walletConnectProjectId);

  const connectors = connectorsForWallets(
    getWalletGroups(),
    {
      appName: 'COTI Wallet Plugin',
      projectId,
    },
  );

  const pluginConfig = getPluginConfig();
  const sepoliaTransport = pluginConfig.sepoliaRpcUrl
    ? http(pluginConfig.sepoliaRpcUrl)
    : fallback([http(SEPOLIA_RPC), http(SEPOLIA_RPC_FALLBACK)]);

  return createConfig({
    chains: [sepolia, cotiTestnet, cotiMainnet, avalancheFuji],
    connectors,
    multiInjectedProviderDiscovery: true,
    ssr: false,
    transports: {
      [sepolia.id]: sepoliaTransport,
      [cotiMainnet.id]: http(COTI_MAINNET_RPC),
      [cotiTestnet.id]: http(COTI_TESTNET_RPC),
      [avalancheFuji.id]: fallback([http(AVALANCHE_FUJI_RPC), http(AVALANCHE_FUJI_RPC_FALLBACK)]),
    },
  });
}

const queryClient = new QueryClient();

function getWagmiConfigCacheKey(walletConnectProjectId?: string): string {
  const pluginConfig = getPluginConfig();
  const projectId = resolveWalletConnectProjectId(walletConnectProjectId);
  const sepoliaRpc = pluginConfig.sepoliaRpcUrl ?? `${SEPOLIA_RPC}|${SEPOLIA_RPC_FALLBACK}`;
  const mobile = isMobileBrowser();
  return `${projectId}|${sepoliaRpc}|${mobile ? 'mobile' : 'desktop'}`;
}

let cachedWagmiConfig: { key: string; config: Config } | undefined;

function getCachedWagmiConfig(walletConnectProjectId?: string): Config {
  const key = getWagmiConfigCacheKey(walletConnectProjectId);
  if (cachedWagmiConfig?.key === key) {
    return cachedWagmiConfig.config;
  }
  const config = createWagmiConfig(walletConnectProjectId);
  cachedWagmiConfig = { key, config };
  return config;
}

/**
 * Builds wagmi config from current {@link getPluginConfig} and optional WalletConnect project ID.
 * Returns a stable instance for unchanged plugin settings (safe for `wagmiConfig` and render).
 * Prefer {@link WagmiRainbowKitProvider} in React apps; use this for non-React wagmi setup.
 */
export function getWagmiConfig(walletConnectProjectId?: string) {
  return getCachedWagmiConfig(walletConnectProjectId);
}

/**
 * Default wagmi config (backward-compatible export).
 * Lazily initialized on first property access — requires a configured WalletConnect project ID.
 * Rebuilt when {@link configureCotiPlugin} changes wagmi-relevant settings.
 */
export const wagmiConfig: Config = new Proxy({} as Config, {
  get(_target, prop, receiver) {
    const config = getCachedWagmiConfig();
    const value = Reflect.get(config as object, prop, receiver);
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(config) : value;
  },
});

/**
 * Wraps children with wagmi WagmiProvider, React Query QueryClientProvider,
 * and RainbowKitProvider. Single entry point for multi-wallet support.
 */
export function WagmiRainbowKitProvider({
  children,
  walletConnectProjectId,
  initialChain = cotiTestnet,
  appName = 'COTI Wallet',
}: WagmiRainbowKitProviderProps) {
  const pluginConfig = getPluginConfig();
  const config = useMemo(
    () => createWagmiConfig(walletConnectProjectId),
    [walletConnectProjectId, pluginConfig.sepoliaRpcUrl, pluginConfig.walletConnectProjectId],
  );

  return (
    <WagmiProvider config={config} reconnectOnMount={false}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={initialChain}
          modalSize="compact"
          appInfo={{ appName }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
