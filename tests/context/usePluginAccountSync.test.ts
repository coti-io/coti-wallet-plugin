import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { configureCotiPlugin } from '../../src/config/plugin';

// ─── Hoisted mock state ─────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  bindAccount: vi.fn().mockResolvedValue({ ok: true }),
  refreshPublicBalances: vi.fn().mockResolvedValue({ ok: true }),
  refreshPrivateBalances: vi.fn().mockResolvedValue({ ok: true }),
  establishAesSession: vi.fn().mockResolvedValue({ ok: true, aesKey: null }),
  isChainUpdatesMuted: vi.fn().mockReturnValue(false),
  balanceUpdaterParams: undefined as any,
}));

vi.mock('../../src/hooks/useBalanceUpdater', () => ({
  useBalanceUpdater: (params: any) => {
    h.balanceUpdaterParams = params;
    return {
      bindAccount: h.bindAccount,
      refreshPublicBalances: h.refreshPublicBalances,
      refreshPrivateBalances: h.refreshPrivateBalances,
      establishAesSession: h.establishAesSession,
    };
  },
}));

vi.mock('../../src/lib/chainMute', () => ({
  isChainUpdatesMuted: h.isChainUpdatesMuted,
  muteChainUpdates: vi.fn(),
  unmuteChainUpdates: vi.fn(),
}));

vi.mock('../../src/chains', () => ({
  getUnlockStrategyForChain: vi.fn().mockReturnValue('snap'),
}));

vi.mock('../../src/lib/logger', () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/hooks/usePluginBridge', () => ({
  getInitialPublicTokens: vi.fn().mockReturnValue([]),
  getInitialPrivateTokens: vi.fn().mockReturnValue([]),
}));

vi.mock('wagmi', () => ({
  useAccount: () => ({ chainId: 7082400 }),
}));

vi.mock('../../src/hooks/useWalletType', () => ({
  useWalletType: () => ({ walletType: 'metamask', isMetaMaskWithSnap: true }),
}));

vi.mock('../../src/lib/ethereum', () => ({
  getMetaMaskProvider: vi.fn().mockReturnValue(null),
}));

vi.mock('../../src/crypto/aesKeyValidation', () => ({
  validateMetaMaskAesKeyOnUnlock: vi.fn().mockResolvedValue(undefined),
}));

import { usePluginAccountSync } from '../../src/context/plugin/usePluginAccountSync';
import type { PluginSessionState, UpdateAccountStateRef } from '../../src/context/plugin/sessionShared';

function makeCore(overrides: Partial<PluginSessionState> = {}): PluginSessionState {
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
    checkSnapStatus: vi.fn().mockResolvedValue(false),
    getAESKeyFromSnap: vi.fn().mockResolvedValue(null),
    connectToSnap: vi.fn().mockResolvedValue(false),
    requestSnapConnection: vi.fn().mockResolvedValue(false),
    handleManualOnboarding: vi.fn().mockResolvedValue(null),
    handleKeyVerification: vi.fn().mockResolvedValue(undefined),
    clearSnapCache: vi.fn(),
    fetchPrivateBalance: vi.fn().mockResolvedValue('0'),
    decryptCtUint64ViaSnap: vi.fn(),
    decryptCtUint256ViaSnap: vi.fn(),
    buildItUint256ViaSnap: vi.fn().mockResolvedValue(null),
    hasAesKeyInSnap: vi.fn().mockResolvedValue(null),
    getAesKeyFromProvider: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as PluginSessionState;
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
    wagmiAddress: '0xabc123' as `0x${string}`,
    wagmiConnected: true,
    wagmiChainId: 11155111,
    wagmiConnector: undefined,
    wagmiDisconnect: vi.fn(),
    isUnsupportedNetwork: false,
    isOffTargetNetwork: false,
    isWrongNetwork: false,
    networkMismatchWarning: null,
    enforceNetwork: vi.fn(),
    wagmiConfig: {} as any,
    ...overrides,
  };
}

describe('usePluginAccountSync — session AES key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureCotiPlugin({ snapEnabled: true });
    h.refreshPrivateBalances.mockResolvedValue({ ok: true });
    h.isChainUpdatesMuted.mockReturnValue(false);
    h.balanceUpdaterParams = undefined;
  });

  it('does not auto-refresh catalogs when a session AES key arrives', async () => {
    const core = makeCore({ sessionAesKey: null, walletAddress: '0xabc123' });
    const network = makeNetwork({ wagmiChainId: 11155111 });
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    const { rerender } = renderHook(
      (props) => usePluginAccountSync(props),
      {
        initialProps: { core, network, updateAccountStateRef },
      },
    );

    expect(h.refreshPrivateBalances).not.toHaveBeenCalled();

    const updatedCore = makeCore({
      sessionAesKey: 'a'.repeat(32),
      walletAddress: '0xabc123',
      wagmiSyncRef: { current: true },
    });

    rerender({ core: updatedCore, network, updateAccountStateRef });

    await new Promise(resolve => setTimeout(resolve, 30));
    expect(h.refreshPublicBalances).not.toHaveBeenCalled();
    expect(h.refreshPrivateBalances).not.toHaveBeenCalled();
    expect(updatedCore.setArePrivateBalancesHidden).not.toHaveBeenCalled();
  });

  it('does NOT call refreshPrivateBalances when sessionAesKey is null', () => {
    const core = makeCore({ sessionAesKey: null, walletAddress: '0xabc123' });
    const network = makeNetwork();
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({ core, network, updateAccountStateRef }));

    // The session-key effect should not fire when key is null
    expect(h.refreshPrivateBalances).not.toHaveBeenCalled();
  });

  it('does NOT call refreshPrivateBalances when walletAddress is empty', () => {
    const core = makeCore({ sessionAesKey: 'a'.repeat(32), walletAddress: '' });
    const network = makeNetwork();
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({ core, network, updateAccountStateRef }));

    expect(h.refreshPrivateBalances).not.toHaveBeenCalled();
  });

  it('does NOT call refreshPrivateBalances when private balances are already visible', () => {
    const core = makeCore({
      sessionAesKey: 'a'.repeat(64),
      walletAddress: '0xabc123',
      arePrivateBalancesHidden: false,
    });
    const network = makeNetwork();
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({ core, network, updateAccountStateRef }));

    expect(h.refreshPrivateBalances).not.toHaveBeenCalled();
  });

  it('does not auto-refresh catalogs when a session key is already present on mount', async () => {
    const core = makeCore({
      sessionAesKey: 'b'.repeat(32),
      walletAddress: '0xdef456',
      wagmiSyncRef: { current: false },
    });
    const network = makeNetwork({ wagmiChainId: 11155111 });
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({ core, network, updateAccountStateRef }));

    await new Promise(resolve => setTimeout(resolve, 30));
    expect(h.refreshPublicBalances).not.toHaveBeenCalled();
    expect(h.refreshPrivateBalances).not.toHaveBeenCalled();
  });

  it('routes force-contract skipCache requests to the wallet provider instead of Snap', async () => {
    const getAESKeyFromSnap = vi.fn().mockResolvedValue('snap-key');
    const getAesKeyFromProvider = vi.fn().mockResolvedValue('contract-key');
    const core = makeCore({ getAESKeyFromSnap, getAesKeyFromProvider });
    const network = makeNetwork();
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({ core, network, updateAccountStateRef }));

    const key = await h.balanceUpdaterParams.getAESKeyFromSnap('0xabc123', {
      skipCache: true,
      forceContractOnboarding: true,
    });

    expect(key).toBe('contract-key');
    expect(getAESKeyFromSnap).not.toHaveBeenCalled();
    expect(getAesKeyFromProvider).toHaveBeenCalledWith(
      '0xabc123',
      undefined,
      { skipCache: true, forceContractOnboarding: true },
    );
  });

  it('routes MetaMask skipCache to provider when Snap is disabled (continue without Snap)', async () => {
    configureCotiPlugin({ snapEnabled: false });
    const getAESKeyFromSnap = vi.fn().mockResolvedValue('snap-key');
    const getAesKeyFromProvider = vi.fn().mockResolvedValue('contract-key');
    const core = makeCore({ getAESKeyFromSnap, getAesKeyFromProvider });
    const network = makeNetwork();
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({ core, network, updateAccountStateRef }));

    const key = await h.balanceUpdaterParams.getAESKeyFromSnap('0xabc123', {
      skipCache: true,
    });

    expect(key).toBe('contract-key');
    expect(getAESKeyFromSnap).not.toHaveBeenCalled();
    expect(getAesKeyFromProvider).toHaveBeenCalledWith(
      '0xabc123',
      undefined,
      { skipCache: true },
    );
  });

  it('forwards onboarding progress callbacks to the wallet provider', async () => {
    const onProgress = vi.fn();
    const getAesKeyFromProvider = vi.fn().mockResolvedValue('contract-key');
    const core = makeCore({ getAesKeyFromProvider });
    const network = makeNetwork();
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({ core, network, updateAccountStateRef }));

    await h.balanceUpdaterParams.getAESKeyFromSnap('0xabc123', {
      forceContractOnboarding: true,
      onProgress,
    });

    expect(getAesKeyFromProvider).toHaveBeenCalledWith(
      '0xabc123',
      onProgress,
      { forceContractOnboarding: true, onProgress },
    );
  });

  it('does not reuse session AES key for force-contract onboarding', async () => {
    const getAesKeyFromProvider = vi.fn().mockResolvedValue('contract-key');
    const core = makeCore({
      sessionAesKey: 's'.repeat(32),
      getAesKeyFromProvider,
    });
    const network = makeNetwork();
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({ core, network, updateAccountStateRef }));

    const key = await h.balanceUpdaterParams.getAESKeyFromSnap('0xabc123', {
      forceContractOnboarding: true,
    });

    expect(key).toBe('contract-key');
    expect(getAesKeyFromProvider).toHaveBeenCalledWith(
      '0xabc123',
      undefined,
      { forceContractOnboarding: true },
    );
  });
});

describe('usePluginAccountSync — snap auto-probe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.refreshPrivateBalances.mockResolvedValue({ ok: true });
  });

  it('calls checkSnapStatus when MetaMask connects with hasSnap false', async () => {
    const checkSnapStatus = vi.fn().mockResolvedValue(true);
    const core = makeCore({ hasSnap: false, walletAddress: '0xabc123', checkSnapStatus });
    const network = makeNetwork();
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({ core, network, updateAccountStateRef }));

    await vi.waitFor(() => {
      expect(checkSnapStatus).toHaveBeenCalledTimes(1);
    });
  });

  it('skips checkSnapStatus when hasSnap is already true', () => {
    const checkSnapStatus = vi.fn().mockResolvedValue(true);
    const core = makeCore({ hasSnap: true, walletAddress: '0xabc123', checkSnapStatus });
    const network = makeNetwork();
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({ core, network, updateAccountStateRef }));

    expect(checkSnapStatus).not.toHaveBeenCalled();
  });

  it('skips checkSnapStatus when walletAddress is empty', () => {
    const checkSnapStatus = vi.fn().mockResolvedValue(true);
    const core = makeCore({ hasSnap: false, walletAddress: '', checkSnapStatus });
    const network = makeNetwork();
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({ core, network, updateAccountStateRef }));

    expect(checkSnapStatus).not.toHaveBeenCalled();
  });
});

describe('usePluginAccountSync — autoInitTokens', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureCotiPlugin({ autoInitTokens: true, snapEnabled: true });
    h.refreshPrivateBalances.mockResolvedValue({ ok: true });
    h.isChainUpdatesMuted.mockReturnValue(false);
  });

  it('seeds token lists while disconnected when autoInitTokens is on', () => {
    const setPublicTokens = vi.fn();
    const setPrivateTokens = vi.fn();
    const core = makeCore({
      isConnected: false,
      setPublicTokens,
      setPrivateTokens,
    });
    const network = makeNetwork({ currentChainId: 7082400 });
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({ core, network, updateAccountStateRef }));

    expect(setPublicTokens).toHaveBeenCalled();
    expect(setPrivateTokens).toHaveBeenCalled();
  });

  it('does not seed token lists while disconnected when autoInitTokens is false', () => {
    const setPublicTokens = vi.fn();
    const setPrivateTokens = vi.fn();
    const core = makeCore({
      isConnected: false,
      setPublicTokens,
      setPrivateTokens,
    });
    const network = makeNetwork({ currentChainId: 7082400 });
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    renderHook(() => usePluginAccountSync({
      core,
      network,
      updateAccountStateRef,
      autoInitTokens: false,
    }));

    expect(setPublicTokens).not.toHaveBeenCalled();
    expect(setPrivateTokens).not.toHaveBeenCalled();
  });

  it('does not auto-refresh private balances on session key arrival when autoInitTokens is false', async () => {
    const core = makeCore({ sessionAesKey: null, walletAddress: '0xabc123' });
    const network = makeNetwork({ wagmiChainId: 11155111 });
    const updateAccountStateRef = { current: null } as unknown as UpdateAccountStateRef;

    const { rerender } = renderHook(
      (props) => usePluginAccountSync(props),
      {
        initialProps: {
          core,
          network,
          updateAccountStateRef,
          autoInitTokens: false,
        },
      },
    );

    const updatedCore = makeCore({
      sessionAesKey: 'a'.repeat(32),
      walletAddress: '0xabc123',
      wagmiSyncRef: { current: true },
    });

    rerender({
      core: updatedCore,
      network,
      updateAccountStateRef,
      autoInitTokens: false,
    });

    await new Promise(resolve => setTimeout(resolve, 30));
    expect(h.refreshPrivateBalances).not.toHaveBeenCalled();
  });
});
