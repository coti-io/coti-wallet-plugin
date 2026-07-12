import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { usePrivateUnlockFlow } from '../../src/hooks/usePrivateUnlockFlow';
import { getVisibleOnboardingStep } from '../../src/lib/onboardingProgressDisplay';

const mockSaveManualAesKey = vi.fn();
const mockRefreshPrivateBalances = vi.fn();
const mockLockPrivateBalances = vi.fn();
const mockHandleConnect = vi.fn();
const mockRequestSnapConnection = vi.fn();
let mockWalletType = 'rabby';
let mockIsMetaMaskWithSnap = false;
let mockIsPrivateUnlocked = false;
let mockSessionAesKey: string | null = null;
let mockOnboardingError: string | null = null;
let mockOnboardingWarning: string | null = null;

vi.mock('../../src/context/privacyBridge/contexts', () => ({
  usePrivacyBridgeUnlock: () => ({
    isPrivateUnlocked: mockIsPrivateUnlocked,
    sessionAesKey: mockSessionAesKey,
    sendPrivateToken: vi.fn(),
    refreshPrivateBalances: mockRefreshPrivateBalances,
    onboardingError: mockOnboardingError,
    onboardingWarning: mockOnboardingWarning,
    lockPrivateBalances: mockLockPrivateBalances,
    saveManualAesKey: mockSaveManualAesKey,
    requestSnapConnection: mockRequestSnapConnection,
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
    walletType: mockWalletType,
    isMetaMaskWithSnap: mockIsMetaMaskWithSnap,
  }),
}));

vi.mock('../../src/lib/metaMaskMobile', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/metaMaskMobile')>();
  return {
    ...actual,
    isMetaMaskMobileBrowser: () => false,
  };
});

vi.mock('../../src/components/OnboardModal', () => ({
  OnboardModal: (props: { isOpen: boolean; currentStep?: string; aesKey?: string | null; onConfirm?: () => void; onClose?: () => void }) =>
    props.isOpen ? <div data-testid="onboard-modal" data-step={props.currentStep} /> : null,
}));

vi.mock('../../src/components/WalletSignPrompt', () => ({
  WalletSignPrompt: (props: { isOpen: boolean }) =>
    props.isOpen ? <div data-testid="wallet-sign-prompt" /> : null,
}));

describe('usePrivateUnlockFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSaveManualAesKey.mockResolvedValue({});
    mockWalletType = 'rabby';
    mockIsMetaMaskWithSnap = false;
    mockIsPrivateUnlocked = false;
    mockSessionAesKey = null;
    mockOnboardingError = null;
    mockOnboardingWarning = null;
    mockRefreshPrivateBalances.mockResolvedValue(false);
    mockRequestSnapConnection.mockResolvedValue(false);
  });

  it('opens onboarding modal when restoreOnly fails without cancellation', async () => {
    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    expect(mockRefreshPrivateBalances).toHaveBeenCalledWith({
      restoreOnly: true,
      onRestoreCancelled: expect.any(Function),
      onProgress: expect.any(Function),
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

  it('allows unlock retry after backup restore signing is cancelled', async () => {
    mockRefreshPrivateBalances.mockImplementation(async (options?: { onRestoreCancelled?: () => void }) => {
      options?.onRestoreCancelled?.();
      return false;
    });

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });
    await act(async () => {
      await result.current.openUnlockFlow();
    });

    expect(mockRefreshPrivateBalances).toHaveBeenCalledTimes(2);
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

  it('returns true when a dismissed in-flight restore later succeeds', async () => {
    let resolveRefresh!: (value: boolean) => void;
    mockRefreshPrivateBalances.mockImplementationOnce(
      () => new Promise(resolve => {
        resolveRefresh = resolve;
      }),
    );
    const pendingAction = vi.fn();

    const { result } = renderHook(() => usePrivateUnlockFlow());

    let unlockPromise!: Promise<boolean>;
    act(() => {
      unlockPromise = result.current.ensurePrivateUnlocked(pendingAction);
    });

    act(() => {
      result.current.resetUnlockUi();
    });

    let unlocked = false;
    await act(async () => {
      resolveRefresh(true);
      unlocked = await unlockPromise;
    });

    expect(unlocked).toBe(true);
    expect(mockLockPrivateBalances).not.toHaveBeenCalled();
    expect(pendingAction).not.toHaveBeenCalled();
    expect(result.current.showOnboardModal).toBe(false);
  });

  it('returns true when a stale restore succeeds during a newer unlock attempt', async () => {
    let resolveFirst!: (value: boolean) => void;
    mockRefreshPrivateBalances
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(false);

    const { result } = renderHook(() => usePrivateUnlockFlow());

    let firstPromise!: Promise<boolean>;
    act(() => {
      firstPromise = result.current.ensurePrivateUnlocked();
    });

    act(() => {
      result.current.resetUnlockUi();
    });

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    let firstUnlocked = false;
    await act(async () => {
      resolveFirst(true);
      firstUnlocked = await firstPromise;
    });

    expect(firstUnlocked).toBe(true);
    expect(mockLockPrivateBalances).not.toHaveBeenCalled();
    expect(result.current.showOnboardModal).toBe(true);
  });

  it('does not run a superseded pending action after openUnlockFlow replaces ensurePrivateUnlocked', async () => {
    let resolveStaleRestore!: (value: boolean) => void;
    const staleAction = vi.fn();
    const onUnlocked = vi.fn();
    mockRefreshPrivateBalances
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveStaleRestore = resolve;
        }),
      )
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        mockSessionAesKey = 'e'.repeat(32);
        return true;
      });

    const { result } = renderHook(() => usePrivateUnlockFlow({ onUnlocked }));

    let stalePromise!: Promise<boolean>;
    act(() => {
      stalePromise = result.current.ensurePrivateUnlocked(staleAction);
    });

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      resolveStaleRestore(true);
      await stalePromise;
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(staleAction).not.toHaveBeenCalled();
    expect(onUnlocked).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.onboardModal.props.onClose();
    });

    expect(staleAction).not.toHaveBeenCalled();
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it('runs only the latest pending action when ensurePrivateUnlocked is superseded', async () => {
    let resolveFirst!: (value: boolean) => void;
    const firstAction = vi.fn();
    const secondAction = vi.fn();
    mockRefreshPrivateBalances
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveFirst = resolve;
        }),
      )
      .mockResolvedValueOnce(true);

    const { result } = renderHook(() => usePrivateUnlockFlow());

    let firstPromise!: Promise<boolean>;
    act(() => {
      firstPromise = result.current.ensurePrivateUnlocked(firstAction);
    });

    let secondPromise!: Promise<boolean>;
    act(() => {
      secondPromise = result.current.ensurePrivateUnlocked(secondAction);
    });

    await act(async () => {
      resolveFirst(true);
      await firstPromise;
    });

    await act(async () => {
      await secondPromise;
    });

    expect(firstAction).not.toHaveBeenCalled();
    expect(secondAction).toHaveBeenCalledTimes(1);
  });

  it('clears isUnlocking when a superseded restore completes after a newer attempt finishes', async () => {
    let resolveFirst!: (value: boolean) => void;
    let resolveSecond!: (value: boolean) => void;
    mockRefreshPrivateBalances
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveFirst = resolve;
        }),
      )
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveSecond = resolve;
        }),
      );

    const { result } = renderHook(() => usePrivateUnlockFlow());

    let firstPromise!: Promise<boolean>;
    act(() => {
      firstPromise = result.current.ensurePrivateUnlocked();
    });

    let secondPromise!: Promise<boolean>;
    act(() => {
      secondPromise = result.current.ensurePrivateUnlocked();
    });

    expect(result.current.isUnlocking).toBe(true);

    await act(async () => {
      resolveFirst(true);
      await firstPromise;
    });

    expect(result.current.isUnlocking).toBe(true);

    await act(async () => {
      resolveSecond(false);
      await secondPromise;
    });

    expect(result.current.isUnlocking).toBe(false);
  });

  it('does not clear isUnlocking when stale onboarding completes during a newer restore', async () => {
    let resolveOnboard!: (value: boolean) => void;
    let resolveRestore!: (value: boolean) => void;
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveOnboard = resolve;
        }),
      )
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveRestore = resolve;
        }),
      );

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    let onboardPromise!: Promise<void>;
    act(() => {
      onboardPromise = result.current.onboardModal.props.onConfirm();
    });

    let restorePromise!: Promise<boolean>;
    act(() => {
      restorePromise = result.current.ensurePrivateUnlocked();
    });

    expect(result.current.isUnlocking).toBe(true);

    await act(async () => {
      resolveOnboard(false);
      await onboardPromise;
    });

    expect(result.current.isUnlocking).toBe(true);

    await act(async () => {
      resolveRestore(false);
      await restorePromise;
    });

    expect(result.current.isUnlocking).toBe(false);
  });

  it('clears unlock-in-progress gate when a stale restore unlocks the session', async () => {
    let resolveFirst!: (value: boolean) => void;
    let resolveSecond!: (value: boolean) => void;
    mockRefreshPrivateBalances
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveFirst = resolve;
        }),
      )
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveSecond = resolve;
        }),
      );

    const { result, rerender } = renderHook(() => usePrivateUnlockFlow());

    let openPromise!: Promise<void>;
    act(() => {
      openPromise = result.current.openUnlockFlow();
    });

    let secondPromise!: Promise<boolean>;
    act(() => {
      secondPromise = result.current.ensurePrivateUnlocked();
    });

    await act(async () => {
      mockIsPrivateUnlocked = true;
      resolveFirst(true);
      await openPromise;
      rerender();
    });

    // Session unlocked: openUnlockFlow must early-return, not start another restore.
    const refreshCallsBefore = mockRefreshPrivateBalances.mock.calls.length;
    await act(async () => {
      await result.current.openUnlockFlow();
    });
    expect(mockRefreshPrivateBalances.mock.calls.length).toBe(refreshCallsBefore);

    await act(async () => {
      resolveSecond(false);
      await secondPromise;
    });
  });

  it('clears unlock-in-progress when a dismissed restore is still the latest in-flight success', async () => {
    let resolveRefresh!: (value: boolean) => void;
    mockRefreshPrivateBalances.mockImplementationOnce(
      () => new Promise(resolve => {
        resolveRefresh = resolve;
      }),
    );

    const { result } = renderHook(() => usePrivateUnlockFlow());

    let openPromise!: Promise<void>;
    act(() => {
      openPromise = result.current.openUnlockFlow();
    });

    act(() => {
      result.current.resetUnlockUi();
    });

    await act(async () => {
      resolveRefresh(true);
      await openPromise;
    });

    // Progress gate must be clear so a later unlock attempt can start.
    mockRefreshPrivateBalances.mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.openUnlockFlow();
    });
    expect(mockRefreshPrivateBalances).toHaveBeenCalledTimes(2);
    expect(result.current.showOnboardModal).toBe(true);
  });

  it('ignores restore backup progress after unlock is dismissed', async () => {
    let capturedOnProgress!: (step: string) => void;
    mockRefreshPrivateBalances.mockImplementationOnce(
      (options?: { onProgress?: (step: string) => void }) => {
        capturedOnProgress = options?.onProgress ?? (() => undefined);
        return new Promise<boolean>(() => undefined);
      },
    );

    const { result } = renderHook(() => usePrivateUnlockFlow());

    act(() => {
      void result.current.ensurePrivateUnlocked();
    });

    act(() => {
      result.current.resetUnlockUi();
    });

    act(() => {
      capturedOnProgress('signing-backup');
    });

    expect(result.current.walletSignPrompt.props.isOpen).toBe(false);
    expect(result.current.showOnboardModal).toBe(false);
    expect(result.current.onboardModal.props.currentStep).toBe('idle');
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

  it('tries to install Snap before contract onboarding for MetaMask', async () => {
    mockWalletType = 'metamask';
    mockRequestSnapConnection.mockResolvedValueOnce(true);
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        mockSessionAesKey = 'a'.repeat(32);
        return true;
      });

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(mockRequestSnapConnection).toHaveBeenCalledTimes(1);
    expect(mockRefreshPrivateBalances).toHaveBeenLastCalledWith({
      forceContractOnboarding: true,
      saveBackup: false,
      onProgress: expect.any(Function),
    });
  });

  it('falls back to non-Snap onboarding when Snap install is rejected', async () => {
    mockWalletType = 'metamask';
    mockRequestSnapConnection.mockResolvedValueOnce(false);
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        mockSessionAesKey = 'b'.repeat(32);
        return true;
      });

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(mockRequestSnapConnection).toHaveBeenCalledTimes(1);
    expect(mockRefreshPrivateBalances).toHaveBeenLastCalledWith({
      forceContractOnboarding: true,
      saveBackup: true,
      onProgress: expect.any(Function),
    });
    expect(result.current.onboardModal.props.warning).toBe(
      'Snap connection was skipped or rejected. Continuing without Snap storage.',
    );
  });

  it('keeps success screen open with AES key after contract onboarding until dismissed', async () => {
    const onUnlocked = vi.fn();
    const pendingAction = vi.fn();
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        mockSessionAesKey = 'c'.repeat(32);
        return true;
      });

    const { result } = renderHook(() => usePrivateUnlockFlow({ onUnlocked }));

    await act(async () => {
      await result.current.ensurePrivateUnlocked(pendingAction);
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(result.current.showOnboardModal).toBe(true);
    expect(result.current.onboardModal.props.currentStep).toBe('complete');
    expect(result.current.onboardModal.props.aesKey).toBe('c'.repeat(32));
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(pendingAction).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.onboardModal.props.onClose();
    });

    expect(result.current.showOnboardModal).toBe(false);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(pendingAction).toHaveBeenCalledTimes(1);
  });

  it('runs pending action when closing during validating-key after unlock succeeded', async () => {
    const onUnlocked = vi.fn();
    const pendingAction = vi.fn();
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => true);

    const { result } = renderHook(() => usePrivateUnlockFlow({ onUnlocked }));

    await act(async () => {
      await result.current.ensurePrivateUnlocked(pendingAction);
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(result.current.onboardModal.props.currentStep).toBe('validating-key');
    expect(pendingAction).not.toHaveBeenCalled();
    expect(onUnlocked).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.onboardModal.props.onClose();
    });

    expect(result.current.showOnboardModal).toBe(false);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(pendingAction).toHaveBeenCalledTimes(1);
  });

  it('keeps the progress modal while saving a contract onboarding backup', async () => {
    let resolveOnboard!: () => void;
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        async (options?: { onProgress?: (step: string) => void }) => {
          options?.onProgress?.('signing-backup');
          await new Promise<void>(resolve => {
            resolveOnboard = resolve;
          });
          mockSessionAesKey = 'd'.repeat(32);
          return true;
        },
      );

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    let onboardPromise!: Promise<void>;
    act(() => {
      onboardPromise = result.current.onboardModal.props.onConfirm();
    });

    expect(result.current.showOnboardModal).toBe(true);
    expect(result.current.onboardModal.props.currentStep).toBe('saving-backup');
    expect(getVisibleOnboardingStep('saving-backup')).toBe('persisting-key');
    expect(result.current.walletSignPrompt.props.isOpen).toBe(false);

    await act(async () => {
      resolveOnboard();
      await onboardPromise;
    });

    expect(result.current.showOnboardModal).toBe(true);
    expect(result.current.onboardModal.props.currentStep).toBe('complete');
    expect(result.current.onboardModal.props.aesKey).toBe('d'.repeat(32));
    expect(result.current.walletSignPrompt.props.isOpen).toBe(false);
  });

  it('does not complete onboarding when the modal was dismissed while onboarding was in flight', async () => {
    let resolveOnboard!: (value: boolean) => void;
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        () => new Promise(resolve => {
          resolveOnboard = resolve;
        }),
      );

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    let onboardPromise!: Promise<void>;
    act(() => {
      onboardPromise = result.current.onboardModal.props.onConfirm();
    });

    act(() => {
      result.current.onboardModal.props.onClose();
    });

    await act(async () => {
      resolveOnboard(true);
      await onboardPromise;
    });

    expect(mockLockPrivateBalances).not.toHaveBeenCalled();
    expect(result.current.showOnboardModal).toBe(false);
    expect(result.current.onboardModal.props.currentStep).not.toBe('complete');
  });

  it('returns to error screen when contract onboarding fails with provider feedback', async () => {
    mockWalletType = 'rabby';
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async (options?: {
        onProgress?: (step: string, details?: { error?: string }) => void;
      }) => {
        options?.onProgress?.('error', { error: 'Network timeout' });
        return false;
      });

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(result.current.showOnboardModal).toBe(true);
    expect(result.current.onboardModal.props.currentStep).toBe('error');
    expect(result.current.onboardModal.props.error).toBe('Network timeout');
    expect(result.current.statusMessage).toBeNull();
  });

  it('shows onboarding error immediately when provider emits error progress', async () => {
    let resolveOnboard!: (value: boolean) => void;
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        (options?: {
          onProgress?: (step: string, details?: { error?: string }) => void;
        }) => new Promise(resolve => {
          options?.onProgress?.('error', {
            error: 'Retrieved AES key has invalid format',
          });
          resolveOnboard = resolve;
        }),
      );

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    let onboardPromise!: Promise<void>;
    act(() => {
      onboardPromise = result.current.onboardModal.props.onConfirm();
    });

    expect(result.current.onboardModal.props.currentStep).toBe('error');
    expect(result.current.onboardModal.props.error).toBe(
      'Retrieved AES key has invalid format',
    );

    await act(async () => {
      resolveOnboard(false);
      await onboardPromise;
    });

    expect(result.current.onboardModal.props.currentStep).toBe('error');
    expect(result.current.onboardModal.props.error).toBe(
      'Retrieved AES key has invalid format',
    );
  });

  it('does not advance onboarding progress after provider reports an error', async () => {
    let capturedOnProgress!: (step: string, details?: { error?: string }) => void;
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        (options?: {
          onProgress?: (step: string, details?: { error?: string }) => void;
        }) => {
          capturedOnProgress = options?.onProgress ?? (() => undefined);
          return Promise.resolve(false);
        },
      );

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    act(() => {
      capturedOnProgress('error', { error: 'Network timeout' });
    });
    expect(result.current.onboardModal.props.currentStep).toBe('error');

    act(() => {
      capturedOnProgress('restoring-network');
    });
    expect(result.current.onboardModal.props.currentStep).toBe('error');
  });

  it('keeps success screen open after snap-backed contract onboarding succeeds', async () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        mockSessionAesKey = 'd'.repeat(32);
        return true;
      });

    const onUnlocked = vi.fn();
    const { result } = renderHook(() => usePrivateUnlockFlow({ onUnlocked }));

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(result.current.showOnboardModal).toBe(true);
    expect(result.current.onboardModal.props.currentStep).toBe('complete');
    expect(onUnlocked).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.onboardModal.props.onClose();
    });

    expect(result.current.showOnboardModal).toBe(false);
    expect(onUnlocked).toHaveBeenCalledTimes(1);
  });

  it('keeps onboarding progress visible while contract onboarding saves a backup', async () => {
    vi.useFakeTimers();
    let capturedOnProgress!: (step: string) => void;
    let resolveOnboard!: (value: boolean) => void;

    try {
      mockRefreshPrivateBalances
        .mockResolvedValueOnce(false)
        .mockImplementationOnce(async (options?: {
          onProgress?: (step: string) => void;
        }) => {
          capturedOnProgress = options?.onProgress ?? (() => undefined);
          const ok = await new Promise<boolean>(resolve => {
            resolveOnboard = resolve;
          });
          if (ok) {
            mockSessionAesKey = 'd'.repeat(32);
          }
          return ok;
        });

      const { result } = renderHook(() => usePrivateUnlockFlow());

      await act(async () => {
        await result.current.openUnlockFlow();
      });

      let onboardPromise!: Promise<void>;
      act(() => {
        onboardPromise = result.current.onboardModal.props.onConfirm();
      });

      act(() => {
        capturedOnProgress('signing-backup');
      });

      expect(result.current.showOnboardModal).toBe(true);
      expect(result.current.onboardModal.props.currentStep).toBe('saving-backup');
      expect(result.current.walletSignPrompt.props.isOpen).toBe(false);

      await act(async () => {
        resolveOnboard(true);
        await vi.advanceTimersByTimeAsync(599);
      });
      expect(result.current.onboardModal.props.currentStep).toBe('saving-backup');

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
        await onboardPromise;
      });
      expect(result.current.onboardModal.props.currentStep).toBe('complete');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not pass stale provider errors while showing onboarding success', async () => {
    mockWalletType = 'metamask';
    mockIsMetaMaskWithSnap = true;
    mockOnboardingError = 'stale provider error';
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        mockSessionAesKey = 'd'.repeat(32);
        return true;
      });

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(result.current.showOnboardModal).toBe(true);
    expect(result.current.onboardModal.props.currentStep).toBe('complete');
    expect(result.current.onboardModal.props.error).toBeNull();
  });

  it('keeps final progress state while waiting for session AES key after onboarding succeeds', async () => {
    let resolveOnboard!: (value: boolean) => void;
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        () => new Promise<boolean>(resolve => {
          resolveOnboard = resolve;
        }),
      );

    const { result, rerender } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    let onboardPromise!: Promise<void>;
    act(() => {
      onboardPromise = result.current.onboardModal.props.onConfirm();
    });

    await act(async () => {
      resolveOnboard(true);
      await onboardPromise;
    });

    expect(result.current.isUnlocking).toBe(true);
    expect(result.current.showOnboardModal).toBe(true);
    expect(result.current.onboardModal.props.currentStep).toBe('validating-key');
    expect(result.current.onboardModal.props.aesKey).toBeNull();

    mockSessionAesKey = 'd'.repeat(32);
    await act(async () => {
      rerender();
    });

    expect(result.current.isUnlocking).toBe(false);
    expect(result.current.onboardModal.props.currentStep).toBe('complete');
    expect(result.current.onboardModal.props.aesKey).toBe('d'.repeat(32));
  });

  it('does not move contract onboarding progress backwards after execute starts', async () => {
    let capturedOnProgress!: (step: string) => void;
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        (options?: { onProgress?: (step: string) => void }) => {
          capturedOnProgress = options?.onProgress ?? (() => undefined);
          return new Promise<boolean>(() => undefined);
        },
      );

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    act(() => {
      void result.current.onboardModal.props.onConfirm();
    });
    expect(result.current.onboardModal.props.currentStep).toBe('preparing-onboard');

    act(() => {
      capturedOnProgress('retrieving-key');
    });
    expect(result.current.onboardModal.props.currentStep).toBe('retrieving-key');

    act(() => {
      capturedOnProgress('signing-transaction');
    });
    expect(result.current.onboardModal.props.currentStep).toBe('retrieving-key');
  });

  it('ignores contract progress from a cancelled onboarding attempt after retry opens', async () => {
    let cancelledOnProgress!: (step: string, details?: { cancelled?: boolean }) => void;
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        (options?: { onProgress?: (step: string, details?: { cancelled?: boolean }) => void }) => {
          cancelledOnProgress = options?.onProgress ?? (() => undefined);
          cancelledOnProgress('idle', { cancelled: true });
          return false;
        },
      )
      .mockResolvedValueOnce(false);

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });
    expect(result.current.showOnboardModal).toBe(false);

    await act(async () => {
      await result.current.openUnlockFlow();
    });
    expect(result.current.showOnboardModal).toBe(true);
    expect(result.current.onboardModal.props.currentStep).toBe('idle');

    act(() => {
      cancelledOnProgress('signing-transaction');
    });
    expect(result.current.onboardModal.props.currentStep).toBe('idle');
  });

  it('dismisses the modal and shows inline status when contract onboarding is cancelled', async () => {
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        (options?: { onProgress?: (step: string, details?: { cancelled?: boolean }) => void }) => {
          options?.onProgress?.('idle', { cancelled: true });
          return false;
        },
      );

    const onOnboardingCancelled = vi.fn();
    const { result } = renderHook(() => usePrivateUnlockFlow({ onOnboardingCancelled }));

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(result.current.showOnboardModal).toBe(false);
    expect(result.current.statusMessage).toBe('Signature cancelled.');
    expect(onOnboardingCancelled).toHaveBeenCalledTimes(1);
  });

  it('prefers cancel dismissal over stale onboardingError on retry', async () => {
    mockOnboardingError = 'Previous onboarding exploded';
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        (options?: { onProgress?: (step: string, details?: { cancelled?: boolean }) => void }) => {
          options?.onProgress?.('idle', { cancelled: true });
          return false;
        },
      );

    const onOnboardingCancelled = vi.fn();
    const { result } = renderHook(() => usePrivateUnlockFlow({ onOnboardingCancelled }));

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(result.current.showOnboardModal).toBe(false);
    expect(result.current.statusMessage).toBe('Signature cancelled.');
    expect(onOnboardingCancelled).toHaveBeenCalledTimes(1);
  });

  it('does not show stale provider onboardingError when reopening after dismiss', async () => {
    mockOnboardingError = 'Previous onboarding exploded';
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async (options?: {
        onProgress?: (step: string, details?: { error?: string }) => void;
      }) => {
        options?.onProgress?.('error', { error: 'Network timeout' });
        return false;
      });

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(result.current.onboardModal.props.error).toBe('Network timeout');

    await act(async () => {
      result.current.onboardModal.props.onClose?.();
    });

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    expect(result.current.onboardModal.props.error).toBeNull();
  });

  it('shows an error instead of cancelled when onboarding fails without a cancel signal', async () => {
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false);

    const onOnboardingCancelled = vi.fn();
    const { result } = renderHook(() => usePrivateUnlockFlow({ onOnboardingCancelled }));

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(result.current.showOnboardModal).toBe(true);
    expect(result.current.statusMessage).toBeNull();
    expect(result.current.onboardModal.props.currentStep).toBe('error');
    expect(result.current.onboardModal.props.error).toBe('Onboarding did not complete. Please retry.');
    expect(onOnboardingCancelled).not.toHaveBeenCalled();
  });

  it('uses provider progress error details when onboarding error state is stale', async () => {
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(
        (options?: { onProgress?: (step: string, details?: { error?: string }) => void }) => {
          options?.onProgress?.('error', {
            error: 'Insufficient native COTI for onboarding gas. Add COTI and retry.',
          });
          return false;
        },
      );

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onConfirm();
    });

    expect(result.current.showOnboardModal).toBe(true);
    expect(result.current.statusMessage).toBeNull();
    expect(result.current.onboardModal.props.currentStep).toBe('error');
    expect(result.current.onboardModal.props.error).toBe(
      'Insufficient native COTI for onboarding gas. Add COTI and retry.',
    );
  });

  it('passes onboarding warning to the modal without stale provider errors on open', async () => {
    mockOnboardingWarning = 'Backup restore failed; continuing.';
    mockOnboardingError = 'Onboarding exploded';
    mockRefreshPrivateBalances.mockResolvedValueOnce(false);

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    expect(result.current.showOnboardModal).toBe(true);
    expect(result.current.onboardModal.props.error).toBeNull();
    expect(result.current.onboardModal.props.warning).toBe('Backup restore failed; continuing.');
  });

  it('passes saveBackup and onProgress when submitting a manual AES key', async () => {
    mockSaveManualAesKey.mockImplementation(async (_key, options) => {
      options?.onProgress?.('signing-backup');
      options?.onProgress?.('idle');
      return {};
    });
    mockRefreshPrivateBalances.mockResolvedValueOnce(false);

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    await act(async () => {
      await result.current.onboardModal.props.onManualAesKeySubmit?.('a'.repeat(32), {
        saveBackup: true,
      });
    });

    expect(mockSaveManualAesKey).toHaveBeenCalledWith('a'.repeat(32), {
      saveBackup: true,
      onProgress: expect.any(Function),
    });
    expect(result.current.showOnboardModal).toBe(false);
  });

  it('shows the success screen with warning when manual backup save fails', async () => {
    const onUnlocked = vi.fn();
    const pendingAction = vi.fn();
    mockSaveManualAesKey.mockResolvedValueOnce({
      backupWarning: 'Encrypted backup was not saved. storage failed',
    });
    mockRefreshPrivateBalances.mockResolvedValueOnce(false);

    const { result } = renderHook(() => usePrivateUnlockFlow({ onUnlocked }));

    await act(async () => {
      await result.current.ensurePrivateUnlocked(pendingAction);
    });

    await act(async () => {
      await result.current.onboardModal.props.onManualAesKeySubmit?.('a'.repeat(32), {
        saveBackup: true,
      });
    });

    expect(result.current.showOnboardModal).toBe(true);
    expect(result.current.onboardModal.props.currentStep).toBe('complete');
    expect(result.current.onboardModal.props.warning).toBe(
      'Encrypted backup was not saved. storage failed',
    );
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(pendingAction).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.onboardModal.props.onClose();
    });

    expect(onUnlocked).toHaveBeenCalledTimes(1);
    expect(pendingAction).toHaveBeenCalledTimes(1);
  });

  it('does not lock when manual AES submit completes after dismiss', async () => {
    let resolveManualSave!: (value: { backupWarning?: string }) => void;
    mockSaveManualAesKey.mockImplementationOnce(
      () => new Promise<{ backupWarning?: string }>(resolve => {
        resolveManualSave = resolve;
      }),
    );
    mockRefreshPrivateBalances.mockResolvedValueOnce(false);
    const pendingAction = vi.fn();

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.ensurePrivateUnlocked(pendingAction);
    });

    let manualSubmitPromise!: Promise<void>;
    act(() => {
      manualSubmitPromise = result.current.onboardModal.props.onManualAesKeySubmit?.(
        'a'.repeat(32),
        { saveBackup: false },
      );
    });

    act(() => {
      result.current.resetUnlockUi();
    });

    await act(async () => {
      resolveManualSave({});
      await manualSubmitPromise;
    });

    expect(mockLockPrivateBalances).not.toHaveBeenCalled();
    expect(pendingAction).not.toHaveBeenCalled();
    expect(result.current.showOnboardModal).toBe(false);
  });

  it('ignores manual backup progress after unlock is dismissed', async () => {
    let capturedOnProgress!: (step: string) => void;
    let resolveManualSave!: (value: { backupWarning?: string }) => void;
    mockSaveManualAesKey.mockImplementationOnce(
      (_key, options) => {
        capturedOnProgress = options?.onProgress ?? (() => undefined);
        return new Promise<{ backupWarning?: string }>(resolve => {
          resolveManualSave = resolve;
        });
      },
    );
    mockRefreshPrivateBalances.mockResolvedValueOnce(false);

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.openUnlockFlow();
    });

    let manualSubmitPromise!: Promise<void>;
    act(() => {
      manualSubmitPromise = result.current.onboardModal.props.onManualAesKeySubmit?.(
        'a'.repeat(32),
        { saveBackup: true },
      );
    });

    act(() => {
      result.current.resetUnlockUi();
    });

    act(() => {
      capturedOnProgress('signing-backup');
    });

    expect(result.current.walletSignPrompt.props.isOpen).toBe(false);
    expect(result.current.showOnboardModal).toBe(false);
    expect(result.current.onboardModal.props.currentStep).toBe('idle');

    await act(async () => {
      resolveManualSave({});
      await manualSubmitPromise;
    });
  });

  it('does not lock when manual backup signing completes after dismiss', async () => {
    let resolveManualSave!: () => void;
    mockSaveManualAesKey.mockImplementationOnce(
      async (_key, options) => {
        options?.onProgress?.('signing-backup');
        await new Promise<void>(resolve => {
          resolveManualSave = resolve;
        });
        options?.onProgress?.('idle');
        return {};
      },
    );
    mockRefreshPrivateBalances.mockResolvedValueOnce(false);
    const pendingAction = vi.fn();

    const { result } = renderHook(() => usePrivateUnlockFlow());

    await act(async () => {
      await result.current.ensurePrivateUnlocked(pendingAction);
    });

    let manualSubmitPromise!: Promise<void>;
    act(() => {
      manualSubmitPromise = result.current.onboardModal.props.onManualAesKeySubmit?.(
        'a'.repeat(32),
        { saveBackup: true },
      );
    });

    expect(result.current.showOnboardModal).toBe(false);
    expect(result.current.walletSignPrompt.props.isOpen).toBe(true);

    act(() => {
      result.current.resetUnlockUi();
    });

    await act(async () => {
      resolveManualSave();
      await manualSubmitPromise;
    });

    expect(mockLockPrivateBalances).not.toHaveBeenCalled();
    expect(pendingAction).not.toHaveBeenCalled();
    expect(result.current.showOnboardModal).toBe(false);
  });
});
