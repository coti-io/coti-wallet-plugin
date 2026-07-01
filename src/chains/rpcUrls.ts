import { cotiTestnetChain } from "./coti";
import type { ChainConfig } from "./types";

type ChainConfigLookup = (chainId?: number | string | null) => ChainConfig | undefined;

let resolveChainConfig: ChainConfigLookup = () => undefined;

/** Wired from {@link ./index} to avoid a circular import at module load. */
export function bindChainConfigLookup(lookup: ChainConfigLookup): void {
  resolveChainConfig = lookup;
}

export const getRpcUrlsForChain = (chainId?: number | string | null): string[] => {
  const config = resolveChainConfig(chainId);
  if (!config) return [cotiTestnetChain.rpcUrl];
  return config.rpcFallbackUrls?.length
    ? [config.rpcUrl, ...config.rpcFallbackUrls]
    : [config.rpcUrl];
};
