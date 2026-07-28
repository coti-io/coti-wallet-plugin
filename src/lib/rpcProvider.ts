import { ethers } from "ethers";
import { getPluginConfig } from "../config/plugin";
import { AVALANCHE_FUJI_CHAIN_ID } from "../chains/avalancheFuji";
import { COTI_TESTNET_CHAIN_ID } from "../chains/coti";
import { getRpcUrlsForChain } from "../chains/rpcUrls";
import { SEPOLIA_CHAIN_ID } from "../chains/sepolia";
import { createRpcRateLimitedError, reportPluginError } from "../errors";
import { logger } from "./logger";

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

const providerCache = new Map<string, ethers.JsonRpcProvider>();

/**
 * Providers are memoized per (chainId, url). ethers batches concurrent requests
 * and caches responses per provider *instance*, so building a fresh provider for
 * every read — as this module used to — sent each balance call as its own HTTP
 * request. Reusing the instance lets a parallel balance refresh collapse into a
 * single batched POST over one keep-alive connection.
 */
export const createJsonRpcProvider = (url: string, chainId: number) => {
  const key = `${chainId}:${url}`;
  const cached = providerCache.get(key);
  if (cached) return cached;

  // ethers retries HTTP 429 inside FetchRequest before surfacing anything to us
  // (default 12 attempts, and its first backoff slot computes to 0ms). Left alone
  // it grinds on a throttled endpoint while balances stay stuck at "0", and hides
  // the failure from the cooldown tracking below. Fail fast on 429 and let
  // withRpcFallback own backoff and rotation. Applied to every chain, not just
  // Fuji — the ethers default is a liability wherever an endpoint throttles.
  //
  // This only covers endpoints returning a real 429 status; QuikNode reports rate
  // limits in-band as a JSON-RPC -32005 body with HTTP 200, which never reaches
  // this path and is classified by isRateLimitedRpcError instead.
  const connection = new ethers.FetchRequest(url);
  connection.setThrottleParams({ slotInterval: 500, maxAttempts: 2 });
  connection.retryFunc = async (_req, response) => response.statusCode !== 429;

  const provider = new ethers.JsonRpcProvider(connection, chainId, {
    // Without this ethers issues an eth_chainId before *every* request, doubling
    // request volume. Safe here because the chain id is always passed explicitly.
    staticNetwork: true,
    // Well under the default 100: our largest refresh is a handful of calls, and
    // public endpoints are likelier to reject oversized batches.
    batchMaxCount: 10,
  });
  providerCache.set(key, provider);
  return provider;
};

/** Endpoints parked after a rate limit, keyed by URL -> cooldown expiry (ms). */
const rpcCooldownUntil = new Map<string, number>();

/** How long a rate-limited endpoint is deprioritized before it is tried first again. */
const RPC_COOLDOWN_MS = 30_000;

const markRpcUnhealthy = (url: string, retryAfterMs?: number): void => {
  rpcCooldownUntil.set(url, Date.now() + Math.max(retryAfterMs ?? 0, RPC_COOLDOWN_MS));
};

const markRpcHealthy = (url: string): void => {
  rpcCooldownUntil.delete(url);
};

/**
 * Configured order, except endpoints still in cooldown sink to the back (soonest
 * to recover first). They are deprioritized rather than dropped, so a chain whose
 * endpoints have all rate-limited stays usable.
 */
const orderRpcUrlsByHealth = (urls: string[]): string[] => {
  const now = Date.now();
  const healthy: string[] = [];
  const cooling: string[] = [];
  for (const url of urls) {
    const until = rpcCooldownUntil.get(url) ?? 0;
    if (until <= now) {
      rpcCooldownUntil.delete(url);
      healthy.push(url);
    } else {
      cooling.push(url);
    }
  }
  cooling.sort((a, b) => (rpcCooldownUntil.get(a) ?? 0) - (rpcCooldownUntil.get(b) ?? 0));
  return [...healthy, ...cooling];
};

/**
 * Parks the configured Fuji primary in the shared cooldown map. This supersedes
 * the original one-way preference latch: the cooldown expires, so a recovered
 * primary is used again instead of being demoted for the rest of the session.
 */
export const markFujiPrimaryRateLimited = (): void => {
  const [primary] = getRpcUrlsForChain(AVALANCHE_FUJI_CHAIN_ID);
  if (primary) markRpcUnhealthy(primary);
};

/** `Retry-After` is either seconds or an HTTP date; ethers surfaces headers under a few shapes. */
const readRetryAfterMs = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") return undefined;
  const e = error as {
    info?: { responseHeaders?: Record<string, string> };
    response?: { headers?: Record<string, string> };
    headers?: Record<string, string>;
  };
  const headers = e.info?.responseHeaders ?? e.response?.headers ?? e.headers;
  const raw = headers?.["retry-after"] ?? headers?.["Retry-After"];
  if (!raw) return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
};

const RPC_RETRY_BASE_DELAY_MS = 250;
const RPC_RETRY_MAX_DELAY_MS = 4_000;

/**
 * Full-jitter exponential backoff. The jitter matters: a balance refresh fires
 * several reads at once, and retrying them in lockstep just reproduces the burst
 * that triggered the rate limit.
 */
const backoffDelayMs = (attempt: number): number => {
  const ceiling = Math.min(RPC_RETRY_BASE_DELAY_MS * 2 ** attempt, RPC_RETRY_MAX_DELAY_MS);
  return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
};

/** Test hook: drops memoized providers and endpoint cooldowns. */
export const resetRpcProviderState = (): void => {
  providerCache.clear();
  rpcCooldownUntil.clear();
};

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
  // Health-based reordering lives in orderRpcUrlsByHealth so this stays a pure
  // view of configuration.
  return !override ? base : [...new Set([override, ...base])];
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
  // No per-URL retry here: the caller already backs off between polling rounds.
  const urls = orderRpcUrlsByHealth(resolveRpcUrlsForChain(chainId));
  let lastError: unknown;
  let sawNotFound = false;

  for (const url of urls) {
    const provider = createProvider(url, chainId);
    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      markRpcHealthy(url);
      if (receipt) return receipt;
      sawNotFound = true;
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
      markRpcUnhealthy(url, readRetryAfterMs(error));
      logger.warn(`[rpc] ${url} getTransactionReceipt failed for chain ${chainId}, trying fallback`);
    }
  }

  if (sawNotFound) return null;
  throw lastError instanceof Error
    ? lastError
    : new Error(`All RPC endpoints failed reading receipt for ${txHash} on chain ${chainId}`);
}

/**
 * Picks the first RPC endpoint that answers a live request.
 *
 * The probe is `getBlockNumber()` rather than `getNetwork()`: providers are now
 * built with `staticNetwork`, so `getNetwork()` resolves from config without
 * touching the network and would report every endpoint as healthy.
 *
 * Prefer {@link withRpcFallback} where possible — it fails over per request,
 * whereas the provider returned here is pinned to whichever endpoint answered.
 */
export const createResilientJsonRpcProvider = async (
  chainId: number,
): Promise<ethers.JsonRpcProvider> => {
  const urls = orderRpcUrlsByHealth(resolveRpcUrlsForChain(chainId));
  let lastError: unknown;
  for (const url of urls) {
    const provider = createJsonRpcProvider(url, chainId);
    try {
      await provider.getBlockNumber();
      markRpcHealthy(url);
      return provider;
    } catch (error) {
      lastError = error;
      if (!isTransientRpcError(error)) throw error;
      markRpcUnhealthy(url, readRetryAfterMs(error));
      logger.warn(`[rpc] ${url} unavailable for chain ${chainId}, trying fallback`);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`No RPC available for chain ${chainId}`);
};

export type RpcFallbackOptions = {
  /** Extra attempts against the same endpoint before rotating. Default 1. */
  retriesPerUrl?: number;
  /** Optional provider factory (tests / custom RPC clients). */
  createProvider?: (url: string, chainId: number) => ethers.JsonRpcProvider;
};

/**
 * Runs `fn` against each configured RPC until one succeeds or all fail.
 *
 * Transient failures retry on the same endpoint with jittered backoff (honoring
 * `Retry-After` when present) before rotating, since a rate limit is usually a
 * momentary burst rather than a dead node. Endpoints that rate-limit are parked
 * so the next call starts on a healthy one. Non-transient errors — reverts, bad
 * params — rethrow immediately rather than being retried against every endpoint.
 */
export const withRpcFallback = async <T>(
  chainId: number,
  fn: (provider: ethers.JsonRpcProvider) => Promise<T>,
  options: RpcFallbackOptions = {},
): Promise<T> => {
  const { retriesPerUrl = 1, createProvider = createJsonRpcProvider } = options;
  const urls = orderRpcUrlsByHealth(resolveRpcUrlsForChain(chainId));
  let lastError: unknown;
  let sawRateLimit = false;

  for (const url of urls) {
    for (let attempt = 0; attempt <= retriesPerUrl; attempt++) {
      try {
        const result = await fn(createProvider(url, chainId));
        markRpcHealthy(url);
        // Report only after the full cycle, when an earlier endpoint was rate-limited.
        if (chainId === AVALANCHE_FUJI_CHAIN_ID && sawRateLimit) {
          reportPluginError(createRpcRateLimitedError("Avalanche Fuji"));
        }
        return result;
      } catch (error) {
        lastError = error;
        if (isRateLimitedRpcError(error)) sawRateLimit = true;
        if (!isTransientRpcError(error)) throw error;

        // Parks this specific endpoint, which is more precise than demoting
        // whichever URL happens to be configured as the primary.
        const retryAfterMs = readRetryAfterMs(error);
        markRpcUnhealthy(url, retryAfterMs);

        if (attempt < retriesPerUrl) {
          await sleep(retryAfterMs ?? backoffDelayMs(attempt));
          continue;
        }
        logger.warn(`[rpc] ${url} request failed for chain ${chainId}, trying fallback`);
      }
    }
  }

  // Fuji: surface rate-limit UI only when a rate-limit was actually observed
  // (not for unrelated transient failures like plain timeouts).
  if (chainId === AVALANCHE_FUJI_CHAIN_ID && (sawRateLimit || isRateLimitedRpcError(lastError))) {
    markFujiPrimaryRateLimited();
    const rateLimited = createRpcRateLimitedError("Avalanche Fuji");
    reportPluginError(rateLimited);
    throw rateLimited;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`All RPC endpoints failed for chain ${chainId}`);
};
