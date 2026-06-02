import React from 'react';
import { createConfig, http, WagmiProvider } from 'wagmi';
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
  ethereumMainnet,
  COTI_MAINNET_RPC,
  COTI_TESTNET_RPC,
  ETHEREUM_MAINNET_RPC,
} from '../config/chains';

interface WagmiRainbowKitProviderProps {
  children: React.ReactNode;
  /** Optional override for WalletConnect project ID (defaults to VITE_WALLETCONNECT_PROJECT_ID) */
  walletConnectProjectId?: string;
}

function createWagmiConfig(walletConnectProjectId?: string) {
  const projectId =
    walletConnectProjectId ?? import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '';

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
    }
  );

  return createConfig({
    chains: [cotiMainnet, cotiTestnet, ethereumMainnet],
    connectors,
    multiInjectedProviderDiscovery: true,
    transports: {
      [cotiMainnet.id]: http(COTI_MAINNET_RPC),
      [cotiTestnet.id]: http(COTI_TESTNET_RPC),
      [ethereumMainnet.id]: http(ETHEREUM_MAINNET_RPC),
    },
  });
}

/** Default wagmi config using env variable for WalletConnect project ID */
export const wagmiConfig = createWagmiConfig();

const queryClient = new QueryClient();

/**
 * Wraps children with wagmi WagmiProvider, React Query QueryClientProvider,
 * and RainbowKitProvider. Single entry point for multi-wallet support.
 */
export function WagmiRainbowKitProvider({
  children,
  walletConnectProjectId,
}: WagmiRainbowKitProviderProps) {
  const config = walletConnectProjectId
    ? createWagmiConfig(walletConnectProjectId)
    : wagmiConfig;

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>
          {children}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
