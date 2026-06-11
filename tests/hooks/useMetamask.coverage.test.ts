import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useMetamask } from '../../src/hooks/useMetamask';
import { unmuteChainUpdates } from '../../src/lib/chainMute';

const h = vi.hoisted(() => ({ getNetwork: vi.fn() }));

vi.mock('ethers', () => {
  class BrowserProvider {
    constructor(_provider: unknown) {}
    getNetwork = h.getNetwork;
  }
  return { ethers: { BrowserProvider } };
});

describe('useMetamask (4902 add-network & listener branch coverage)', () => {
  let mockRequest: ReturnType<typeof vi.fn>;
  let mockOn: ReturnType<typeof vi.fn>;
  let mockRemoveListener: ReturnType<typeof vi.fn>;

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
  });

  afterEach(() => {
    unmuteChainUpdates();
  });

  function getHandler(event: string) {
    const call = mockOn.mock.calls.find((c) => c[0] === event);
    return call?.[1] as (...args: unknown[]) => void;
  }

  // ─── switchNetwork: 4902 "chain not added" path ─────────────────────────

  /**
   * Routes window.ethereum.request by method. The mount-time `eth_accounts`
   * call is always answered with []; the first `wallet_switchEthereumChain`
   * rejects with 4902, and add/retry behaviour is configurable.
   */
  function routeRequest(opts: {
    addRejects?: boolean;
    retryRejects?: boolean;
  }) {
    let switchCalls = 0;
    mockRequest.mockImplementation(({ method }: { method: string }) => {
      if (method === 'eth_accounts') return Promise.resolve([]);
      if (method === 'wallet_switchEthereumChain') {
        switchCalls += 1;
        if (switchCalls === 1) return Promise.reject({ code: 4902 });
        return opts.retryRejects
          ? Promise.reject(new Error('already switched'))
          : Promise.resolve(undefined);
      }
      if (method === 'wallet_addEthereumChain') {
        return opts.addRejects
          ? Promise.reject(new Error('add failed'))
          : Promise.resolve(undefined);
      }
      return Promise.resolve(undefined);
    });
  }

  it('adds the network and retries the switch (4902 → add → retry → onNetworkChanged)', async () => {
    routeRequest({});
    const onNetworkChanged = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useMetamask({ onNetworkChanged }));

    const ok = await result.current.switchNetwork('0x6c11a0');
    expect(ok).toBe(true);
    expect(onNetworkChanged).toHaveBeenCalled();
    expect(mockRequest).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'wallet_addEthereumChain' }),
    );
  });

  it('treats a failed retry switch as success (network added during add)', async () => {
    routeRequest({ retryRejects: true });
    const onNetworkChanged = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useMetamask({ onNetworkChanged }));

    const ok = await result.current.switchNetwork('0x6c11a0');
    expect(ok).toBe(true);
    expect(onNetworkChanged).toHaveBeenCalled();
  });

  it('adds the network without an onNetworkChanged callback', async () => {
    routeRequest({});
    const { result } = renderHook(() => useMetamask());

    const ok = await result.current.switchNetwork('0x6c11a0');
    expect(ok).toBe(true);
  });

  it('returns false when wallet_addEthereumChain rejects', async () => {
    routeRequest({ addRejects: true });
    const { result } = renderHook(() => useMetamask());

    const ok = await result.current.switchNetwork('0x6c11a0');
    expect(ok).toBe(false);
  });

  // ─── refreshNetworkState without onNetworkChanged ───────────────────────

  it('refreshNetworkState updates state without an onNetworkChanged callback', async () => {
    h.getNetwork.mockResolvedValue({ chainId: 7082400n });
    const { result } = renderHook(() => useMetamask());

    await act(async () => {
      await result.current.refreshNetworkState();
    });
    expect(result.current.networkName).toBe('COTI Testnet');
  });

  // ─── accountsChanged handler branches ───────────────────────────────────

  it('handleAccountsChanged invokes onAccountChanged for a non-empty account list', () => {
    const onAccountChanged = vi.fn();
    renderHook(() => useMetamask({ onAccountChanged }));
    getHandler('accountsChanged')(['0xnew']);
    expect(onAccountChanged).toHaveBeenCalledWith('0xnew');
  });

  it('handleAccountsChanged tolerates a non-empty list without an onAccountChanged callback', () => {
    renderHook(() => useMetamask());
    expect(() => getHandler('accountsChanged')(['0xnew'])).not.toThrow();
  });

  it('handleAccountsChanged invokes onDisconnect for an empty account list', () => {
    const onDisconnect = vi.fn();
    renderHook(() => useMetamask({ onDisconnect }));
    getHandler('accountsChanged')([]);
    expect(onDisconnect).toHaveBeenCalled();
  });

  it('handleAccountsChanged tolerates an empty list without an onDisconnect callback', () => {
    renderHook(() => useMetamask());
    expect(() => getHandler('accountsChanged')([])).not.toThrow();
  });

  // ─── initial eth_accounts check branches ────────────────────────────────

  it('initial eth_accounts check runs onSnapCheck without an onAccountChanged callback', async () => {
    mockRequest.mockResolvedValue(['0xinitial']);
    const onSnapCheck = vi.fn();
    renderHook(() => useMetamask({ onSnapCheck }));

    await waitFor(() => expect(onSnapCheck).toHaveBeenCalledWith('0xinitial'));
  });

  it('initial eth_accounts check logs the no-accounts branch', async () => {
    mockRequest.mockResolvedValue([]);
    const onAccountChanged = vi.fn();
    renderHook(() => useMetamask({ onAccountChanged }));

    // Give the mount-time promise a tick to resolve; no account → no callback.
    await act(async () => { await Promise.resolve(); });
    expect(onAccountChanged).not.toHaveBeenCalled();
  });

  it('initial eth_accounts check swallows a rejected eth_accounts call', async () => {
    mockRequest.mockRejectedValue(new Error('eth_accounts failed'));
    const onAccountChanged = vi.fn();
    renderHook(() => useMetamask({ onAccountChanged }));

    await act(async () => { await Promise.resolve(); });
    expect(onAccountChanged).not.toHaveBeenCalled();
  });
});
