import { ethers } from "ethers";
import { getPluginConfig } from "../config/plugin";
import { AVALANCHE_FUJI_CHAIN_ID } from "../chains/avalancheFuji";
import { COTI_TESTNET_CHAIN_ID } from "../chains/coti";
import { getNetworkNameForChain } from "../chains";
import { getRpcUrlsForChain } from "../chains/rpcUrls";
import { SEPOLIA_CHAIN_ID } from "../chains/sepolia";
import { createRpcRateLimitedError, reportPluginError } from "../errors";
import { logger } from "./logger";
import { getPluginRuntime } from "./pluginRuntime";

const collectErrorText = (error: unknown): string => {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    const e = error as Error & {
      shortMessage?: string;
      info?: unknown;
      error?: unknown;
      data?: unknown;
      code?: unknown;
    };
    const parts = [e.message, e.shortMessage, String(e.code ?? "")];
    try {
      parts.push(JSON.stringify({ info: e.info, error: e.error, data: e.data }));
    } catch {
      // ignore
    }
    return parts.filter(Boolean).join(" ");
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const readNestedRpcCode = (error: object): unknown => {
  const e = error as {
    code?: unknown;
    error?: { code?: unknown; data?: { httpStatus?: unknown } };
    info?: { error?: { code?: unknown }; responseStatus?: unknown };
    data?: { httpStatus?: unknown };
  };
  return e.code ?? e.error?.code ?? e.info?.error?.code;
};

const readNestedHttpStatus = (error: object): unknown => {
  const e = error as {
    data?: { httpStatus?: unknown };
    error?: { data?: { httpStatus?: unknown } };
    info?: { responseStatus?: unknown };
    responseStatus?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  return (
    e.data?.httpStatus
    ?? e.error?.data?.httpStatus
    ?? e.info?.responseStatus
    ?? e.responseStatus
    ?? e.status
    ?? e.statusCode
  );
};

const httpStatusLooksRateLimited = (httpStatus: unknown): boolean => {
  if (httpStatus === 429 || httpStatus === "429") return true;
  const text = String(httpStatus ?? "");
  return /\b429\b/.test(text) || /too many requests/i.test(text);
};

/** True for rate limits, timeouts, and other errors worth retrying on the next RPC URL. */
export const isTransientRpcError = (error: unknown): boolean => {
  const text = collectErrorText(error);
  const lower = text.toLowerCase();
  if (
    lower.includes("too many requests")
    || lower.includes("rate limit")
    || text.includes("-32005")
    || text.includes("ECONNRESET")
    || text.includes("ETIMEDOUT")
    || lower.includes("timeout")
    || text.includes("503")
    || text.includes("502")
    || text.includes("403")
    || text.includes("429")
    || lower.includes("forbidden")
    || lower.includes("exceeded maximum retry limit")
  ) {
    return true;
  }
  if (error && typeof error === "object") {
    const code = readNestedRpcCode(error);
    if (
      code === "SERVER_ERROR"
      || code === "TIMEOUT"
      || code === "NETWORK_ERROR"
      || code === -32005
      || code === "-32005"
    ) {
      return true;
    }
    if (httpStatusLooksRateLimited(readNestedHttpStatus(error))) {
      return true;
    }
  }
  return false;
};

/** True only for RPC rate-limit responses (429 / -32005), not general timeouts. */
export const isRateLimitedRpcError = (error: unknown): boolean => {
  const text = collectErrorText(error);
  const lower = text.toLowerCase();
  if (
    lower.includes("too many requests")
    || lower.includes("rate limit")
    || lower.includes("rate limited")
    || text.includes("-32005")
    || /\b429\b/.test(text)
    // ethers escalates exhausted 429 retries to this message (status may be 599)
    || lower.includes("exceeded maximum retry limit")
  ) {
    return true;
  }
  if (error && typeof error === "object") {
    const code = readNestedRpcCode(error);
    if (code === -32005 || code === "-32005") {
      return true;
    }
    if (httpStatusLooksRateLimited(readNestedHttpStatus(error))) {
      return true;
    }
  }
  return false;
};

/** After a chain's primary is rate-limited, prefer fallback URLs for subsequent reads. */
export const markPrimaryRateLimited = (chainId: number): void => {
  getPluginRuntime().markPrimaryRateLimited(chainId);
};

/** @deprecated Prefer {@link markPrimaryRateLimited}. */
export const markFujiPrimaryRateLimited = (): void => {
  markPrimaryRateLimited(AVALANCHE_FUJI_CHAIN_ID);
};

const rateLimitedErrorForChain = (chainId: number) =>
  createRpcRateLimitedError(getNetworkNameForChain(chainId));

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
  let urls = !override ? base : [...new Set([override, ...base])];

  if (getPluginRuntime().prefersFallbackRpc(numericId) && urls.length > 1) {
    urls = [urls[1], urls[0], ...urls.slice(2)];
  }
  return urls;
};

/**
 * Builds a JsonRpcProvider. On Fuji, fail fast on HTTP 429 so callers can move
 * to the next RPC URL instead of ethers retrying QuikNode up to 12 times while
 * balances stay stuck at the initial "0".
 */
export const createJsonRpcProvider = (url: string, chainId: number) => {
  if (chainId === AVALANCHE_FUJI_CHAIN_ID) {
    const request = new ethers.FetchRequest(url);
    request.setThrottleParams({ maxAttempts: 2 });
    request.retryFunc = async (_req, response) => response.statusCode !== 429;
    return new ethers.JsonRpcProvider(request, chainId);
  }
  return new ethers.JsonRpcProvider(url, chainId);
};

const isWaitTimeoutError = (error: unknown): boolean => {
  const text = collectErrorText(error).toLowerCase();
  return text.includes("timeout") || text.includes("timed out") || text.includes("waitfortx");
};

/** Preserve ethers on-chain revert failures; those are not RPC transients. */
const isTransactionRevertError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "CALL_EXCEPTION" || code === "TRANSACTION_REPLACED";
};

const sleep = (ms: number): Promise<void> =>
  new Promise(resolve => {
    setTimeout(resolve, ms);
  });

export type WaitForTransactionResilientOptions = {
  confirmations?: number;
  /** Total budget for primary + fallback polling. Default 180s. */
  timeoutMs?: number;
  /** Initial poll interval while receipt is missing. Default 2s. */
  pollIntervalMs?: number;
  /** Prefer waiting via the submitting provider first (wallet / BrowserProvider). */
  primary?: ethers.Provider;
  /** Optional provider factory (tests / custom RPC clients). */
  createProvider?: (url: string, chainId: number) => ethers.JsonRpcProvider;
};

/**
 * Waits for a mined receipt, surviving RPC rate limits by falling back across
 * configured chain RPC URLs with exponential backoff.
 *
 * Reverted transactions return a receipt with `status === 0` (callers decide
 * how to surface that). ethers `CALL_EXCEPTION` / replacement errors from the
 * primary wait are rethrown unchanged.
 */
export async function waitForTransactionResilient(
  chainId: number,
  txHash: string,
  options: WaitForTransactionResilientOptions = {},
): Promise<ethers.TransactionReceipt> {
  const {
    confirmations = 1,
    timeoutMs = 180_000,
    pollIntervalMs = 2_000,
    primary,
    createProvider = createJsonRpcProvider,
  } = options;

  if (!txHash) {
    throw new Error("waitForTransactionResilient: missing transaction hash");
  }

  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  if (primary) {
    const remaining = Math.max(0, deadline - Date.now());
    const primaryTimeout = Math.min(12_000, remaining);
    if (primaryTimeout > 0) {
      try {
        const receipt = await primary.waitForTransaction(txHash, confirmations, primaryTimeout);
        if (receipt) return receipt;
      } catch (error) {
        lastError = error;
        if (isTransactionRevertError(error)) throw error;
        if (!isTransientRpcError(error) && !isWaitTimeoutError(error)) throw error;
        logger.warn(
          `[rpc] primary waitForTransaction failed for ${txHash} on chain ${chainId}; polling via fallback RPCs`,
        );
      }
    }
  }

  let delay = pollIntervalMs;
  while (Date.now() < deadline) {
    try {
      const receipt = await getTransactionReceiptAcrossRpcs(chainId, txHash, createProvider);
      if (receipt) {
        if (confirmations <= 1) return receipt;
        const blockNumber = await withRpcFallback(chainId, provider => provider.getBlockNumber());
        if (receipt.blockNumber + (confirmations - 1) <= blockNumber) {
          return receipt;
        }
      }
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
      logger.warn(
        `[rpc] receipt poll failed for ${txHash} on chain ${chainId}; retrying after backoff`,
      );
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await sleep(Math.min(delay, remaining));
    delay = Math.min(Math.floor(delay * 1.5), 8_000);
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(
      `Timed out waiting for transaction ${txHash} on chain ${chainId} after ${timeoutMs}ms`,
    );
}

/** Returns the first non-null receipt across configured RPCs, or null if none have mined it yet. */
async function getTransactionReceiptAcrossRpcs(
  chainId: number,
  txHash: string,
  createProvider: (url: string, chainId: number) => ethers.JsonRpcProvider = createJsonRpcProvider,
): Promise<ethers.TransactionReceipt | null> {
  const urls = resolveRpcUrlsForChain(chainId);
  let lastError: unknown;
  let sawNotFound = false;

  for (const url of urls) {
    const provider = createProvider(url, chainId);
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) return receipt;
      sawNotFound = true;
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
      logger.warn(`[rpc] ${url} getTransactionReceipt failed for chain ${chainId}, trying fallback`);
    }
  }

  if (sawNotFound) return null;
  throw lastError instanceof Error
    ? lastError
    : new Error(`All RPC endpoints failed reading receipt for ${txHash} on chain ${chainId}`);
}

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
  let sawRateLimit = false;

  for (const url of urls) {
    const provider = createJsonRpcProvider(url, chainId);
    try {
      const result = await fn(provider);
      // Report only after the full primary→fallback cycle when a prior URL was rate-limited.
      if (sawRateLimit) {
        markPrimaryRateLimited(chainId);
        reportPluginError(rateLimitedErrorForChain(chainId));
      }
      return result;
    } catch (error) {
      lastError = error;
      if (isRateLimitedRpcError(error)) {
        sawRateLimit = true;
        markPrimaryRateLimited(chainId);
      }
      if (!isTransientRpcError(error)) throw error;
      logger.warn(`[rpc] ${url} request failed for chain ${chainId}, trying fallback`);
    }
  }

  // Surface rate-limit UI only when a rate-limit was actually observed
  // (not for unrelated transient failures like plain timeouts).
  if (sawRateLimit || isRateLimitedRpcError(lastError)) {
    markPrimaryRateLimited(chainId);
    const rateLimited = rateLimitedErrorForChain(chainId);
    reportPluginError(rateLimited);
    throw rateLimited;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`All RPC endpoints failed for chain ${chainId}`);
};
