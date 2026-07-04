import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import {
  PrivacyBridgeProvider,
  usePrivacyBridgeContext,
  usePrivacyBridgeWallet,
  usePrivacyBridgeNetwork,
  usePrivacyBridgeUnlock,
  usePrivacyBridgeTokens,
  usePrivacyBridgeSwap,
  usePrivacyBridgePod,
  usePrivacyBridgeModals,
  mergePrivacyBridgeSlices,
} from '../../src/context/privacyBridge';

const h = vi.hoisted(() => ({
  wagmi: {
    address: undefined as string | undefined,
    isConnected: false,
    chainId: 7082400,
    connector: undefined as unknown,
  },
  disconnect: vi.fn(),
  connectWallet: vi.fn(async (onConnect?: (account: string) => Promise<void>) => {
    if (onConnect) {
      await onConnect('0xabc1234567890123456789012345678901234567');
    }
    return true;
  }),
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
    connectWallet: h.connectWallet,
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

vi.mock('../../src/hooks/usePrivacyBridge', () => ({
  getInitialPublicTokens: () => [{ symbol: 'COTI', name: 'COTI', balance: '0.00', isPrivate: false }],
  getInitialPrivateTokens: () => [{ symbol: 'p.COTI', name: 'p.COTI', balance: '0.00', isPrivate: true }],
  usePrivacyBridge: () => ({
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
  }),
}));

vi.mock('../../src/chains/portal/podRequestStatus', () => ({
  resolvePodRequestStatus: (...args: unknown[]) => h.resolvePodStatus(...args),
}));

describe('privacyBridge facade', () => {
  beforeEach(() => {
    h.wagmi.address = undefined;
    h.wagmi.isConnected = false;
    h.wagmi.chainId = 7082400;
    h.wagmi.connector = undefined;
    vi.clearAllMocks();
    h.connectWallet.mockImplementation(async (onConnect?: (account: string) => Promise<void>) => {
      if (onConnect) {
        await onConnect('0xabc1234567890123456789012345678901234567');
      }
      return true;
    });
  });

  it('mergePrivacyBridgeSlices produces the same keys as the legacy context', () => {
    const slices = {
      wallet: {
        isConnected: false,
        walletAddress: '',
        handleConnect: async () => undefined,
        handleDisconnect: async () => undefined,
        metamaskDetected: false,
      },
      network: {
        chainId: '7082400',
        switchNetwork: async () => true,
        networkName: 'COTI Testnet',
        isUnsupportedNetwork: false,
        isOffTargetNetwork: false,
        isWrongNetwork: false,
        networkMismatchWarning: null,
        enforceNetwork: async () => undefined,
        COTI_MAINNET_ID: '2632500',
        COTI_TESTNET_ID: '7082400',
        SEPOLIA_ID: '11155111',
      },
      unlock: {
        hasSnap: false,
        snapError: null,
        connectToSnap: async () => false,
        requestSnapConnection: async () => false,
        isPrivateUnlocked: false,
        unlockCachedAesKey: async () => undefined,
        sendPrivateToken: async () => ({ txHash: '0x1' }),
        refreshPrivateBalances: async () => false,
        lockPrivateBalances: () => undefined,
        handleOnboard: async () => null,
        saveManualAesKey: async () => undefined,
        handleVerifyKeys: async () => undefined,
        showSnapMissingModal: false,
        setShowSnapMissingModal: () => undefined,
        showCotiWalletAesKeyModal: false,
        setShowCotiWalletAesKeyModal: () => undefined,
      },
      tokens: {
        publicTokens: [],
        privateTokens: [],
      },
      swap: {
        amount: '',
        direction: 'to-private' as const,
        selectedTokenIndex: 0,
        setAmount: () => undefined,
        setDirection: () => undefined,
        setSelectedTokenIndex: () => undefined,
        handleSwap: async () => undefined,
        isBridgingLoading: false,
        isApprovalNeeded: false,
        isApproving: false,
        handleApprove: async () => undefined,
        estimatedGasFee: null,
        updateGasFee: async () => undefined,
        isGasEstimating: false,
        portalFeeCoti: null,
        feeDebugInfo: null,
      },
      pod: {
        podRequests: [],
        refreshPodRequest: async () => undefined,
      },
      modals: {
        showInstallModal: false,
        setShowInstallModal: () => undefined,
        showMultipleWalletsModal: false,
        setShowMultipleWalletsModal: () => undefined,
      },
    };

    const merged = mergePrivacyBridgeSlices(slices);
    expect(Object.keys(merged).sort()).toEqual(
      [
        ...Object.keys(slices.wallet),
        ...Object.keys(slices.network),
        ...Object.keys(slices.unlock),
        ...Object.keys(slices.tokens),
        ...Object.keys(slices.swap),
        ...Object.keys(slices.pod),
        ...Object.keys(slices.modals),
      ].sort(),
    );
  });

  it('bounded hooks and legacy context stay in sync under the provider', async () => {
    let legacy: ReturnType<typeof usePrivacyBridgeContext> | null = null;
    let wallet: ReturnType<typeof usePrivacyBridgeWallet> | null = null;
    let network: ReturnType<typeof usePrivacyBridgeNetwork> | null = null;

    function Probe() {
      legacy = usePrivacyBridgeContext();
      wallet = usePrivacyBridgeWallet();
      network = usePrivacyBridgeNetwork();
      usePrivacyBridgeUnlock();
      usePrivacyBridgeTokens();
      usePrivacyBridgeSwap();
      usePrivacyBridgePod();
      usePrivacyBridgeModals();
      return null;
    }

    render(
      <PrivacyBridgeProvider>
        <Probe />
      </PrivacyBridgeProvider>,
    );

    expect(legacy).not.toBeNull();
    expect(wallet!.isConnected).toBe(legacy!.isConnected);
    expect(network!.chainId).toBe(legacy!.chainId);
    expect(network!.COTI_TESTNET_ID).toBe('7082400');

    h.wagmi.address = '0xabc1234567890123456789012345678901234567';
    h.wagmi.isConnected = true;

    await act(async () => {
      render(
        <PrivacyBridgeProvider>
          <Probe />
        </PrivacyBridgeProvider>,
      );
    });
  });

  it('sets metamaskDetected when wagmi connects via a MetaMask connector', async () => {
    let wallet: ReturnType<typeof usePrivacyBridgeWallet> | null = null;

    function Probe() {
      wallet = usePrivacyBridgeWallet();
      return null;
    }

    h.wagmi.address = '0xabc1234567890123456789012345678901234567';
    h.wagmi.isConnected = true;
    h.wagmi.connector = { id: 'io.metamask', name: 'MetaMask' };

    await act(async () => {
      render(
        <PrivacyBridgeProvider>
          <Probe />
        </PrivacyBridgeProvider>,
      );
    });

    expect(wallet!.metamaskDetected).toBe(true);
  });

  it('clears metamaskDetected for non-MetaMask wagmi connectors', async () => {
    let wallet: ReturnType<typeof usePrivacyBridgeWallet> | null = null;

    function Probe() {
      wallet = usePrivacyBridgeWallet();
      return null;
    }

    h.wagmi.address = '0xabc1234567890123456789012345678901234567';
    h.wagmi.isConnected = true;
    h.wagmi.connector = { id: 'walletConnect', name: 'WalletConnect' };

    await act(async () => {
      render(
        <PrivacyBridgeProvider>
          <Probe />
        </PrivacyBridgeProvider>,
      );
    });

    expect(wallet!.metamaskDetected).toBe(false);
  });

  it('sets metamaskDetected after explicit MetaMask handleConnect', async () => {
    let wallet: ReturnType<typeof usePrivacyBridgeWallet> | null = null;

    function Probe() {
      wallet = usePrivacyBridgeWallet();
      return null;
    }

    render(
      <PrivacyBridgeProvider>
        <Probe />
      </PrivacyBridgeProvider>,
    );

    expect(wallet!.metamaskDetected).toBe(false);

    await act(async () => {
      await wallet!.handleConnect();
    });

    expect(wallet!.metamaskDetected).toBe(true);
  });

  it('does not set metamaskDetected when connectWallet returns false', async () => {
    let wallet: ReturnType<typeof usePrivacyBridgeWallet> | null = null;

    function Probe() {
      wallet = usePrivacyBridgeWallet();
      return null;
    }

    h.connectWallet.mockResolvedValueOnce(false);

    render(
      <PrivacyBridgeProvider>
        <Probe />
      </PrivacyBridgeProvider>,
    );

    await act(async () => {
      await wallet!.handleConnect();
    });

    expect(wallet!.metamaskDetected).toBe(false);
  });

  it('does not set metamaskDetected from handleConnect when wagmi manages the session', async () => {
    let wallet: ReturnType<typeof usePrivacyBridgeWallet> | null = null;

    function Probe() {
      wallet = usePrivacyBridgeWallet();
      return null;
    }

    h.wagmi.address = '0xabc1234567890123456789012345678901234567';
    h.wagmi.isConnected = true;
    h.wagmi.connector = { id: 'walletConnect', name: 'WalletConnect' };

    await act(async () => {
      render(
        <PrivacyBridgeProvider>
          <Probe />
        </PrivacyBridgeProvider>,
      );
    });

    expect(wallet!.metamaskDetected).toBe(false);

    await act(async () => {
      await wallet!.handleConnect();
    });

    expect(wallet!.metamaskDetected).toBe(false);
  });

  it('clears metamaskDetected on wagmi disconnect via connector effect (WAG-01)', async () => {
    let wallet: ReturnType<typeof usePrivacyBridgeWallet> | null = null;

    function Probe() {
      wallet = usePrivacyBridgeWallet();
      return null;
    }

    h.wagmi.address = '0xabc1234567890123456789012345678901234567';
    h.wagmi.isConnected = true;
    h.wagmi.connector = { id: 'io.metamask', name: 'MetaMask' };

    const { rerender } = render(
      <PrivacyBridgeProvider>
        <Probe />
      </PrivacyBridgeProvider>,
    );

    await act(async () => {
      rerender(
        <PrivacyBridgeProvider>
          <Probe />
        </PrivacyBridgeProvider>,
      );
    });
    expect(wallet!.metamaskDetected).toBe(true);

    h.wagmi.isConnected = false;
    h.wagmi.address = undefined;
    h.wagmi.connector = undefined;

    await act(async () => {
      rerender(
        <PrivacyBridgeProvider>
          <Probe />
        </PrivacyBridgeProvider>,
      );
    });

    expect(wallet!.metamaskDetected).toBe(false);
  });
});
