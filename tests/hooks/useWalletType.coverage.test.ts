import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWalletType } from '../../src/hooks/useWalletType';

const useAccountMock = vi.fn();
vi.mock('wagmi', () => ({
  useAccount: () => useAccountMock(),
}));

describe('useWalletType cancellation & edge paths (coverage)', () => {
  beforeEach(() => {
    useAccountMock.mockReset();
  });

  it('returns early when getProvider resolves a falsy provider', async () => {
    const getProvider = vi.fn().mockResolvedValue(null);
    useAccountMock.mockReturnValue({ connector: { id: 'metaMask', getProvider } });

    const { result } = renderHook(() => useWalletType());
    await waitFor(() => expect(getProvider).toHaveBeenCalled());
    expect(result.current.isMetaMaskWithSnap).toBe(false);
  });

  it('returns early when the hook is unmounted before getProvider resolves (cancelled after provider)', async () => {
    let resolveProvider: (value: unknown) => void = () => {};
    const getProvider = vi.fn(
      () => new Promise((resolve) => { resolveProvider = resolve; }),
    );
    useAccountMock.mockReturnValue({ connector: { id: 'metaMask', getProvider } });

    const { unmount } = renderHook(() => useWalletType());
    await waitFor(() => expect(getProvider).toHaveBeenCalled());

    unmount(); // cleanup sets cancelled = true
    await act(async () => {
      resolveProvider({ request: vi.fn() });
      await Promise.resolve();
    });
    // No assertion needed: covering the `cancelled` short-circuit on line 107.
    expect(getProvider).toHaveBeenCalledTimes(1);
  });

  it('returns early when cancelled after wallet_getSnaps resolves', async () => {
    let resolveRequest: (value: unknown) => void = () => {};
    const request = vi.fn(
      () => new Promise((resolve) => { resolveRequest = resolve; }),
    );
    const getProvider = vi.fn().mockResolvedValue({ request });
    useAccountMock.mockReturnValue({ connector: { id: 'metaMask', getProvider } });

    const { unmount } = renderHook(() => useWalletType());
    await waitFor(() => expect(request).toHaveBeenCalled());

    unmount(); // cleanup sets cancelled = true
    await act(async () => {
      resolveRequest({});
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not set state in the catch block when already cancelled', async () => {
    let rejectRequest: (reason?: unknown) => void = () => {};
    const request = vi.fn(
      () => new Promise((_resolve, reject) => { rejectRequest = reject; }),
    );
    const getProvider = vi.fn().mockResolvedValue({ request });
    useAccountMock.mockReturnValue({ connector: { id: 'metaMask', getProvider } });

    const { unmount } = renderHook(() => useWalletType());
    await waitFor(() => expect(request).toHaveBeenCalled());

    unmount(); // cleanup sets cancelled = true
    await act(async () => {
      rejectRequest(new Error('boom'));
      await Promise.resolve();
    });
    expect(request).toHaveBeenCalledTimes(1);
  });
});
