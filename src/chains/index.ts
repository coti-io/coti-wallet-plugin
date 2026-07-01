import { cotiMainnetChain, cotiTestnetChain, COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID } from "./coti";
import { sepoliaChain, SEPOLIA_CHAIN_ID } from "./sepolia";
import { avalancheFujiChain, AVALANCHE_FUJI_CHAIN_ID } from "./avalancheFuji";
import { avalancheCChain, AVALANCHE_C_CHAIN_ID } from "./avalancheCChain";
import { ethereumMainnetPortalChain } from "./ethereumMainnetPortal";
import { ETHEREUM_MAINNET_CHAIN_ID } from "./ethereumMainnetPortal";
import type {
  ChainConfig,
  ResolvedIndexPageUi,
  TokenConfig,
  UnlockStrategy,
  WalletNetworkConfig,
} from "./types";
import { resolveTargetCotiChainId } from "./resolveTargetCotiChainId";

const POD_TRACKING_CHAIN_ORDER = [
  SEPOLIA_CHAIN_ID,
  AVALANCHE_FUJI_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  AVALANCHE_C_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
  COTI_MAINNET_CHAIN_ID,
] as const;

export type { ChainConfig, ResolvedIndexPageUi, TokenConfig, UnlockStrategy, WalletNetworkConfig };
export {
  COTI_MAINNET_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  AVALANCHE_FUJI_CHAIN_ID,
  AVALANCHE_C_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
};

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  [sepoliaChain.id]: sepoliaChain,
  [avalancheFujiChain.id]: avalancheFujiChain,
  [ethereumMainnetPortalChain.id]: ethereumMainnetPortalChain,
  [avalancheCChain.id]: avalancheCChain,
  [cotiTestnetChain.id]: cotiTestnetChain,
  [cotiMainnetChain.id]: cotiMainnetChain,
};

export const DEFAULT_CHAIN_ID = COTI_TESTNET_CHAIN_ID;

/** Numeric chain IDs registered in {@link CHAIN_CONFIGS} (COTI + Sepolia PoD, etc.). */
export const getSupportedChainIds = (): number[] =>
  Object.keys(CHAIN_CONFIGS).map(id => Number(id));

/** True when the chain has plugin config (bridge/PoD portal, tokens, RPC). */
export const isSupportedChain = (chainId: number): boolean =>
  Number.isFinite(chainId) && chainId in CHAIN_CONFIGS;

export const getChainConfig = (chainId?: number | string | null) => {
  const numericChainId = chainId == null ? undefined : Number(chainId);
  return numericChainId ? CHAIN_CONFIGS[numericChainId] : undefined;
};

export const requireChainConfig = (chainId: number | string) => {
  const config = getChainConfig(chainId);
  if (!config) throw new Error(`Unsupported chain ID: ${chainId}`);
  return config;
};

export const getContractAddresses = (chainId?: number | string | null) =>
  getChainConfig(chainId)?.addresses;

export const getTokensForChain = (chainId?: number | string | null) =>
  getChainConfig(chainId)?.tokens ?? [];

export const getPublicTokensForChain = (chainId?: number | string | null): TokenConfig[] =>
  getTokensForChain(chainId).filter(token => !token.isPrivate);

export const getPrivateTokensForChain = (chainId?: number | string | null): TokenConfig[] =>
  getTokensForChain(chainId).filter(token => token.isPrivate);

export const getExplorerBaseUrlForChain = (chainId?: number | string | null) =>
  getChainConfig(chainId)?.explorerBaseUrl ?? cotiTestnetChain.explorerBaseUrl;

export const getRpcUrlForChain = (chainId?: number | string | null) =>
  getChainConfig(chainId)?.rpcUrl ?? cotiTestnetChain.rpcUrl;

export const getNetworkNameForChain = (chainId?: number | string | null) =>
  getChainConfig(chainId)?.name ?? "Wrong Network";

export const getUnlockStrategyForChain = (chainId?: number | string | null): UnlockStrategy =>
  getChainConfig(chainId)?.unlockStrategy ?? "snap";

/** Host chains using the PoD privacy portal strategy. */
export const getPodPortalHostChainIds = (): number[] =>
  Object.values(CHAIN_CONFIGS)
    .filter(config => config.portalStrategy === "pod-privacy-portal")
    .map(config => config.id);

/**
 * PoD SDK tracking set: portal host chains with a configured inbox plus their target COTI chains.
 * Chains without `podInboxAddress` are excluded until deployed.
 */
export const getPodTrackingChainIds = (): number[] => {
  const hosts = getPodPortalHostChainIds().filter(chainId => {
    const inbox = getChainConfig(chainId)?.podInboxAddress?.trim();
    return !!inbox;
  });
  const cotiTargets = hosts.map(resolveTargetCotiChainId);
  const available = new Set([...hosts, ...cotiTargets]);
  return POD_TRACKING_CHAIN_ORDER.filter(chainId => available.has(chainId));
};

export const getWalletNetworkConfigs = (): Record<string, WalletNetworkConfig> =>
  Object.values(CHAIN_CONFIGS).reduce<Record<string, WalletNetworkConfig>>((acc, config) => {
    acc[config.hexId] = config.walletNetwork;
    return acc;
  }, {});

export const getWalletNetworkOptions = () =>
  Object.values(CHAIN_CONFIGS).map(config => ({ id: config.hexId, label: config.name }));

export const getChainIdConstants = () => ({
  COTI_MAINNET_ID: cotiMainnetChain.hexId,
  COTI_TESTNET_ID: cotiTestnetChain.hexId,
  SEPOLIA_ID: sepoliaChain.hexId,
});

export const resolveIndexPageUi = (chainId: number): ResolvedIndexPageUi => {
  const cfg = CHAIN_CONFIGS[chainId] ?? CHAIN_CONFIGS[DEFAULT_CHAIN_ID];
  const ip = cfg.indexPage;
  const nativeSymbol = cfg.walletNetwork.nativeCurrency.symbol;
  return {
    showPodRequestTracker: ip.showPodRequestTracker,
    amountModalGasLabel: ip.amountModalGasLabel,
    amountModalGasSymbol: ip.amountModalGasSymbol === "native" ? nativeSymbol : "COTI",
  };
};

export {
  chainConfigToViemChain,
  cotiMainnet,
  cotiTestnet,
  sepolia,
  avalancheFuji,
  ethereumMainnet,
  avalancheC,
  ETHEREUM_MAINNET_RPC,
  COTI_MAINNET_RPC,
  COTI_TESTNET_RPC,
  SEPOLIA_RPC,
  AVALANCHE_FUJI_RPC,
  AVALANCHE_C_RPC,
  getRpcUrlForChainId,
} from "./viemChains";

export {
  getTargetCotiChainName,
  getTargetCotiWalletNetwork,
  resolveCotiSnapEnvironment,
  resolveTargetCotiChainId,
} from "./resolveTargetCotiChainId";
