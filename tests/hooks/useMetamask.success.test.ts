import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMetamask } from '../../src/hooks/useMetamask';
import { muteChainUpdates, unmuteChainUpdates } from '../../src/lib/chainMute';

const h = vi.hoisted(() => ({
  getNetwork: vi.fn(),
}));

vi.mock('ethers', () => {
  class BrowserProvider {
    constructor(_provider: unknown) {}
    getNetwork = h.getNetwork;
  }
  return { ethers: { BrowserProvider } };
});

describe('useMetamask (success & lifecycle paths)', () => {
  let mockRequest: ReturnType<typeof vi.fn>;
  let mockOn: ReturnType<typeof vi.fn>;
  let mockRemoveListener: ReturnType<typeof vi.fn>;
  const reloadSpy = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    unmuteChainUpdates();
    mockRequest = vi.fn().mockResolvedValue([]);
    mockOn = vi.fn();
    mockRemoveListener = vi.fn();
    (window as any).ethereum = {
      request: mockRequest,
      on: mockOn,
      removeListener: mockRemoveListener,
      isMetaMask: true,
    };
    Object.defineProperty(window, 'location', {
      value: { reload: reloadSpy },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    unmuteChainUpdates();
  });

  describe('checkNetwork', () => {
    it.each([
      [2632500n, 'COTI Mainnet', '2632500'],
      [7082400n, 'COTI Testnet', '7082400'],
      [11155111n, 'Sepolia', '11155111'],
      [1n, 'Wrong Network', '1'],
    ])('maps chainId %s to "%s"', async (chainId, expectedName, expectedId) => {
      h.getNetwork.mockResolvedValue({ chainId });
      const { result } = renderHook(() => useMetamask());

      await act(async () => {
        const { ethers } = await import('ethers');
        await result.current.checkNetwork(new ethers.BrowserProvider(window.ethereum));
      });

      expect(result.current.networkName).toBe(expectedName);
      expect(result.current.chainId).toBe(expectedId);
    });
  });

  describe('connectWallet', () => {
    it('calls onConnect with the first account on success', async () => {
      mockRequest.mockImplementation((args: { method: string }) => {
        if (args.method === 'eth_accounts') return Promise.resolve([]);
        if (args.method === 'wallet_requestPermissions') return Promise.resolve(undefined);
        if (args.method === 'eth_requestAccounts') return Promise.resolve(['0xabc123']);
        return Promise.resolve(undefined);
      });
      h.getNetwork.mockResolvedValue({ chainId: 7082400n });

      const onConnect = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useMetamask());

      await act(async () => {
        await result.current.connectWallet(onConnect);
      });

      expect(onConnect).toHaveBeenCalledWith('0xabc123');
    });

    it('swallows provider errors without rethrowing', async () => {
      mockRequest.mockRejectedValue(new Error('user rejected'));
      const onConnect = vi.fn();
      const { result } = renderHook(() => useMetamask());

      await act(async () => {
        await expect(result.current.connectWallet(onConnect)).resolves.toBeUndefined();
      });
      expect(onConnect).not.toHaveBeenCalled();
    });
  });

  describe('refreshNetworkState', () => {
    it('updates network name and invokes onNetworkChanged', async () => {
      h.getNetwork.mockResolvedValue({ chainId: 2632500n });
      const onNetworkChanged = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useMetamask({ onNetworkChanged }));

      await act(async () => {
        await result.current.refreshNetworkState();
      });

      expect(result.current.networkName).toBe('COTI Mainnet');
      expect(onNetworkChanged).toHaveBeenCalled();
    });

    it('no-ops when window.ethereum is missing', async () => {
      delete (window as any).ethereum;
      const onNetworkChanged = vi.fn();
      const { result } = renderHook(() => useMetamask({ onNetworkChanged }));

      await act(async () => {
        await result.current.refreshNetworkState();
      });

      expect(onNetworkChanged).not.toHaveBeenCalled();
    });

    it('swallows errors from checkNetwork without rethrowing', async () => {
      h.getNetwork.mockRejectedValue(new Error('network error'));
      const { result } = renderHook(() => useMetamask());

      await act(async () => {
        await result.current.refreshNetworkState();
      });
      // stays at initial state
      expect(result.current.networkName).toBe('Unknown Network');
    });
  });

  describe('switchNetwork callbacks', () => {
    it('invokes onNetworkChanged after a successful switch', async () => {
      mockRequest.mockResolvedValue(undefined);
      const onNetworkChanged = vi.fn().mockResolvedValue(undefined);
      const { result } = renderHook(() => useMetamask({ onNetworkChanged }));

      const ok = await result.current.switchNetwork('0x6c11a0');
      expect(ok).toBe(true);
      expect(onNetworkChanged).toHaveBeenCalled();
    });

    it('returns false when wallet_addEthereumChain fails (4902 path)', async () => {
      mockRequest
        .mockRejectedValueOnce({ code: 4902 })
        .mockRejectedValueOnce(new Error('add failed'));
      const { result } = renderHook(() => useMetamask());

      const ok = await result.current.switchNetwork('0x6c11a0');
      expect(ok).toBe(false);
    });

    it('succeeds when retry switch fails after add (already switched)', async () => {
      mockRequest
        .mockRejectedValueOnce({ code: 4902 })
        .mockResolvedValueOnce(undefined) // add
        .mockRejectedValueOnce(new Error('already switched')); // retry switch
      const onNetworkChanged = vi.fn();
      const { result } = renderHook(() => useMetamask({ onNetworkChanged }));

      const ok = await result.current.switchNetwork('0x6c11a0');
      expect(ok).toBe(true);
      expect(onNetworkChanged).toHaveBeenCalled();
    });
  });

  describe('event listeners & cleanup', () => {
    function getHandler(event: string) {
      const call = mockOn.mock.calls.find((c) => c[0] === event);
      return call?.[1] as (...args: unknown[]) => void;
    }

    it('reloads the page on chainChanged when updates are not muted', () => {
      renderHook(() => useMetamask());
      getHandler('chainChanged')();
      expect(reloadSpy).toHaveBeenCalled();
    });

    it('ignores chainChanged when chain updates are muted', () => {
      muteChainUpdates();
      renderHook(() => useMetamask());
      getHandler('chainChanged')();
      expect(reloadSpy).not.toHaveBeenCalled();
    });

    it('removes listeners on unmount (no memory leak)', () => {
      const { unmount } = renderHook(() => useMetamask());
      const accountsHandler = getHandler('accountsChanged');
      const chainHandler = getHandler('chainChanged');

      unmount();

      expect(mockRemoveListener).toHaveBeenCalledWith('accountsChanged', accountsHandler);
      expect(mockRemoveListener).toHaveBeenCalledWith('chainChanged', chainHandler);
    });

    it('calls onSnapCheck on initial eth_accounts when already connected', async () => {
      mockRequest.mockResolvedValue(['0xsnapcheck']);
      const onSnapCheck = vi.fn();
      const onAccountChanged = vi.fn();

      renderHook(() => useMetamask({ onSnapCheck, onAccountChanged }));

      await waitFor(() => {
        expect(onSnapCheck).toHaveBeenCalledWith('0xsnapcheck');
        expect(onAccountChanged).toHaveBeenCalledWith('0xsnapcheck');
      });
    });

    it('re-runs setup when ethereum#initialized fires', async () => {
      renderHook(() => useMetamask());
      const callsBefore = mockOn.mock.calls.length;

      await act(async () => {
        window.dispatchEvent(new Event('ethereum#initialized'));
      });

      expect(mockOn.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    it('registerEthereumInitializedListener attaches a one-time handler', async () => {
      const { result } = renderHook(() => useMetamask());
      const cb = vi.fn();
      result.current.registerEthereumInitializedListener(cb);

      await act(async () => {
        window.dispatchEvent(new Event('ethereum#initialized'));
      });

      expect(cb).toHaveBeenCalledTimes(1);
    });
  });
});
