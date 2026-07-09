import React, { type ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { PrivateUnlockProvider, usePrivateUnlock } from '../../src/context/privateUnlock';

const mockRefreshPrivateBalances = vi.fn();
const mockLockPrivateBalances = vi.fn();
const mockHandleConnect = vi.fn();
const mockRequestSnapConnection = vi.fn();
let mockSessionAesKey: string | null = null;
let mockIsPrivateUnlocked = false;
let onboardModalProps: {
  isOpen: boolean;
  currentStep?: string;
  aesKey?: string | null;
  onConfirm?: () => void | Promise<void>;
  onClose?: () => void;
} | null = null;

vi.mock('../../src/context/privacyBridge/contexts', () => ({
  usePrivacyBridgeUnlock: () => ({
    isPrivateUnlocked: mockIsPrivateUnlocked,
    sessionAesKey: mockSessionAesKey,
    sendPrivateToken: vi.fn(),
    refreshPrivateBalances: mockRefreshPrivateBalances,
    lockPrivateBalances: mockLockPrivateBalances,
    saveManualAesKey: vi.fn(),
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
    walletType: 'rabby',
    isMetaMaskWithSnap: false,
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
  OnboardModal: (props: NonNullable<typeof onboardModalProps>) => {
    onboardModalProps = props;
    return props.isOpen ? <div data-testid="onboard-modal" data-step={props.currentStep} /> : null;
  },
}));

vi.mock('../../src/components/WalletSignPrompt', () => ({
  WalletSignPrompt: (props: { isOpen: boolean }) =>
    props.isOpen ? <div data-testid="wallet-sign-prompt" /> : null,
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <PrivateUnlockProvider>{children}</PrivateUnlockProvider>
);

describe('PrivateUnlockProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionAesKey = null;
    mockIsPrivateUnlocked = false;
    onboardModalProps = null;
    mockRefreshPrivateBalances.mockResolvedValue(false);
    mockRequestSnapConnection.mockResolvedValue(false);
  });

  it('exposes command API and opens provider-owned modal when restore fails', async () => {
    const { result } = renderHook(() => usePrivateUnlock(), { wrapper });

    await act(async () => {
      await result.current.unlock();
    });

    expect(mockRefreshPrivateBalances).toHaveBeenCalledWith({
      restoreOnly: true,
      onRestoreCancelled: expect.any(Function),
      onProgress: expect.any(Function),
    });
    expect(onboardModalProps?.isOpen).toBe(true);
    expect(onboardModalProps?.currentStep).toBe('idle');
  });

  it('runs pending action after restore-only unlock without opening modal', async () => {
    mockRefreshPrivateBalances.mockResolvedValueOnce(true);
    const pendingAction = vi.fn();

    const { result } = renderHook(() => usePrivateUnlock(), { wrapper });

    await act(async () => {
      await result.current.requireUnlock(pendingAction);
    });

    expect(mockRefreshPrivateBalances).toHaveBeenCalledWith({
      restoreOnly: true,
      onRestoreCancelled: expect.any(Function),
      onProgress: expect.any(Function),
    });
    expect(pendingAction).toHaveBeenCalledTimes(1);
    expect(onboardModalProps?.isOpen).toBe(false);
  });

  it('shows AES key success screen after contract onboarding until Done', async () => {
    const pendingAction = vi.fn();
    mockRefreshPrivateBalances
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async () => {
        mockSessionAesKey = 'd'.repeat(32);
        return true;
      });

    const { result, rerender } = renderHook(() => usePrivateUnlock(), { wrapper });

    await act(async () => {
      await result.current.requireUnlock(pendingAction);
    });

    await act(async () => {
      await onboardModalProps?.onConfirm?.();
    });

    rerender();

    expect(onboardModalProps?.isOpen).toBe(true);
    expect(onboardModalProps?.currentStep).toBe('complete');
    expect(onboardModalProps?.aesKey).toBe('d'.repeat(32));
    expect(pendingAction).not.toHaveBeenCalled();

    await act(async () => {
      onboardModalProps?.onClose?.();
    });

    expect(pendingAction).toHaveBeenCalledTimes(1);
  });

  it('shows wallet sign prompt during backup decrypt and hides it after signing', async () => {
    let capturedOnProgress: ((step: string) => void) | undefined;
    mockRefreshPrivateBalances.mockImplementation(async (options?: {
      onProgress?: (step: string) => void;
    }) => {
      capturedOnProgress = options?.onProgress;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return false;
    });

    function TestApp() {
      const unlock = usePrivateUnlock();
      return (
        <button type="button" onClick={() => void unlock.unlock()} data-testid="unlock-btn">
          Unlock
        </button>
      );
    }

    const view = render(
      <PrivateUnlockProvider>
        <TestApp />
      </PrivateUnlockProvider>,
    );

    await act(async () => {
      view.getByTestId('unlock-btn').click();
    });

    await act(async () => {
      capturedOnProgress?.('signing-backup');
    });
    expect(view.queryByTestId('wallet-sign-prompt')).toBeInTheDocument();

    await act(async () => {
      capturedOnProgress?.('complete');
    });
    expect(view.queryByTestId('wallet-sign-prompt')).not.toBeInTheDocument();
  });

  it('locks through the controller', () => {
    mockIsPrivateUnlocked = true;
    const { result } = renderHook(() => usePrivateUnlock(), { wrapper });

    act(() => {
      result.current.lock();
    });

    expect(mockLockPrivateBalances).toHaveBeenCalledTimes(1);
  });
});
