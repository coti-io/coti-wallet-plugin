import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';

// ─── Shared, hoisted mock state ──────────────────────────────────────────────
const h = vi.hoisted(() => ({
  wagmi: {
    address: undefined as string | undefined,
    isConnected: false,
    chainId: 7082400,
    connector: undefined as unknown,
  },
  disconnect: vi.fn(),
  resolvePodStatus: vi.fn(async () => null as unknown),
  snap: {
    clearSnapCache: vi.fn(),
    handleManualOnboarding: vi.fn(async () => null as string | null),
    handleKeyVerification: vi.fn(async () => undefined),
  },
}));

vi.mock('wagmi', () => ({
  useAccount: () => h.wagmi,
  useDisconnect: () => ({ disconnect: h.disconnect }),
  useConnectorClient: () => ({ data: undefined }),
  useSwitchChain: () => ({ switchChain: vi.fn() }),
}));

vi.mock('../../src/hooks/useMetamask', () => ({
  useMetamask: () => ({
    connectWallet: vi.fn(async () => undefined),
    checkNetwork: vi.fn(async () => true),
    switchNetwork: vi.fn(async () => true),
    networkName: 'COTI Testnet',
    COTI_MAINNET_ID: '2632500',
    COTI_TESTNET_ID: '7082400',
    SEPOLIA_ID: '11155111',
    chainId: '7082400',
    registerEthereumInitializedListener: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/useSnap', () => ({
  useSnap: () => ({
    isSnapInstalled: false,
    executeSnapCheck: vi.fn(async () => false),
    getAESKeyFromSnap: vi.fn(async () => null),
    saveAESKeyToSnap: vi.fn(async () => undefined),
    connectToSnap: vi.fn(async () => false),
    requestSnapConnection: vi.fn(async () => false),
    handleManualOnboarding: h.snap.handleManualOnboarding,
    handleKeyVerification: h.snap.handleKeyVerification,
    clearSnapCache: h.snap.clearSnapCache,
  }),
}));

vi.mock('../../src/hooks/useWalletType', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/hooks/useWalletType')>();
  return {
    ...actual,
    useWalletType: () => ({ walletType: 'unknown', isMetaMaskWithSnap: false, connectorId: undefined }),
  };
});

vi.mock('../../src/hooks/useAesKeyProvider', () => ({
  useAesKeyProvider: () => ({
    getAesKey: vi.fn(async () => null),
    isOnboarding: false,
    onboardingError: null,
    currentStep: 'idle' as const,
    onboardingDebugTrace: [],
  }),
}));

vi.mock('../../src/hooks/usePrivateTokenBalance', () => ({
  usePrivateTokenBalance: () => ({ fetchPrivateBalance: vi.fn(async () => null) }),
}));

vi.mock('../../src/hooks/useBalanceUpdater', () => ({
  useBalanceUpdater: (params: {
    setWalletAddress: (a: string) => void;
    setIsConnected: (v: boolean) => void;
  }) => ({
    updateAccountState: async (account: string) => {
      if (account) {
        params.setWalletAddress(account);
        params.setIsConnected(true);
      }
      return true;
    },
  }),
}));

vi.mock('../../src/hooks/useNetworkEnforcer', () => ({
  useNetworkEnforcer: vi.fn(() => ({
    isUnsupportedNetwork: false,
    isOffTargetNetwork: false,
    isWrongNetwork: false,
    networkMismatchWarning: null,
    enforceNetwork: vi.fn().mockResolvedValue(undefined),
  })),
}));

// Keep the real getInitialPublic/PrivateTokens helpers; only stub the heavy hook.
vi.mock('../../src/hooks/usePrivacyBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/hooks/usePrivacyBridge')>();
  return {
    ...actual,
    usePrivacyBridge: vi.fn(() => ({
      handleSwap: vi.fn(async () => undefined),
      isBridgingLoading: false,
      isApprovalNeeded: false,
      isApproving: false,
      handleApprove: vi.fn(async () => undefined),
      estimatedGasFee: null,
      updateGasFee: vi.fn(async () => undefined),
      isGasEstimating: false,
      portalFeeCoti: null,
      feeDebugInfo: null,
    })),
  };
});

vi.mock('../../src/chains/portal/podRequestStatus', () => ({
  resolvePodRequestStatus: (...args: unknown[]) => h.resolvePodStatus(...(args as [])),
}));

import {
  PrivacyBridgeProvider,
  usePrivacyBridgeContext,
} from '../../src/context/PrivacyBridgeContext';
import { useNetworkEnforcer } from '../../src/hooks/useNetworkEnforcer';

type Ctx = ReturnType<typeof usePrivacyBridgeContext>;
const reqMock = window.ethereum!.request as unknown as ReturnType<typeof vi.fn>;

let latest: Ctx | null = null;
function Consumer() {
  latest = usePrivacyBridgeContext();
  return null;
}

async function renderProvider() {
  await act(async () => {
    render(
      <PrivacyBridgeProvider>
        <Consumer />
      </PrivacyBridgeProvider>
    );
  });
  return latest as Ctx;
}

describe('PrivacyBridgeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    reqMock.mockReset();
    reqMock.mockResolvedValue(undefined);
    h.wagmi.address = undefined;
    h.wagmi.isConnected = false;
    h.wagmi.chainId = 7082400;
    h.wagmi.connector = undefined;
    h.disconnect.mockReset();
    h.resolvePodStatus.mockReset();
    h.resolvePodStatus.mockResolvedValue(null);
    h.snap.clearSnapCache.mockReset();
    h.snap.handleManualOnboarding.mockReset();
    h.snap.handleManualOnboarding.mockResolvedValue(null);
    latest = null;
  });

  it('throws when used outside the provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(/within a PrivacyBridgeProvider/);
    spy.mockRestore();
  });

  it('exposes sensible defaults when disconnected', async () => {
    const ctx = await renderProvider();
    expect(ctx.isConnected).toBe(false);
    expect(ctx.walletAddress).toBe('');
    expect(ctx.publicTokens.length).toBeGreaterThan(0);
    expect(ctx.privateTokens.length).toBeGreaterThan(0);
    expect(ctx.direction).toBe('to-private');
    expect(ctx.selectedTokenIndex).toBe(0);
    expect(ctx.amount).toBe('');
    expect(ctx.isPrivateUnlocked).toBe(false);
    expect(ctx.sessionAesKey).toBeNull();
    expect(ctx.podRequests).toEqual([]);
    expect(ctx.COTI_TESTNET_ID).toBe('7082400');
    expect(ctx.SEPOLIA_ID).toBe('11155111');
    expect(ctx.networkName).toBe('COTI Testnet');
    expect(ctx.chainId).toBe('7082400');
    expect(ctx.isUnsupportedNetwork).toBe(false);
    expect(ctx.isOffTargetNetwork).toBe(false);
    expect(ctx.isWrongNetwork).toBe(false);
    expect(ctx.networkMismatchWarning).toBeNull();
    expect(ctx.enforceNetwork).toBeDefined();
  });

  it('wires useNetworkEnforcer with effective chainId and unified switchNetwork', async () => {
    await renderProvider();
    expect(useNetworkEnforcer).toHaveBeenCalledWith(
      '7082400',
      expect.any(Function),
    );
  });

  it('updates transaction inputs through setters', async () => {
    await renderProvider();
    act(() => {
      latest!.setAmount('12.5');
      latest!.setDirection('to-public');
      latest!.setSelectedTokenIndex(2);
    });
    expect(latest!.amount).toBe('12.5');
    expect(latest!.direction).toBe('to-public');
    expect(latest!.selectedTokenIndex).toBe(2);
  });

  it('toggles modal visibility flags', async () => {
    await renderProvider();
    act(() => {
      latest!.setShowInstallModal(true);
      latest!.setShowSnapMissingModal(true);
      latest!.setShowMultipleWalletsModal(true);
      latest!.setShowCotiWalletAesKeyModal(true);
    });
    expect(latest!.showInstallModal).toBe(true);
    expect(latest!.showSnapMissingModal).toBe(true);
    expect(latest!.showMultipleWalletsModal).toBe(true);
    expect(latest!.showCotiWalletAesKeyModal).toBe(true);
  });

  it('rejects AES key operations when no wallet is connected', async () => {
    const ctx = await renderProvider();
    await expect(ctx.saveManualAesKey('a'.repeat(32))).rejects.toThrow('Connect your wallet first');
    await expect(ctx.unlockCachedAesKey()).rejects.toThrow('Connect your wallet first');
  });

  it('handleConnect, handleSwap, updateGasFee and refreshPrivateBalances are safe no-ops when disconnected', async () => {
    const ctx = await renderProvider();
    await act(async () => {
      await ctx.handleConnect();
      await ctx.handleSwap('1', 'to-private', 0);
      await ctx.updateGasFee();
      await ctx.handleApprove();
    });
    await expect(ctx.refreshPrivateBalances()).resolves.toBe(false);
  });

  it('refreshPodRequest swallows a null status without throwing', async () => {
    const ctx = await renderProvider();
    h.resolvePodStatus.mockResolvedValue(null);
    await act(async () => {
      await ctx.refreshPodRequest({
        id: 'req-1',
        wallet: '0xabc',
        kind: 'deposit',
        chainId: 11155111,
        token: 'p.WETH',
        amount: '1',
        status: 'pod-pending',
        createdAt: 1,
        updatedAt: 1,
      });
    });
    expect(h.resolvePodStatus).toHaveBeenCalledTimes(1);
  });

  describe('when connected via wagmi', () => {
    beforeEach(() => {
      h.wagmi.address = '0x1111111111111111111111111111111111111111';
      h.wagmi.isConnected = true;
      // The real wagmi disconnect flips account state; mirror that so the
      // provider's sync effect doesn't immediately re-connect.
      h.disconnect.mockImplementation(() => {
        h.wagmi.isConnected = false;
        h.wagmi.address = undefined;
      });
    });

    it('syncs the wagmi account into context state', async () => {
      const ctx = await renderProvider();
      expect(ctx.isConnected).toBe(true);
      expect(ctx.walletAddress).toBe('0x1111111111111111111111111111111111111111');
    });

    it('saveManualAesKey caches the key and unlocks private balances', async () => {
      reqMock.mockResolvedValue('0x' + 'ab'.repeat(65)); // personal_sign signature
      await renderProvider();
      await act(async () => {
        await latest!.saveManualAesKey('A'.repeat(32));
      });
      expect(latest!.sessionAesKey).toBe('a'.repeat(32));
      expect(latest!.isPrivateUnlocked).toBe(true);
      expect(latest!.hasSnap).toBe(true);
    });

    it('handleDisconnect tears down the session and resets connection state', async () => {
      await renderProvider();
      expect(latest!.isConnected).toBe(true);
      await act(async () => {
        await latest!.handleDisconnect();
      });
      expect(h.disconnect).toHaveBeenCalled();
      expect(latest!.isConnected).toBe(false);
      expect(latest!.walletAddress).toBe('');
      expect(latest!.sessionAesKey).toBeNull();
      expect(h.snap.clearSnapCache).toHaveBeenCalled();
    });
  });
});
