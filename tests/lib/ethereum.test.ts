import { describe, it, expect, beforeEach } from 'vitest';
import { getEthereumProvider } from '../../src/lib/ethereum';

describe('Ethereum Provider (README: EIP-1193 Provider)', () => {
  beforeEach(() => {
    // Reset window.ethereum
    (window as any).ethereum = {
      request: async () => {},
      isMetaMask: true,
      on: () => {},
      removeListener: () => {},
    };
  });

  it('returns the provider when window.ethereum exists', () => {
    const provider = getEthereumProvider();
    expect(provider).not.toBeNull();
    expect(provider!.request).toBeDefined();
  });

  it('returns null when window.ethereum is undefined', () => {
    delete (window as any).ethereum;
    const provider = getEthereumProvider();
    expect(provider).toBeNull();
  });

  it('exposes isMetaMask property', () => {
    const provider = getEthereumProvider();
    expect(provider!.isMetaMask).toBe(true);
  });

  it('exposes on/removeListener methods', () => {
    const provider = getEthereumProvider();
    expect(provider!.on).toBeDefined();
    expect(provider!.removeListener).toBeDefined();
  });

  it('returns null when window.ethereum access throws', () => {
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      get() {
        throw new Error('extension conflict');
      },
    });
    expect(getEthereumProvider()).toBeNull();
    Object.defineProperty(window, 'ethereum', {
      configurable: true,
      writable: true,
      value: { request: async () => {}, isMetaMask: true, on: () => {}, removeListener: () => {} },
    });
  });
});
