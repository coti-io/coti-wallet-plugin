import rawConfig from "./config.json";
import type { BridgeData } from "../hooks/useBridgeData";
import type { ChainConfig, TokenConfig } from "./types";

type RawTokenConfig = Omit<TokenConfig, "supportedChainIds"> & {
  supportedChainIds?: number[];
};

type RawChainConfig = Omit<ChainConfig, "tokens" | "getBridgeDataOverride"> & {
  tokens: RawTokenConfig[];
};

const emptyBridgeData: Omit<
  BridgeData,
  | "bridgeName"
  | "bridgeAddress"
  | "publicToken"
  | "publicTokenIcon"
  | "privateToken"
  | "privateTokenIcon"
  | "tokenDecimals"
> = {
  depositFixedFee: "0",
  depositPercentageBps: "0",
  depositMaxFee: "0",
  withdrawFixedFee: "0",
  withdrawPercentageBps: "0",
  withdrawMaxFee: "0",
  minDepositAmount: "0",
  maxDepositAmount: "0",
  minWithdrawAmount: "0",
  maxWithdrawAmount: "0",
  accumulatedFees: "0",
  accumulatedCotiFees: "0",
  nativeCotiFee: "0",
  bridgeBalance: "0",
  isPaused: false,
  isLoading: false,
  error: null,
};

const makePodBridgeDataOverride =
  (tokens: TokenConfig[]) =>
  (addresses: Record<string, string>): BridgeData[] => {
    const privateTokensByBridge = tokens.reduce<Map<string, TokenConfig>>((acc, token) => {
      if (token.isPrivate && token.bridgeAddressKey) {
        acc.set(token.bridgeAddressKey, token);
      }
      return acc;
    }, new Map());

    const bridges: BridgeData[] = [];

    for (const publicToken of tokens) {
      const bridgeAddressKey = publicToken.bridgeAddressKey;
      if (publicToken.isPrivate || !bridgeAddressKey?.startsWith("PrivacyPortal")) continue;

      const privateToken = privateTokensByBridge.get(bridgeAddressKey);
      const bridgeAddress = addresses[bridgeAddressKey];
      if (!privateToken || !bridgeAddress) continue;

      bridges.push({
        ...emptyBridgeData,
        bridgeName: `${publicToken.symbol} PoD Portal`,
        bridgeAddress,
        publicToken: publicToken.symbol,
        publicTokenIcon: publicToken.icon,
        privateToken: privateToken.symbol,
        privateTokenIcon: privateToken.icon,
        tokenDecimals: publicToken.decimals,
      });
    }

    return bridges;
  };

const buildChainConfig = (rawChain: RawChainConfig): ChainConfig => {
  const tokens = rawChain.tokens.map(token => ({
    ...token,
    supportedChainIds: token.supportedChainIds ?? [rawChain.id],
  }));

  return {
    ...rawChain,
    tokens,
    getBridgeDataOverride:
      rawChain.portalStrategy === "pod-privacy-portal" ? makePodBridgeDataOverride(tokens) : undefined,
  };
};

export const CHAIN_CONFIG_LIST: ChainConfig[] = (rawConfig.chains as unknown as RawChainConfig[]).map(buildChainConfig);

export const CHAIN_CONFIGS: Record<number, ChainConfig> = Object.fromEntries(
  CHAIN_CONFIG_LIST.map(chain => [chain.id, chain])
);

export const getConfiguredChain = (chainId: number): ChainConfig => {
  const chain = CHAIN_CONFIGS[chainId];
  if (!chain) {
    throw new Error(`Missing chain config for ${chainId}`);
  }
  return chain;
};
