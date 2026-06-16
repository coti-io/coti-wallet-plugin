import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ─── Hoisted mock state ─────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  updateAccountState: vi.fn().mockResolvedValue(true),
  isChainUpdatesMuted: vi.fn().mockReturnValue(false),
}));

vi.mock('../../src/hooks/useBalanceUpdater', () => ({
  useBalanceUpdater: () => ({ updateAccountState: h.updateAccountState }),
}));

vi.mock('../../src/lib/chainMute', () => ({
  isChainUpdatesMuted: h.isChainUpdatesMuted,
  muteChainUpdates: vi.fn(),
  unmuteChainUpdates: vi.fn(),
}));

vi.mock('../../src/crypto/localAesKeyVault', () => ({
  unlockCachedAesKey: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../src/chains', () => ({
  getUnlockStrategyForChain: vi.fn().mockReturnValue('snap'),
}));

vi.mock('../../src/lib/logger', () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/hooks/usePrivacyBridge', () => ({
  getInitialPublicTokens: vi.fn().mockReturnValue([]),
  getInitialPrivateTokens: vi.fn().mockReturnValue([]),
}));

import { usePrivacyBridgeAccountSync } from '../../src/context/privacyBridge/usePrivacyBridgeAccountSync';
import type { PrivacyBridgeSessionCore, UpdateAccountStateRef } from '../../src/context/privacyBridge/sessionShared';
import { createRef } from 'react';

function makeCore(overrides: Partial<PrivacyBridgeSessionCore> = {}): PrivacyBridgeSessionCore {
  return {
    modals: {} as any,
    isConnected: true,
    setIsConnected: vi.fn(),
    walletAddress: '0xabc123',
    setWalletAddress: vi.fn(),
    hasSnap: true,
    setHasSnap: vi.fn(),
    snapError: null,
    setSnapError: vi.fn(),
    publicTokens: [],
    setPublicTokens: vi.fn(),
    privateTokens: [],
    setPrivateTokens: vi.fn(),
    showSnapMissingModal: false,
    setShowSnapMissingModal: vi.fn(),
    showCotiWalletAesKeyModal: false,
    setShowCotiWalletAesKeyModal: vi.fn(),
    metamaskDetected: false,
    setMetamaskDetected: vi.fn(),
    ethereumListenerRegistered: { current: false },
    wagmiSyncRef: { current: true },
    metamaskExplicitConnect: { current: false },
    sessionAesKey: null,
    setSessionAesKey: vi.fn(),
    arePrivateBalancesHidden: true,
    setArePrivateBalancesHidden: vi.fn(),
    executeSnapCheck: vi.fn(),
    getAESKeyFromSnap: vi.fn().mockResolvedValue(null),
    connectToSnap: vi.fn().mockResolvedValue(false),
    requestSnapConnection: vi.fn().mockResolvedValue(false),
    handleManualOnboarding: vi.fn().mockResolvedValue(null),
    handleKeyVerification: vi.fn().mockResolvedValue(undefined),
    clearSnapCache: vi.fn(),
    fetchPrivateBalance: vi.fn().mockResolvedValue('0'),
    getAesKeyFromProvider: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as PrivacyBridgeSessionCore;
}

function makeNetwork(overrides: Partial<any> = {}) {
  return {
    connectWallet: vi.fn(),
    checkNetwork: vi.fn().mockResolvedValue(undefined),
    registerEthereumInitializedListener: vi.fn(),
    switchNetwork: vi.fn(),
    chainId: '11155111',
    currentChainId: 11155111,
    networkName: 'Sepolia',
    COTI_MAINNET_ID: '2632500',
    COTI_TESTNET_ID: '7082400',
    SEPOLIA_ID: '11155111',
    wagmiAddress: '0xabc123',
    wagmiConnected: true,
    wagmiChainId: 11155111,
    wagmiConnector: undefined,
    wagmiDisconnect: vi.fn(),
    isUnsupportedNetwork: false,
    isOffTargetNetwork: false,
    isWrongNetwork: false,
    networkMismatchWarning: null,
    enforceNetwork: vi.fn(),
    ...overrides,
  };
}

describe('usePrivacyBridgeAccountSync — sessionAesKey effect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.updateAccountState.mockResolvedValue(true);
    h.isChainUpdatesMuted.mockReturnValue(false);
  });

  it('calls updateAccountState with fetchPrivate=true and the session key when sessionAesKey changes to non-null', async () => {
    const core = makeCore({ sessionAesKey: null, walletAddress: '0xabc123' });
    const network = makeNetwork({ wagmiChainId: 11155111 });
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    const { rerender } = renderHook(
      (props) => usePrivacyBridgeAccountSync(props),
      {
        initialProps: { core, network, updateAccountStateRef },
      },
    );

    // Initial render with null sessionAesKey — no call for session key effect
    expect(h.updateAccountState).not.toHaveBeenCalled();

    // Now simulate sessionAesKey being set
    const updatedCore = makeCore({
      sessionAesKey: 'a'.repeat(64),
      walletAddress: '0xabc123',
      wagmiSyncRef: { current: true },
    });

    rerender({ core: updatedCore, network, updateAccountStateRef });

    // Wait for the effect to fire
    await vi.waitFor(() => {
      expect(h.updateAccountState).toHaveBeenCalled();
    });

    expect(h.updateAccountState).toHaveBeenCalledWith(
      '0xabc123',
      true,
      true,
      'a'.repeat(64),
      11155111,
    );
  });

  it('does NOT call updateAccountState when sessionAesKey is null', () => {
    const core = makeCore({ sessionAesKey: null, walletAddress: '0xabc123' });
    const network = makeNetwork();
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePrivacyBridgeAccountSync({ core, network, updateAccountStateRef }));

    // The session-key effect should not fire when key is null
    expect(h.updateAccountState).not.toHaveBeenCalled();
  });

  it('does NOT call updateAccountState when walletAddress is empty', () => {
    const core = makeCore({ sessionAesKey: 'a'.repeat(64), walletAddress: '' });
    const network = makeNetwork();
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePrivacyBridgeAccountSync({ core, network, updateAccountStateRef }));

    expect(h.updateAccountState).not.toHaveBeenCalled();
  });

  it('passes undefined chainOverride when wagmiSyncRef is false', async () => {
    const core = makeCore({
      sessionAesKey: 'b'.repeat(64),
      walletAddress: '0xdef456',
      wagmiSyncRef: { current: false },
    });
    const network = makeNetwork({ wagmiChainId: 11155111 });
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePrivacyBridgeAccountSync({ core, network, updateAccountStateRef }));

    await vi.waitFor(() => {
      expect(h.updateAccountState).toHaveBeenCalled();
    });

    expect(h.updateAccountState).toHaveBeenCalledWith(
      '0xdef456',
      true,
      true,
      'b'.repeat(64),
      undefined, // wagmiSyncRef.current is false, so chainOverride = undefined
    );
  });
});
