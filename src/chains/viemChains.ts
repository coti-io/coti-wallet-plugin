import { defineChain, type Chain } from "viem";
import type { ChainConfig } from "./types";
import { cotiMainnetChain, cotiTestnetChain } from "./coti";
import { sepoliaChain } from "./sepolia";

const REGISTRY_RPC_BY_CHAIN_ID: Record<number, string> = {
  [cotiMainnetChain.id]: cotiMainnetChain.rpcUrl,
  [cotiTestnetChain.id]: cotiTestnetChain.rpcUrl,
  [sepoliaChain.id]: sepoliaChain.rpcUrl,
};

/** Explorer display name derived from registry URL (avoids duplicating viem metadata). */
const explorerNameFromUrl = (url: string): string => {
  if (url.includes("etherscan")) return "Etherscan";
  if (url.includes("cotiscan")) return "CotiScan";
  return "Explorer";
};

/** Builds a viem {@link Chain} from a {@link CHAIN_CONFIGS} entry. */
export const chainConfigToViemChain = (config: ChainConfig): Chain =>
  defineChain({
    id: config.id,
    name: config.name,
    nativeCurrency: { ...config.walletNetwork.nativeCurrency },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers: {
      default: {
        name: explorerNameFromUrl(config.explorerBaseUrl),
        url: config.explorerBaseUrl,
      },
    },
  });

/** viem chains for wagmi — derived from {@link CHAIN_CONFIGS}. */
export const cotiMainnet = chainConfigToViemChain(cotiMainnetChain);
export const cotiTestnet = chainConfigToViemChain(cotiTestnetChain);
export const sepolia = chainConfigToViemChain(sepoliaChain);

/** RPC URL constants derived from the registry (single source of truth). */
export const COTI_MAINNET_RPC = cotiMainnetChain.rpcUrl;
export const COTI_TESTNET_RPC = cotiTestnetChain.rpcUrl;
export const SEPOLIA_RPC = sepoliaChain.rpcUrl;

/**
 * Auxiliary Ethereum L1 chain — not in {@link CHAIN_CONFIGS}; legacy RPC helper only.
 */
export const ETHEREUM_MAINNET_CHAIN_ID = 1;
export const ETHEREUM_MAINNET_RPC = "https://eth.llamarpc.com";
export const ethereumMainnet = defineChain({
  id: ETHEREUM_MAINNET_CHAIN_ID,
  name: "Ethereum Mainnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ETHEREUM_MAINNET_RPC] } },
  blockExplorers: { default: { name: "Etherscan", url: "https://etherscan.io" } },
});

/**
 * Resolves an RPC URL for ethers.js callers.
 * Prefer {@link getRpcUrlForChain} for registry chains; handles auxiliary chain id 1.
 */
export function getRpcUrlForChainId(chainId?: number): string {
  if (chainId === ETHEREUM_MAINNET_CHAIN_ID) return ETHEREUM_MAINNET_RPC;
  if (chainId != null && chainId in REGISTRY_RPC_BY_CHAIN_ID) {
    return REGISTRY_RPC_BY_CHAIN_ID[chainId];
  }
  return cotiTestnetChain.rpcUrl;
}
