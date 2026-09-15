import { defineChain, type Chain } from "viem";
import type { ChainConfig } from "./types";
import { cotiMainnetChain, cotiTestnetChain } from "./coti";
import { sepoliaChain } from "./sepolia";
import { avalancheFujiChain } from "./avalancheFuji";
import { avalancheCChain } from "./avalanche";
import { ethereumMainnetChain, ETHEREUM_MAINNET_CHAIN_ID } from "./ethereum";

const REGISTRY_RPC_BY_CHAIN_ID: Record<number, string> = {
  [cotiMainnetChain.id]: cotiMainnetChain.rpcUrl,
  [cotiTestnetChain.id]: cotiTestnetChain.rpcUrl,
  [sepoliaChain.id]: sepoliaChain.rpcUrl,
  [avalancheFujiChain.id]: avalancheFujiChain.rpcUrl,
  [avalancheCChain.id]: avalancheCChain.rpcUrl,
  [ethereumMainnetChain.id]: ethereumMainnetChain.rpcUrl,
};

/** Explorer display name derived from registry URL (avoids duplicating viem metadata). */
const explorerNameFromUrl = (url: string): string => {
  if (url.includes("etherscan")) return "Etherscan";
  if (url.includes("cotiscan")) return "CotiScan";
  if (url.includes("snowscan")) return "SnowScan";
  return "Explorer";
};

/** Builds a viem {@link Chain} from a {@link CHAIN_CONFIGS} entry. */
export const chainConfigToViemChain = (config: ChainConfig): Chain => {
  const httpRpcUrls = config.rpcFallbackUrls?.length
    ? [config.rpcUrl, ...config.rpcFallbackUrls]
    : [config.rpcUrl];

  return defineChain({
    id: config.id,
    name: config.name,
    nativeCurrency: { ...config.walletNetwork.nativeCurrency },
    rpcUrls: { default: { http: httpRpcUrls } },
    blockExplorers: {
      default: {
        name: explorerNameFromUrl(config.explorerBaseUrl),
        url: config.explorerBaseUrl,
      },
    },
  });
};

/** viem chains for wagmi — derived from {@link CHAIN_CONFIGS}. */
export const cotiMainnet = chainConfigToViemChain(cotiMainnetChain);
export const cotiTestnet = chainConfigToViemChain(cotiTestnetChain);
export const sepolia = chainConfigToViemChain(sepoliaChain);
export const avalancheFuji = chainConfigToViemChain(avalancheFujiChain);
export const avalanche = chainConfigToViemChain(avalancheCChain);
export const ethereumMainnet = chainConfigToViemChain(ethereumMainnetChain);

/** RPC URL constants derived from the registry (single source of truth). */
export const COTI_MAINNET_RPC = cotiMainnetChain.rpcUrl;
export const COTI_TESTNET_RPC = cotiTestnetChain.rpcUrl;
export const SEPOLIA_RPC = sepoliaChain.rpcUrl;
export const SEPOLIA_RPC_FALLBACK = sepoliaChain.rpcFallbackUrls?.[0] ?? sepoliaChain.rpcUrl;
export const AVALANCHE_FUJI_RPC = avalancheFujiChain.rpcUrl;
export const AVALANCHE_FUJI_RPC_FALLBACK =
  avalancheFujiChain.rpcFallbackUrls?.[0] ?? avalancheFujiChain.rpcUrl;
export const ETHEREUM_MAINNET_RPC = ethereumMainnetChain.rpcUrl;
export { ETHEREUM_MAINNET_CHAIN_ID };

/**
 * Resolves an RPC URL for ethers.js callers.
 * Prefer {@link getRpcUrlForChain} for registry chains.
 */
export function getRpcUrlForChainId(chainId?: number): string {
  if (chainId != null && chainId in REGISTRY_RPC_BY_CHAIN_ID) {
    return REGISTRY_RPC_BY_CHAIN_ID[chainId];
  }
  return cotiTestnetChain.rpcUrl;
}
