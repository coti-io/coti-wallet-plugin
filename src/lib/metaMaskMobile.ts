/**
 * MetaMask Mobile in-app browser helpers.
 *
 * MetaMask Mobile's JSON-RPC relay has a known coalescer bug: concurrent
 * `eth_accounts` calls on first page load can overflow the call stack
 * ("could not coalesce error / Maximum call stack size exceeded").
 */

import { logger } from './logger';
import { getPluginConfig } from '../config/plugin';

/** Detect MetaMask Mobile's embedded dApp browser. */
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

/** Delay before the first `eth_accounts` probe on MetaMask Mobile (ms). */
export function getMetaMaskMobileEthAccountsDelayMs(): number {
  return isMetaMaskMobileBrowser() ? 500 : 0;
}

let inflightEthAccounts: Promise<string[]> | null = null;

/**
 * Serialize concurrent `eth_accounts` calls on MetaMask Mobile to avoid the
 * provider coalescer stack overflow.
 */
export async function guardedEthAccounts(
  provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> },
): Promise<string[]> {
  if (!isMetaMaskMobileBrowser()) {
    return (await provider.request({ method: 'eth_accounts', params: [] })) as string[];
  }
  if (inflightEthAccounts) {
    return inflightEthAccounts;
  }
  inflightEthAccounts = (provider.request({ method: 'eth_accounts', params: [] }) as Promise<string[]>)
    .finally(() => {
      inflightEthAccounts = null;
    });
  return inflightEthAccounts;
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
    || message.includes('could not coalesce')
    || payloadMethod === 'eth_accounts'
  ) {
    return [
      'MetaMask Mobile provider error (eth_accounts conflict).',
      'Wait a moment and tap Retry, or refresh the page once and try again.',
      'Enable plugin debug logging (configureCotiPlugin({ debug: true })) for a step-by-step trace.',
    ].join(' ');
  }

  return message;
}
