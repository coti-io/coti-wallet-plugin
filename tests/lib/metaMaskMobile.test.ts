import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  formatOnboardingError,
  getMetaMaskMobileEthAccountsDelayMs,
  guardedEthAccounts,
  isMetaMaskMobileBrowser,
  OnboardingDebugTrace,
} from '../../src/lib/metaMaskMobile';

describe('metaMaskMobile', () => {
  const originalUA = navigator.userAgent;

  afterEach(() => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: originalUA,
    });
    vi.unstubAllGlobals();
  });

  it('detects MetaMask Mobile from user agent', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 MetaMaskMobile',
    });
    expect(isMetaMaskMobileBrowser()).toBe(true);
    expect(getMetaMaskMobileEthAccountsDelayMs()).toBe(500);
  });

  it('returns 0ms defer on desktop user agents', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'Mozilla/5.0 Macintosh Chrome/120.0',
    });
    expect(isMetaMaskMobileBrowser()).toBe(false);
    expect(getMetaMaskMobileEthAccountsDelayMs()).toBe(0);
  });

  it('serializes concurrent eth_accounts on MetaMask Mobile', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'MetaMaskMobile',
    });
    let resolveFirst!: (value: string[]) => void;
    const first = new Promise<string[]>((resolve) => {
      resolveFirst = resolve;
    });
    const request = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(['0xabc']);
    const provider = { request };

    const p1 = guardedEthAccounts(provider);
    const p2 = guardedEthAccounts(provider);
    expect(request).toHaveBeenCalledTimes(1);

    resolveFirst(['0xabc']);
    await expect(Promise.all([p1, p2])).resolves.toEqual([['0xabc'], ['0xabc']]);
  });

  it('formats coalescer stack overflow errors for users', () => {
    const message = formatOnboardingError(new Error('could not coalesce error Maximum call stack size exceeded'));
    expect(message).toContain('MetaMask Mobile provider error');
    expect(message).toContain('Retry');
  });

  it('collects onboarding debug trace lines', () => {
    const trace = new OnboardingDebugTrace();
    trace.push('start', 'wallet=metamask');
    trace.push('rpc', 'personal_sign');
    const lines = trace.toLines();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^\+0ms start — wallet=metamask$/);
    expect(lines[1]).toContain('personal_sign');
  });
});
