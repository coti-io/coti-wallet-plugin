import { ethers } from "ethers";
import { getPluginConfig } from "../config/plugin";
import { COTI_TESTNET_CHAIN_ID } from "../chains/coti";
import { getRpcUrlsForChain } from "../chains/rpcUrls";
import { SEPOLIA_CHAIN_ID } from "../chains/sepolia";
import { logger } from "./logger";

/** Plugin override first, then chain primary + configured fallbacks (deduped). */
export const resolveRpcUrlsForChain = (chainId?: number | string | null): string[] => {
  const base = getRpcUrlsForChain(chainId);
  const numericId = chainId == null ? undefined : Number(chainId);
  if (numericId == null || !Number.isFinite(numericId)) return base;

  const plugin = getPluginConfig();
  let override: string | undefined;
  if (numericId === SEPOLIA_CHAIN_ID && plugin.sepoliaRpcUrl) {
    override = plugin.sepoliaRpcUrl;
  } else if (numericId === COTI_TESTNET_CHAIN_ID && plugin.cotiTestnetRpcUrl) {
    override = plugin.cotiTestnetRpcUrl;
  }
  if (!override) return base;
  return [...new Set([override, ...base])];
};

const collectErrorText = (error: unknown): string => {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

/** True for rate limits, timeouts, and other errors worth retrying on the next RPC URL. */
export const isTransientRpcError = (error: unknown): boolean => {
  const text = collectErrorText(error);
  if (
    text.includes("Too Many Requests")
    || text.includes("rate limit")
    || text.includes("-32005")
    || text.includes("ECONNRESET")
    || text.includes("ETIMEDOUT")
    || text.includes("timeout")
    || text.includes("503")
    || text.includes("502")
  ) {
    return true;
  }
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (code === "SERVER_ERROR" || code === "TIMEOUT" || code === "NETWORK_ERROR") {
      return true;
    }
  }
  return false;
};

export const createJsonRpcProvider = (url: string, chainId: number) =>
  new ethers.JsonRpcProvider(url, chainId);

/** Picks the first RPC endpoint that responds to `getNetwork()`. */
export const createResilientJsonRpcProvider = async (
  chainId: number,
): Promise<ethers.JsonRpcProvider> => {
  const urls = resolveRpcUrlsForChain(chainId);
  let lastError: unknown;
  for (const url of urls) {
    const provider = createJsonRpcProvider(url, chainId);
    try {
      await provider.getNetwork();
      return provider;
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
      logger.warn(`[rpc] ${url} unavailable for chain ${chainId}, trying fallback`);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`No RPC available for chain ${chainId}`);
};

/** Runs `fn` against each configured RPC until one succeeds or all fail. */
export const withRpcFallback = async <T>(
  chainId: number,
  fn: (provider: ethers.JsonRpcProvider) => Promise<T>,
): Promise<T> => {
  const urls = resolveRpcUrlsForChain(chainId);
  let lastError: unknown;
  for (const url of urls) {
    const provider = createJsonRpcProvider(url, chainId);
    try {
      return await fn(provider);
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
      logger.warn(`[rpc] ${url} request failed for chain ${chainId}, trying fallback`);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`All RPC endpoints failed for chain ${chainId}`);
};
