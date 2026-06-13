import React, { useMemo } from 'react';
import { createConfig, http, WagmiProvider, type Config } from 'wagmi';
import { connectorsForWallets } from '@rainbow-me/rainbowkit';
import {
  metaMaskWallet,
  coinbaseWallet,
  walletConnectWallet,
  rainbowWallet,
  rabbyWallet,
  ledgerWallet,
  phantomWallet,
  trustWallet,
} from '@rainbow-me/rainbowkit/wallets';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider } from '@rainbow-me/rainbowkit';
import {
  cotiMainnet,
  cotiTestnet,
  sepolia,
  COTI_MAINNET_RPC,
  COTI_TESTNET_RPC,
  SEPOLIA_RPC,
} from '../config/chains';
import { getPluginConfig } from '../config/plugin';
import { resolveWalletConnectProjectId } from '../config/walletConnect';

interface WagmiRainbowKitProviderProps {
  children: React.ReactNode;
  /** WalletConnect Cloud project ID (falls back to configureCotiPlugin or VITE_WALLETCONNECT_PROJECT_ID). */
  walletConnectProjectId?: string;
}

function createWagmiConfig(walletConnectProjectId?: string) {
  const projectId = resolveWalletConnectProjectId(walletConnectProjectId);

  const connectors = connectorsForWallets(
    [
      {
        groupName: 'Recommended',
        wallets: [metaMaskWallet, rabbyWallet, rainbowWallet, walletConnectWallet],
      },
      {
        groupName: 'Other',
        wallets: [coinbaseWallet, trustWallet, phantomWallet, ledgerWallet],
      },
    ],
    {
      appName: 'COTI Wallet Plugin',
      projectId,
    },
  );

  const pluginConfig = getPluginConfig();
  const sepoliaRpc = pluginConfig.sepoliaRpcUrl ?? SEPOLIA_RPC;

  return createConfig({
    chains: [sepolia, cotiTestnet, cotiMainnet],
    connectors,
    multiInjectedProviderDiscovery: true,
    ssr: false,
    transports: {
      [sepolia.id]: http(sepoliaRpc),
      [cotiMainnet.id]: http(COTI_MAINNET_RPC),
      [cotiTestnet.id]: http(COTI_TESTNET_RPC),
    },
  });
}

const queryClient = new QueryClient();

let cachedDefaultWagmiConfig: Config | undefined;

/**
 * Builds wagmi config from current {@link getPluginConfig} and optional WalletConnect project ID.
 * Prefer {@link WagmiRainbowKitProvider} in React apps; use this for non-React wagmi setup.
 */
export function getWagmiConfig(walletConnectProjectId?: string) {
  if (walletConnectProjectId !== undefined) {
    return createWagmiConfig(walletConnectProjectId);
  }
  if (!cachedDefaultWagmiConfig) {
    cachedDefaultWagmiConfig = createWagmiConfig();
  }
  return cachedDefaultWagmiConfig;
}

/**
 * Default wagmi config (backward-compatible export).
 * Lazily initialized on first property access — requires a configured WalletConnect project ID.
 * For config that reflects {@link configureCotiPlugin} after import, use {@link getWagmiConfig}
 * or {@link WagmiRainbowKitProvider}.
 */
export const wagmiConfig: Config = new Proxy({} as Config, {
  get(_target, prop, receiver) {
    const config = getWagmiConfig();
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
}: WagmiRainbowKitProviderProps) {
  const { sepoliaRpcUrl } = getPluginConfig();
  const config = useMemo(
    () => createWagmiConfig(walletConnectProjectId),
    [walletConnectProjectId, sepoliaRpcUrl],
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          initialChain={cotiTestnet}
          modalSize="compact"
          appInfo={{ appName: 'COTI Wallet' }}
        >
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
