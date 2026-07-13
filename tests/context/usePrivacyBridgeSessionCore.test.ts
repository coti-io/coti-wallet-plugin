import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  isSnapInstalled: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../src/hooks/useSnap', () => ({
  useSnap: () => ({
    isSnapInstalled: h.isSnapInstalled,
    executeSnapCheck: vi.fn(),
    getAESKeyFromSnap: vi.fn(),
    hasAesKeyInSnap: vi.fn(),
    connectToSnap: vi.fn(),
    requestSnapConnection: vi.fn(),
    decryptCtUint64ViaSnap: vi.fn(),
    decryptCtUint256ViaSnap: vi.fn(),
    buildItUint256ViaSnap: vi.fn(),
    handleManualOnboarding: vi.fn(),
    handleKeyVerification: vi.fn(),
    clearSnapCache: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/useWalletType', () => ({
  useWalletType: () => ({ walletType: 'metamask', isMetaMaskWithSnap: false }),
}));

vi.mock('../../src/hooks/useAesKeyProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/hooks/useAesKeyProvider')>();
  return {
    ...actual,
    useAesKeyProvider: () => ({ getAesKey: vi.fn() }),
  };
});

vi.mock('../../src/hooks/usePrivateTokenBalance', () => ({
  usePrivateTokenBalance: () => ({ fetchPrivateBalance: vi.fn() }),
}));

import { usePrivacyBridgeSessionCore } from '../../src/context/privacyBridge/usePrivacyBridgeSessionCore';

describe('usePrivacyBridgeSessionCore — checkSnapStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.isSnapInstalled.mockResolvedValue(false);
  });

  it('updates hasSnap from isSnapInstalled and returns the result', async () => {
    h.isSnapInstalled.mockResolvedValue(true);
    const { result } = renderHook(() => usePrivacyBridgeSessionCore({ modals: {} as any }));

    let installed = false;
    await act(async () => {
      installed = await result.current.checkSnapStatus();
    });

    expect(installed).toBe(true);
    expect(result.current.hasSnap).toBe(true);
    expect(h.isSnapInstalled).toHaveBeenCalledTimes(1);
  });

  it('dedupes concurrent checkSnapStatus calls', async () => {
    let resolveInstall!: (value: boolean) => void;
    h.isSnapInstalled.mockImplementation(
      () => new Promise<boolean>(resolve => { resolveInstall = resolve; }),
    );

    const { result } = renderHook(() => usePrivacyBridgeSessionCore({ modals: {} as any }));

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = result.current.checkSnapStatus();
      second = result.current.checkSnapStatus();
    });

    await act(async () => {
      resolveInstall(true);
      await Promise.all([first, second]);
    });

    expect(h.isSnapInstalled).toHaveBeenCalledTimes(1);
  });
});
