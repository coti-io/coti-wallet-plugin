import { describe, it, expect, afterEach } from 'vitest';
import { getEthereumProvider } from '../../src/lib/ethereum';

describe('getEthereumProvider — catch branch (broken window.ethereum)', () => {
  const originalEthereum = (window as any).ethereum;

  afterEach(() => {
    // Restore
    Object.defineProperty(window, 'ethereum', {
      value: originalEthereum,
      writable: true,
      configurable: true,
    });
  });

  it('returns null when accessing window.ethereum throws', () => {
    // Define a getter that throws (simulates broken property descriptor)
    Object.defineProperty(window, 'ethereum', {
      get() {
        throw new Error('Cannot redefine property: ethereum');
      },
      configurable: true,
    });

    const provider = getEthereumProvider();
    expect(provider).toBeNull();
  });
});
