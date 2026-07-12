import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  clearMetaMaskMobileRpcCache,
  formatOnboardingError,
  getMetaMaskMobileEthAccountsDelayMs,
  guardedEthAccounts,
  guardedEthChainId,
  guardedEthGetBalance,
  guardedMobileWalletRpc,
  isMetaMaskMobileBrowser,
  OnboardingDebugTrace,
  resolveMetaMaskMobileWalletProvider,
} from '../../src/lib/metaMaskMobile';

describe('metaMaskMobile', () => {
  const originalUA = navigator.userAgent;

  beforeEach(() => {
    clearMetaMaskMobileRpcCache();
  });

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
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    resolveFirst(['0xabc']);
    await expect(Promise.all([p1, p2])).resolves.toEqual([['0xabc'], ['0xabc']]);
  });

  it('dedupes and caches concurrent eth_getBalance on MetaMask Mobile', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'MetaMaskMobile',
    });
    let resolveFirst!: (value: string) => void;
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const params = ['0xabc', 'latest'];
    const request = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce('0x2');
    const provider = { request };

    const p1 = guardedEthGetBalance(provider, params);
    const p2 = guardedEthGetBalance(provider, params);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    resolveFirst('0x1');
    await expect(Promise.all([p1, p2])).resolves.toEqual(['0x1', '0x1']);
    await expect(guardedEthGetBalance(provider, params)).resolves.toBe('0x1');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('serializes different read-only RPC methods on MetaMask Mobile', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'MetaMaskMobile',
    });
    const order: string[] = [];
    const request = vi.fn(async (args: { method: string }) => {
      order.push(`start:${args.method}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`end:${args.method}`);
      return args.method === 'eth_chainId' ? '0x6c11a0' : '0x1';
    });
    const provider = { request };

    await Promise.all([
      guardedEthChainId(provider),
      guardedEthGetBalance(provider, ['0xabc', 'latest']),
    ]);

    expect(request).toHaveBeenCalledTimes(2);
    expect(order).toEqual([
      'start:eth_chainId',
      'end:eth_chainId',
      'start:eth_getBalance',
      'end:eth_getBalance',
    ]);
  });

  it('dedupes concurrent personal_sign on MetaMask Mobile', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'MetaMaskMobile',
    });
    let resolveFirst!: (value: string) => void;
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const params = ['0xdeadbeef', '0xabc'];
    const request = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce('0xsig');
    const provider = { request };

    const p1 = guardedMobileWalletRpc(provider, 'personal_sign', params);
    const p2 = guardedMobileWalletRpc(provider, 'personal_sign', params);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    resolveFirst('0xsig');
    await expect(Promise.all([p1, p2])).resolves.toEqual(['0xsig', '0xsig']);
  });

  it('dedupes and caches concurrent eth_chainId on MetaMask Mobile', async () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'MetaMaskMobile',
    });
    let resolveFirst!: (value: string) => void;
    const first = new Promise<string>((resolve) => {
      resolveFirst = resolve;
    });
    const request = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce('0x6c11a0');
    const provider = { request };

    const p1 = guardedEthChainId(provider);
    const p2 = guardedEthChainId(provider);
    await Promise.resolve();
    expect(request).toHaveBeenCalledTimes(1);

    resolveFirst('0x6c11a0');
    await expect(Promise.all([p1, p2])).resolves.toEqual(['0x6c11a0', '0x6c11a0']);
    await expect(guardedEthChainId(provider)).resolves.toBe('0x6c11a0');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('prefers native injected provider on MetaMask Mobile in-app browser', () => {
    Object.defineProperty(navigator, 'userAgent', {
      configurable: true,
      value: 'MetaMaskMobile',
    });
    const connectorProvider = { request: vi.fn() };
    const nativeProvider = { request: vi.fn(), isMetaMask: true };
    vi.stubGlobal('window', {
      ethereum: nativeProvider,
    });

    expect(resolveMetaMaskMobileWalletProvider(connectorProvider)).toBe(nativeProvider);
  });

  it('formats eth_chainId coalescer stack overflow errors for users', () => {
    const message = formatOnboardingError(
      Object.assign(new Error('could not coalesce error'), {
        payload: { method: 'eth_chainId' },
      }),
    );
    expect(message).toContain('MetaMask Mobile provider error');
    expect(message).toContain('Retry');
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
