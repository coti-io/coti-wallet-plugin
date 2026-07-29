/**
 * MetaMask Mobile in-app browser helpers.
 *
 * MetaMask Mobile's JSON-RPC relay has a known coalescer bug: concurrent
 * read-only or wallet RPC calls can overflow the call stack ("could not
 * coalesce error / Maximum call stack size exceeded"). ethers/coti-ethers can
 * fire many parallel probes during `generateOrRecoverAes()`.
 */

import { logger } from './logger';
import { getPluginConfig } from '../config/plugin';
import { getEthereumProvider, getMetaMaskProvider, type EIP1193Provider } from './ethereum';
import type { WalletType } from '../hooks/useWalletType';

type RequestFn = (args: { method: string; params?: unknown[] }) => Promise<unknown>;
type WalletProviderLike = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
};

/** Read-only RPC methods that must be serialized on MetaMask Mobile. */
export const MOBILE_READ_ONLY_RPC_METHODS = new Set([
  'eth_chainId',
  'eth_accounts',
  'eth_getBalance',
  'eth_call',
  'eth_blockNumber',
  'eth_gasPrice',
  'eth_getTransactionCount',
  'eth_getCode',
  'eth_getStorageAt',
]);

/** Wallet-interactive RPC methods that must hit MetaMask one at a time. */
export const MOBILE_WALLET_RPC_METHODS = new Set([
  'personal_sign',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
  'eth_sendTransaction',
  'wallet_switchEthereumChain',
  'wallet_addEthereumChain',
]);

/** MetaMask universal-link prefix that opens a dApp in the in-app browser. */
export const METAMASK_DAPP_DEEPLINK_BASE = 'https://link.metamask.io/dapp/';

/**
 * Deep link that reopens the current page inside MetaMask Mobile's in-app
 * browser, where `window.ethereum` is injected and Snaps are available
 * (WalletConnect sessions cannot call `wallet_invokeSnap`).
 *
 * The URL is taken from `window.location` minus the protocol, so a page served
 * from `https://dev.privacyportal.app/` yields
 * `https://link.metamask.io/dapp/dev.privacyportal.app/`.
 */
export function getMetaMaskDappDeepLink(): string {
  if (typeof window === 'undefined') return METAMASK_DAPP_DEEPLINK_BASE;
  const { host, pathname, search, hash } = window.location;
  return `${METAMASK_DAPP_DEEPLINK_BASE}${host}${pathname}${search}${hash}`;
}

/**
 * Detect MetaMask Mobile's embedded dApp browser.
 *
 * This answers "which browser am I in?", never "which wallet is connected?".
 * Gate the relay workarounds in this module on
 * {@link shouldUseMetaMaskMobileRelay} instead.
 */
export function isMetaMaskMobileBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/MetaMaskMobile/i.test(ua)) return true;
  // Mobile WebView with injected MetaMask provider (no desktop extension).
  if (/android|iphone|ipod|ipad/i.test(ua) && typeof window !== 'undefined') {
    const eth = (window as Window & { ethereum?: { isMetaMask?: boolean } }).ethereum;
    if (eth?.isMetaMask) return true;
  }
  return false;
}

/**
 * True when this module's MetaMask Mobile relay workarounds apply: the page runs
 * in a MetaMask Mobile webview AND the connected wallet is actually MetaMask.
 *
 * Both halves are required. `isMetaMaskMobileBrowser()` alone keys off the
 * mobile UA plus `window.ethereum.isMetaMask` — a flag Zerion, Rabby and Phantom
 * also set for compatibility — and it stays true when the user connects a
 * non-MetaMask wallet over WalletConnect from inside MetaMask Mobile's browser.
 * Applying the workarounds in either case, above all swapping the connector
 * provider for inpage `window.ethereum`, points signing at a provider that never
 * authorized the account: every wallet RPC then fails with EIP-1193 code 4100
 * ("The requested account and/or method has not been authorized by the user").
 */
export function shouldUseMetaMaskMobileRelay(walletType: WalletType | undefined): boolean {
  return walletType === 'metamask' && isMetaMaskMobileBrowser();
}

/**
 * On MetaMask Mobile in-app browser, wagmi's MetaMask connector can return the
 * SDK relay provider. `personal_sign` through that relay hangs without opening
 * the native sign sheet, so wallet-interactive onboarding must use inpage
 * `window.ethereum`.
 *
 * `walletType` is required: the inpage substitution is only correct when the
 * connected wallet IS MetaMask. For every other wallet the connector's own
 * provider holds the authorized session and must be returned untouched.
 */
export function resolveMetaMaskMobileWalletProvider(
  connectorProvider: WalletProviderLike | null | undefined,
  walletType: WalletType | undefined,
): WalletProviderLike {
  if (shouldUseMetaMaskMobileRelay(walletType)) {
    const native = getMetaMaskProvider() ?? getEthereumProvider();
    if (native) {
      return native as EIP1193Provider;
    }
  }
  if (!connectorProvider) {
    throw new Error('Could not get provider from wallet connector.');
  }
  return connectorProvider;
}

/** Delay before the first `eth_accounts` probe on MetaMask Mobile (ms). */
export function getMetaMaskMobileEthAccountsDelayMs(): number {
  return isMetaMaskMobileBrowser() ? 500 : 0;
}

const MOBILE_RPC_CACHE_MS = 30_000;
const mobileReadOnlyCache = new Map<string, { value: unknown; at: number }>();
const mobileReadOnlyInflight = new Map<string, Promise<unknown>>();
const mobileWalletInflight = new Map<string, Promise<unknown>>();
let mobileReadOnlyMutex: Promise<void> = Promise.resolve();
let mobileWalletMutex: Promise<void> = Promise.resolve();

function mobileReadOnlyCacheKey(method: string, params: unknown[]): string {
  return `${method}:${JSON.stringify(params)}`;
}

function mobileWalletCacheKey(method: string, params: unknown[]): string {
  return `${method}:${JSON.stringify(params)}`;
}

/** Clears cached/in-flight mobile RPC state. Call after chain changes. */
export function clearMetaMaskMobileRpcCache(): void {
  mobileReadOnlyCache.clear();
  mobileReadOnlyInflight.clear();
  mobileWalletInflight.clear();
  mobileReadOnlyMutex = Promise.resolve();
  mobileWalletMutex = Promise.resolve();
}

/**
 * Global mutex + cache for read-only RPC on MetaMask Mobile. Identical
 * in-flight calls share one promise; different calls queue behind one mutex.
 */
export async function guardedMobileReadOnlyRpc(
  provider: { request: RequestFn },
  method: string,
  params: unknown[] = [],
): Promise<unknown> {
  if (!isMetaMaskMobileBrowser()) {
    return provider.request({ method, params });
  }

  const cacheKey = mobileReadOnlyCacheKey(method, params);
  const now = Date.now();
  const cached = mobileReadOnlyCache.get(cacheKey);
  if (cached && now - cached.at < MOBILE_RPC_CACHE_MS) {
    return cached.value;
  }

  const inflight = mobileReadOnlyInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const prev = mobileReadOnlyMutex;
    let release!: () => void;
    mobileReadOnlyMutex = new Promise<void>((resolve) => {
      release = resolve;
    });

    await prev;

    try {
      const cachedAfterWait = mobileReadOnlyCache.get(cacheKey);
      if (cachedAfterWait && Date.now() - cachedAfterWait.at < MOBILE_RPC_CACHE_MS) {
        return cachedAfterWait.value;
      }

      const value = await provider.request({ method, params });
      mobileReadOnlyCache.set(cacheKey, { value, at: Date.now() });
      return value;
    } finally {
      mobileReadOnlyInflight.delete(cacheKey);
      release();
    }
  })();

  mobileReadOnlyInflight.set(cacheKey, promise);
  return promise;
}

/**
 * Serialize wallet-interactive RPC on MetaMask Mobile (`personal_sign`, txs,
 * chain switching). Identical in-flight calls share one promise; other calls
 * queue behind one global mutex.
 */
export async function guardedMobileWalletRpc(
  provider: { request: RequestFn },
  method: string,
  params: unknown[] = [],
): Promise<unknown> {
  if (!isMetaMaskMobileBrowser()) {
    return provider.request({ method, params });
  }

  const cacheKey = mobileWalletCacheKey(method, params);
  const inflight = mobileWalletInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = (async () => {
    const prev = mobileWalletMutex;
    let release!: () => void;
    mobileWalletMutex = new Promise<void>((resolve) => {
      release = resolve;
    });

    await prev;

    try {
      if (getPluginConfig().debug === true) {
        logger.log(`[Onboarding:wallet-send] ${method}`);
      }
      return await provider.request({ method, params });
    } finally {
      mobileWalletInflight.delete(cacheKey);
      release();
    }
  })();

  mobileWalletInflight.set(cacheKey, promise);
  return promise;
}

/** @see guardedMobileReadOnlyRpc */
export async function guardedEthChainId(provider: { request: RequestFn }): Promise<string> {
  return (await guardedMobileReadOnlyRpc(provider, 'eth_chainId', [])) as string;
}

/** @see guardedMobileReadOnlyRpc */
export async function guardedEthGetBalance(
  provider: { request: RequestFn },
  params: unknown[] = [],
): Promise<string> {
  return (await guardedMobileReadOnlyRpc(provider, 'eth_getBalance', params)) as string;
}

/** @see guardedMobileReadOnlyRpc */
export async function guardedEthAccounts(
  provider: { request: RequestFn },
): Promise<string[]> {
  return (await guardedMobileReadOnlyRpc(provider, 'eth_accounts', [])) as string[];
}

/** JSON-RPC over HTTP, used for read-only calls during mobile onboarding. */
export async function mobileHttpJsonRpc(
  rpcUrl: string,
  method: string,
  params: unknown[] = [],
): Promise<unknown> {
  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const json = (await response.json()) as {
    result?: unknown;
    error?: { message?: string; code?: number };
  };
  if (json.error) {
    throw Object.assign(new Error(json.error.message ?? 'RPC error'), { code: json.error.code });
  }
  return json.result;
}

export interface OnboardingDebugEntry {
  ts: number;
  tag: string;
  detail?: string;
}

/** Collects timestamped onboarding events for MetaMask Mobile diagnostics. */
export class OnboardingDebugTrace {
  private entries: OnboardingDebugEntry[] = [];

  push(tag: string, detail?: string): void {
    const entry: OnboardingDebugEntry = { ts: Date.now(), tag, detail };
    this.entries.push(entry);
    if (getPluginConfig().debug === true) {
      logger.log(`[Onboarding:${tag}]${detail ? ` ${detail}` : ''}`);
    }
  }

  clear(): void {
    this.entries = [];
  }

  toLines(): string[] {
    const t0 = this.entries[0]?.ts ?? Date.now();
    return this.entries.map((e) => {
      const offsetMs = e.ts - t0;
      const detail = e.detail ? ` — ${e.detail}` : '';
      return `+${offsetMs}ms ${e.tag}${detail}`;
    });
  }

  getEntries(): readonly OnboardingDebugEntry[] {
    return this.entries;
  }
}

/** Maps MetaMask Mobile coalescer failures to a user-friendly message. */
export function formatOnboardingError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const payloadMethod =
    error && typeof error === 'object' && 'payload' in error
      ? (error as { payload?: { method?: string } }).payload?.method
      : undefined;

  if (
    message.includes('Maximum call stack size exceeded')
    || message.includes('maximum call stack exceeded')
    || message.includes('could not coalesce')
    || payloadMethod === 'eth_accounts'
    || payloadMethod === 'eth_chainId'
    || payloadMethod === 'eth_getBalance'
    || payloadMethod === 'eth_call'
    || payloadMethod === 'personal_sign'
    || payloadMethod === 'eth_sendTransaction'
  ) {
    return [
      'MetaMask Mobile provider error (wallet RPC conflict).',
      'Wait a moment and tap Retry, or refresh the page once and try again.',
      'Enable plugin debug logging (configureCotiPlugin({ debug: true })) for a step-by-step trace.',
    ].join(' ');
  }

  const trimmed = message.trim();
  return trimmed || 'Onboarding failed. Try again or refresh the page.';
}
