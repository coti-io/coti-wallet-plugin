/**
 * Unified network configuration for COTI chains.
 *
 * Ported from coti-snap/packages/snap/src/config/index.ts
 */

/** Network configuration for a COTI chain. */
export interface NetworkConfig {
  chainId: number;
  networkName: string;
  rpcUrl: string;
  explorerUrl: string;
  isTestnet: boolean;
}

/** All supported COTI network configurations, keyed by chain ID. */
export const NETWORK_CONFIGS: Record<number, NetworkConfig> = {
  2632500: {
    chainId: 2632500,
    networkName: 'COTI Mainnet',
    rpcUrl: 'https://mainnet.coti.io/rpc',
    explorerUrl: 'https://mainnet.cotiscan.io',
    isTestnet: false,
  },
  7082400: {
    chainId: 7082400,
    networkName: 'COTI Testnet',
    rpcUrl: 'https://testnet.coti.io/rpc',
    explorerUrl: 'https://testnet.cotiscan.io',
    isTestnet: true,
  },
};

/**
 * Returns the NetworkConfig for a given chain ID.
 * Throws if the chain ID is not a supported COTI network.
 *
 * @param chainId - The numeric chain ID (e.g., 2632500 for mainnet).
 * @returns The corresponding NetworkConfig.
 * @throws Error if the chain ID is not supported.
 */
export function getNetworkConfig(chainId: number): NetworkConfig {
  const config = NETWORK_CONFIGS[chainId];
  if (!config) {
    throw new Error(`Unsupported COTI chain ID: ${chainId}`);
  }
  return config;
}
