import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

// ─── Hoisted mock state ─────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  updateAccountState: vi.fn().mockResolvedValue(true),
  isChainUpdatesMuted: vi.fn().mockReturnValue(false),
  mapConnectorIdToWalletType: vi.fn(() => 'unknown' as const),
  wagmiAccount: {
    address: '0xabc123' as string | undefined,
    isConnected: true,
    chainId: 11155111 as number | undefined,
    connector: undefined as any,
  },
  wagmiDisconnect: vi.fn(),
}));

vi.mock('wagmi', () => ({
  useAccount: () => h.wagmiAccount,
  useDisconnect: () => ({ disconnect: h.wagmiDisconnect }),
  useConnectorClient: () => ({ data: undefined }),
  useSwitchChain: () => ({ switchChain: vi.fn() }),
}));

vi.mock('../../src/hooks/useMetamask', () => ({
  useMetamask: () => ({
    connectWallet: vi.fn(),
    checkNetwork: vi.fn().mockResolvedValue(undefined),
    switchNetwork: vi.fn().mockResolvedValue(true),
    networkName: 'Sepolia',
    COTI_MAINNET_ID: '2632500',
    COTI_TESTNET_ID: '7082400',
    SEPOLIA_ID: '11155111',
    chainId: '11155111',
    registerEthereumInitializedListener: vi.fn(),
  }),
}));

vi.mock('../../src/hooks/useNetworkEnforcer', () => ({
  useNetworkEnforcer: () => ({
    isUnsupportedNetwork: false,
    isOffTargetNetwork: false,
    isWrongNetwork: false,
    networkMismatchWarning: null,
    enforceNetwork: vi.fn(),
  }),
}));

vi.mock('../../src/config/plugin', () => ({
  getPluginConfig: () => ({ clearSessionKeyOnWagmiDisconnect: true }),
}));

vi.mock('../../src/hooks/useWalletType', () => ({
  mapConnectorIdToWalletType: h.mapConnectorIdToWalletType,
}));

vi.mock('../../src/lib/chainMute', () => ({
  isChainUpdatesMuted: h.isChainUpdatesMuted,
  muteChainUpdates: vi.fn(),
  unmuteChainUpdates: vi.fn(),
}));

vi.mock('../../src/lib/logger', () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/lib/format', () => ({
  truncateAddress: (a: string) => a.slice(0, 8),
}));

vi.mock('../../src/chains', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/chains')>();
  return {
    ...actual,
    getWalletNetworkConfigs: () => ({}),
  };
});

import { usePrivacyBridgeWagmiSync } from '../../src/context/privacyBridge/usePrivacyBridgeWagmiSync';
import type { PrivacyBridgeSessionCore } from '../../src/context/privacyBridge/sessionShared';

function makeCore(overrides: Partial<PrivacyBridgeSessionCore> = {}): PrivacyBridgeSessionCore {
  return {
    modals: {} as any,
    isConnected: true,
    setIsConnected: vi.fn(),
    walletAddress: '0xabc123',
    setWalletAddress: vi.fn(),
    hasSnap: false,
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

function makeAccountSync(overrides: Partial<any> = {}) {
  return {
    updateAccountState: h.updateAccountState,
    currentChainId: 11155111,
    ...overrides,
  };
}

describe('usePrivacyBridgeWagmiSync — chain-change guard with sessionAesKey', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.updateAccountState.mockResolvedValue(true);
    h.isChainUpdatesMuted.mockReturnValue(false);
    h.wagmiAccount.address = '0xabc123';
    h.wagmiAccount.isConnected = true;
    h.wagmiAccount.chainId = 11155111;
  });

  it('calls updateAccountState with fetchPrivate=true and sessionAesKey when key is set and chain changes (unmuted)', async () => {
    const core = makeCore({ sessionAesKey: 'c'.repeat(32), walletAddress: '0xabc123' });
    const network = makeNetwork({ wagmiChainId: 11155111 });
    const accountSync = makeAccountSync();

    // First render — sets prevWagmiChainIdRef to wagmiChainId
    const { rerender } = renderHook(
      (props) => usePrivacyBridgeWagmiSync(props),
      { initialProps: { core, network, accountSync } },
    );

    // Simulate chain change
    h.wagmiAccount.chainId = 7082400;
    const updatedNetwork = makeNetwork({ wagmiChainId: 7082400 });

    rerender({ core, network: updatedNetwork, accountSync });

    await vi.waitFor(() => {
      expect(h.updateAccountState).toHaveBeenCalledWith(
        '0xabc123',
        true,
        true,
        'c'.repeat(32),
        7082400,
      );
    });
  });

  it('calls updateAccountState with fetchPrivate=false when sessionAesKey is null and chain changes (regression)', async () => {
    const core = makeCore({ sessionAesKey: null, walletAddress: '0xabc123' });
    const network = makeNetwork({ wagmiChainId: 11155111 });
    const accountSync = makeAccountSync();

    // First render — sets prevWagmiChainIdRef
    const { rerender } = renderHook(
      (props) => usePrivacyBridgeWagmiSync(props),
      { initialProps: { core, network, accountSync } },
    );

    // Simulate chain change
    h.wagmiAccount.chainId = 7082400;
    const updatedNetwork = makeNetwork({ wagmiChainId: 7082400 });

    rerender({ core, network: updatedNetwork, accountSync });

    await vi.waitFor(() => {
      expect(h.updateAccountState).toHaveBeenCalledWith(
        '0xabc123',
        false,
        true,
        undefined,
        7082400,
      );
    });
  });

  it('does NOT call updateAccountState when chain updates are muted', async () => {
    h.isChainUpdatesMuted.mockReturnValue(true);

    const core = makeCore({ sessionAesKey: 'c'.repeat(32), walletAddress: '0xabc123' });
    const network = makeNetwork({ wagmiChainId: 11155111 });
    const accountSync = makeAccountSync();

    const { rerender } = renderHook(
      (props) => usePrivacyBridgeWagmiSync(props),
      { initialProps: { core, network, accountSync } },
    );

    // Simulate chain change while muted
    h.wagmiAccount.chainId = 7082400;
    const updatedNetwork = makeNetwork({ wagmiChainId: 7082400 });

    rerender({ core, network: updatedNetwork, accountSync });

    // Give time for any async effects
    await new Promise(r => setTimeout(r, 50));

    // The chain-change effect should not call updateAccountState because muted
    // (Only first-render calls may have happened for connection sync)
    const chainChangeCalls = h.updateAccountState.mock.calls.filter(
      (call: any[]) => call[4] === 7082400 // chainOverride matches the new chain
    );
    expect(chainChangeCalls).toHaveLength(0);
  });
});

describe('usePrivacyBridgeWagmiSync — snap status on connect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.updateAccountState.mockResolvedValue(true);
    h.wagmiAccount.address = '0xabc123';
    h.wagmiAccount.isConnected = true;
    h.wagmiAccount.chainId = 11155111;
    vi.mocked(h.mapConnectorIdToWalletType).mockReturnValue('metamask');
  });

  it('calls checkSnapStatus when RainbowKit MetaMask connects', async () => {
    const checkSnapStatus = vi.fn().mockResolvedValue(true);
    const core = makeCore({ isConnected: false, checkSnapStatus });
    const network = makeNetwork({ wagmiConnector: { id: 'io.metamask' } });
    const accountSync = makeAccountSync();

    renderHook(() => usePrivacyBridgeWagmiSync({ core, network, accountSync }));

    await vi.waitFor(() => {
      expect(checkSnapStatus).toHaveBeenCalledTimes(1);
    });
  });

  it('does not call checkSnapStatus for non-MetaMask connectors', () => {
    vi.mocked(h.mapConnectorIdToWalletType).mockReturnValue('coinbase');
    const checkSnapStatus = vi.fn().mockResolvedValue(false);
    const core = makeCore({ isConnected: false, checkSnapStatus });
    const network = makeNetwork({ wagmiConnector: { id: 'coinbaseWalletSDK' } });
    const accountSync = makeAccountSync();

    renderHook(() => usePrivacyBridgeWagmiSync({ core, network, accountSync }));

    expect(checkSnapStatus).not.toHaveBeenCalled();
  });
});
