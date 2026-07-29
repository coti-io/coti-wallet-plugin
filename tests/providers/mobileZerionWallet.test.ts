import { describe, it, expect, vi } from 'vitest';
import { wrapZerionProvider } from '../../src/providers/mobileZerionWallet';

type Eip1193RequestArgs = { method: string; params?: unknown };

/**
 * Mirrors `instrumentWalletProvider` in useAesKeyProvider: bind the current
 * `request`, then assign a wrapper that calls that bound function. The Zerion
 * provider wrap must compose with this pattern without recursing.
 */
function instrumentLikeOnboarding(walletProvider: {
  request: (args: Eip1193RequestArgs) => Promise<unknown>;
}) {
  const originalRequest = walletProvider.request.bind(walletProvider);
  walletProvider.request = async function instrumentedRequest(args: Eip1193RequestArgs) {
    return originalRequest(args);
  };
  return () => {
    walletProvider.request = originalRequest;
  };
}

describe('wrapZerionProvider', () => {
  it('swallows wallet_revokePermissions unsupported-method errors', async () => {
    const rawRequest = vi.fn(async ({ method }: Eip1193RequestArgs) => {
      if (method === 'wallet_revokePermissions') {
        throw { code: -32601, message: 'the method wallet_revokePermissions does not exist/is not available' };
      }
      return `ok:${method}`;
    });
    const provider = { request: rawRequest };

    const wrapped = wrapZerionProvider(provider);
    await expect(wrapped.request({ method: 'wallet_revokePermissions' })).resolves.toBeNull();
    await expect(wrapped.request({ method: 'eth_chainId' })).resolves.toBe('ok:eth_chainId');
    expect(rawRequest).toHaveBeenCalledWith({ method: 'eth_chainId' });
  });

  it('composes with onboarding request instrumentation without recursing', async () => {
    const rawRequest = vi.fn(async ({ method }: Eip1193RequestArgs) => `REAL:${method}`);
    const provider = { request: rawRequest };

    const wrapped = wrapZerionProvider(provider);
    instrumentLikeOnboarding(wrapped);

    await expect(wrapped.request({ method: 'eth_chainId' })).resolves.toBe('REAL:eth_chainId');
    expect(rawRequest).toHaveBeenCalledWith({ method: 'eth_chainId' });
  });

  it('is idempotent', () => {
    const provider = {
      request: async () => '0x1',
    };
    const first = wrapZerionProvider(provider);
    const second = wrapZerionProvider(provider);
    expect(first).toBe(provider);
    expect(second).toBe(first);
  });
});
