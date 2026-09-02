import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import {
  CotiPluginProvider,
  useCotiPluginContext,
  useCotiWallet,
  useCotiNetwork,
  useCotiUnlock,
  useCotiTokens,
  useCotiSwap,
  useCotiPod,
  useCotiModals,
  mergeCotiPluginSlices,
} from '../../src/context/plugin';

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
  useConfig: () => ({ setState: vi.fn() }),
  useDisconnect: () => ({ disconnect: h.disconnect }),
  useConnectorClient: () => ({ data: undefined }),
  useSwitchChain: () => ({ switchChain: vi.fn() }),
  useConfig: () => ({
    setState: vi.fn(),
    storage: { setItem: vi.fn(), removeItem: vi.fn() },
  }),
}));

vi.mock('@wagmi/core', () => ({
  disconnect: vi.fn(async () => {
    h.wagmi.isConnected = false;
    h.wagmi.address = undefined;
  }),
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
    isSnapInstalled: vi.fn().mockResolvedValue(false),
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

vi.mock('../../src/hooks/useAesKeyProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/hooks/useAesKeyProvider')>();
  return {
    ...actual,
    useAesKeyProvider: () => ({
      getAesKey: vi.fn(async () => null),
      isOnboarding: false,
      onboardingError: null,
      currentStep: 'idle' as const,
    }),
  };
});

vi.mock('../../src/hooks/usePrivateTokenBalance', () => ({
  usePrivateTokenBalance: () => ({ fetchPrivateBalance: vi.fn(async () => null) }),
}));

vi.mock('../../src/hooks/useBalanceUpdater', () => ({
  useBalanceUpdater: (params: {
    setWalletAddress: (a: string) => void;
    setIsConnected: (v: boolean) => void;
  }) => ({
    bindAccount: async (account: string) => {
      if (account) {
        params.setWalletAddress(account);
        params.setIsConnected(true);
      }
      return { ok: true as const };
    },
    refreshPublicBalances: async ({ account }: { account: string }) => {
      if (account) {
        params.setWalletAddress(account);
        params.setIsConnected(true);
      }
      return { ok: true as const };
    },
    establishAesSession: async ({ account, aesKey }: { account: string; aesKey?: string | null }) => {
      if (account) {
        params.setWalletAddress(account);
        params.setIsConnected(true);
      }
      return { ok: true as const, aesKey: aesKey ?? null };
    },
    refreshPrivateBalances: async ({ account }: { account: string }) => {
      if (account) {
        params.setWalletAddress(account);
        params.setIsConnected(true);
      }
      return { ok: true as const };
    },
  }),
}));

vi.mock('../../src/hooks/usePluginBridge', () => ({
  getInitialPublicTokens: () => [{ symbol: 'COTI', name: 'COTI', balance: '0.00', isPrivate: false }],
  getInitialPrivateTokens: () => [{ symbol: 'p.COTI', name: 'p.COTI', balance: '0.00', isPrivate: true }],
  usePluginBridge: () => ({
    handleSwap: vi.fn(async () => undefined),
    isBridgingLoading: false,
    isApprovalNeeded: false,
    isApproving: false,
    handleApprove: vi.fn(async () => undefined),
    estimatedGasFee: null,
    updateGasFee: vi.fn(async () => undefined),
    isGasEstimating: false,
    portalFeeCoti: null,
    portalFee: null,
    portalFeeSymbol: 'COTI',
    podInboxFee: null,
    l1GasFee: null,
    isPodChain: false,
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

  it('mergeCotiPluginSlices produces the same keys as the legacy context', () => {
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
        checkSnapStatus: async () => false,
        isPrivateUnlocked: false,
        sendPrivateToken: async () => ({ txHash: '0x1' }),
        refreshPrivateBalances: async () => false,
        onboardingError: null,
        onboardingWarnings: {},
        lockPrivateBalances: () => undefined,
        handleOnboard: async () => null,
        saveManualAesKey: async () => ({}),
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
    portalFee: null,
    portalFeeSymbol: 'COTI',
    podInboxFee: null,
    l1GasFee: null,
    isPodChain: false,
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

    const merged = mergeCotiPluginSlices(slices);
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
    let legacy: ReturnType<typeof useCotiPluginContext> | null = null;
    let wallet: ReturnType<typeof useCotiWallet> | null = null;
    let network: ReturnType<typeof useCotiNetwork> | null = null;

    function Probe() {
      legacy = useCotiPluginContext();
      wallet = useCotiWallet();
      network = useCotiNetwork();
      useCotiUnlock();
      useCotiTokens();
      useCotiSwap();
      useCotiPod();
      useCotiModals();
      return null;
    }

    render(
      <CotiPluginProvider features={['tokens', 'portal', 'pod']}>
        <Probe />
      </CotiPluginProvider>,
    );

    expect(legacy).not.toBeNull();
    expect(wallet!.isConnected).toBe(legacy!.isConnected);
    expect(network!.chainId).toBe(legacy!.chainId);
    expect(network!.COTI_TESTNET_ID).toBe('7082400');

    h.wagmi.address = '0xabc1234567890123456789012345678901234567';
    h.wagmi.isConnected = true;

    await act(async () => {
      render(
        <CotiPluginProvider features={['tokens', 'portal', 'pod']}>
          <Probe />
        </CotiPluginProvider>,
      );
    });
  });

  it('sets metamaskDetected when wagmi connects via a MetaMask connector', async () => {
    let wallet: ReturnType<typeof useCotiWallet> | null = null;

    function Probe() {
      wallet = useCotiWallet();
      return null;
    }

    h.wagmi.address = '0xabc1234567890123456789012345678901234567';
    h.wagmi.isConnected = true;
    h.wagmi.connector = { id: 'io.metamask', name: 'MetaMask' };

    await act(async () => {
      render(
        <CotiPluginProvider features={['tokens', 'portal', 'pod']}>
          <Probe />
        </CotiPluginProvider>,
      );
    });

    expect(wallet!.metamaskDetected).toBe(true);
  });

  it('clears metamaskDetected for non-MetaMask wagmi connectors', async () => {
    let wallet: ReturnType<typeof useCotiWallet> | null = null;

    function Probe() {
      wallet = useCotiWallet();
      return null;
    }

    h.wagmi.address = '0xabc1234567890123456789012345678901234567';
    h.wagmi.isConnected = true;
    h.wagmi.connector = { id: 'walletConnect', name: 'WalletConnect' };

    await act(async () => {
      render(
        <CotiPluginProvider features={['tokens', 'portal', 'pod']}>
          <Probe />
        </CotiPluginProvider>,
      );
    });

    expect(wallet!.metamaskDetected).toBe(false);
  });

  it('sets metamaskDetected after explicit MetaMask handleConnect', async () => {
    let wallet: ReturnType<typeof useCotiWallet> | null = null;

    function Probe() {
      wallet = useCotiWallet();
      return null;
    }

    render(
      <CotiPluginProvider features={['tokens', 'portal', 'pod']}>
        <Probe />
      </CotiPluginProvider>,
    );

    expect(wallet!.metamaskDetected).toBe(false);

    await act(async () => {
      await wallet!.handleConnect();
    });

    expect(wallet!.metamaskDetected).toBe(true);
  });

  it('does not set metamaskDetected when connectWallet returns false', async () => {
    let wallet: ReturnType<typeof useCotiWallet> | null = null;

    function Probe() {
      wallet = useCotiWallet();
      return null;
    }

    h.connectWallet.mockResolvedValueOnce(false);

    render(
      <CotiPluginProvider features={['tokens', 'portal', 'pod']}>
        <Probe />
      </CotiPluginProvider>,
    );

    await act(async () => {
      await wallet!.handleConnect();
    });

    expect(wallet!.metamaskDetected).toBe(false);
  });

  it('does not set metamaskDetected from handleConnect when wagmi manages the session', async () => {
    let wallet: ReturnType<typeof useCotiWallet> | null = null;

    function Probe() {
      wallet = useCotiWallet();
      return null;
    }

    h.wagmi.address = '0xabc1234567890123456789012345678901234567';
    h.wagmi.isConnected = true;
    h.wagmi.connector = { id: 'walletConnect', name: 'WalletConnect' };

    await act(async () => {
      render(
        <CotiPluginProvider features={['tokens', 'portal', 'pod']}>
          <Probe />
        </CotiPluginProvider>,
      );
    });

    expect(wallet!.metamaskDetected).toBe(false);

    await act(async () => {
      await wallet!.handleConnect();
    });

    expect(wallet!.metamaskDetected).toBe(false);
  });

  it('clears metamaskDetected on wagmi disconnect via connector effect (WAG-01)', async () => {
    let wallet: ReturnType<typeof useCotiWallet> | null = null;

    function Probe() {
      wallet = useCotiWallet();
      return null;
    }

    h.wagmi.address = '0xabc1234567890123456789012345678901234567';
    h.wagmi.isConnected = true;
    h.wagmi.connector = { id: 'io.metamask', name: 'MetaMask' };

    const { rerender } = render(
      <CotiPluginProvider features={['tokens', 'portal', 'pod']}>
        <Probe />
      </CotiPluginProvider>,
    );

    await act(async () => {
      rerender(
        <CotiPluginProvider features={['tokens', 'portal', 'pod']}>
          <Probe />
        </CotiPluginProvider>,
      );
    });
    expect(wallet!.metamaskDetected).toBe(true);

    h.wagmi.isConnected = false;
    h.wagmi.address = undefined;
    h.wagmi.connector = undefined;

    await act(async () => {
      rerender(
        <CotiPluginProvider features={['tokens', 'portal', 'pod']}>
          <Probe />
        </CotiPluginProvider>,
      );
    });

    expect(wallet!.metamaskDetected).toBe(false);
  });
});

describe('CotiPluginProvider default (core only)', () => {
  beforeEach(() => {
    h.wagmi.address = undefined;
    h.wagmi.isConnected = false;
    h.wagmi.chainId = 7082400;
    h.wagmi.connector = undefined;
  });

  it('does not mount swap/fee APIs and leaves token lists empty', () => {
    let swap: ReturnType<typeof useCotiSwap> | null = null;
    let tokens: ReturnType<typeof useCotiTokens> | null = null;
    let pod: ReturnType<typeof useCotiPod> | null = null;

    function Probe() {
      swap = useCotiSwap();
      tokens = useCotiTokens();
      pod = useCotiPod();
      return null;
    }

    render(
      <CotiPluginProvider>
        <Probe />
      </CotiPluginProvider>,
    );

    expect(tokens!.publicTokens).toEqual([]);
    expect(tokens!.privateTokens).toEqual([]);
    expect(pod!.podRequests).toEqual([]);
    expect(() => swap!.handleSwap()).toThrow(/"portal"/);
  });
});
