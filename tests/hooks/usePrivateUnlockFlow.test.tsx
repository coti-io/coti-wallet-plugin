import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePrivateUnlockFlow } from '../../src/hooks/usePrivateUnlockFlow';

const mockRefreshPrivateBalances = vi.fn();
const mockLockPrivateBalances = vi.fn();
const mockUnlockCachedAesKey = vi.fn();
const mockHandleConnect = vi.fn();

vi.mock('../../src/context/privacyBridge/contexts', () => ({
  usePrivacyBridgeUnlock: () => ({
    isPrivateUnlocked: false,
    unlockCachedAesKey: mockUnlockCachedAesKey,
    sendPrivateToken: vi.fn(),
    refreshPrivateBalances: mockRefreshPrivateBalances,
    lockPrivateBalances: mockLockPrivateBalances,
    saveManualAesKey: vi.fn(),
    requestSnapConnection: vi.fn(),
    encryptPrivateValue: vi.fn(),
    decryptPrivateValue: vi.fn(),
  }),
  usePrivacyBridgeWallet: () => ({
    isConnected: true,
    walletAddress: '0x1234567890123456789012345678901234567890',
    handleConnect: mockHandleConnect,
  }),
}));

vi.mock('../../src/hooks/useWalletType', () => ({
  useWalletType: () => ({
    walletType: 'rabby',
    isMetaMaskWithSnap: false,
  }),
}));

vi.mock('../../src/components/OnboardModal', () => ({
  OnboardModal: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div data-testid="onboard-modal" /> : null,
}));

describe('usePrivateUnlockFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUnlockCachedAesKey.mockRejectedValue(new Error('No cached AES key'));
    mockRefreshPrivateBalances.mockResolvedValue(false);
  });

  it('opens onboarding modal when restoreOnly fails without cancellation', async () => {
    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    expect(mockRefreshPrivateBalances).toHaveBeenCalledWith({
      restoreOnly: true,
      onRestoreCancelled: expect.any(Function),
    });
    expect(result.current.showOnboardModal).toBe(true);
  });

  it('does not open modal when backup restore is cancelled', async () => {
    mockRefreshPrivateBalances.mockImplementation(async (options?: { onRestoreCancelled?: () => void }) => {
      options?.onRestoreCancelled?.();
      return false;
    });
    const onRestoreCancelled = vi.fn();

    const { result } = renderHook(() => usePrivateUnlockFlow({ onRestoreCancelled }));

    await act(async () => {
      await result.current.ensurePrivateUnlocked();
    });

    expect(onRestoreCancelled).toHaveBeenCalledTimes(1);
    expect(result.current.showOnboardModal).toBe(false);
  });

  it('does not reopen modal after dismiss cancels an in-flight unlock', async () => {
    mockRefreshPrivateBalances.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(false), 50)),
    );

    const { result } = renderHook(() => usePrivateUnlockFlow());

    let unlockPromise: Promise<boolean> | undefined;
    await act(async () => {
      unlockPromise = result.current.ensurePrivateUnlocked();
    });

    act(() => {
      result.current.resetUnlockUi();
    });

    await act(async () => {
      await unlockPromise;
    });

    expect(result.current.showOnboardModal).toBe(false);
  });

  it('runs pending action after successful restore', async () => {
    mockRefreshPrivateBalances.mockResolvedValueOnce(true);
    const pendingAction = vi.fn();

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.ensurePrivateUnlocked(pendingAction);
    });

    expect(pendingAction).toHaveBeenCalledTimes(1);
    expect(result.current.showOnboardModal).toBe(false);
  });
});
