import { cotiMainnetChain, cotiTestnetChain, COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID } from "./coti";
import { sepoliaChain, SEPOLIA_CHAIN_ID } from "./sepolia";
import type {
  ChainConfig,
  ResolvedIndexPageUi,
  TokenConfig,
  UnlockStrategy,
  WalletNetworkConfig,
} from "./types";

export type { ChainConfig, ResolvedIndexPageUi, TokenConfig, UnlockStrategy, WalletNetworkConfig };
export { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID, SEPOLIA_CHAIN_ID };

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  [sepoliaChain.id]: sepoliaChain,
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
  ethereumMainnet,
  ETHEREUM_MAINNET_CHAIN_ID,
  ETHEREUM_MAINNET_RPC,
  COTI_MAINNET_RPC,
  COTI_TESTNET_RPC,
  SEPOLIA_RPC,
  getRpcUrlForChainId,
} from "./viemChains";
