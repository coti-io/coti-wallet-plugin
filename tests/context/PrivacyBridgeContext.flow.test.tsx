import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act } from '@testing-library/react';
import { SEPOLIA_CHAIN_ID, type PodPortalRequest } from '../../src/contracts/pod';
import { muteChainUpdates, unmuteChainUpdates } from '../../src/lib/chainMute';
import { MULTIPLE_WALLETS_ERROR_SUBSTRING } from '../../src/utils/walletErrors';
import { podRequestsStorageKey } from '../../src/pod/podPortalRequestsStorage';
import { logger } from '../../src/lib/logger';
import { configureCotiPlugin } from '../../src/config/plugin';
import { CotiErrorCode } from '../../src/errors';

// ─── Capturing mock state ────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  wagmi: {
    address: undefined as string | undefined,
    isConnected: false,
    chainId: 7082400,
    connector: undefined as
      | {
          id?: string;
          name?: string;
          getProvider?: () => Promise<unknown>;
        }
      | undefined,
  },
  disconnect: vi.fn(),
  metamask: {
    onAccountChanged: null as ((account: string) => Promise<void>) | null,
    onSnapCheck: null as ((account: string) => Promise<void>) | null,
    connectWallet: vi.fn(),
    switchNetwork: vi.fn(async () => true),
    registerEthereumInitializedListener: vi.fn(),
    chainId: '7082400',
  },
  snap: {
    setSnapError: null as ((err: string | null) => void) | null,
    isSnapInstalled: vi.fn().mockResolvedValue(false),
    executeSnapCheck: vi.fn(async (cb?: () => Promise<boolean>) => {
      if (cb) await cb();
      return true;
    }),
    handleManualOnboarding: vi.fn(async () => null as string | null),
    handleKeyVerification: vi.fn(async () => undefined),
    clearSnapCache: vi.fn(),
    connectToSnap: vi.fn(async () => false),
    requestSnapConnection: vi.fn(async () => false),
    hasAesKeyInSnap: vi.fn(async () => false as boolean | null),
  },
  balanceUpdater: {
    updateAccountState: vi.fn(async (account: string, _hasSnap: boolean, fetchPrivate?: boolean) => {
      h.balanceUpdater.lastAccount = account;
      h.balanceUpdater.params?.setWalletAddress(account);
      h.balanceUpdater.params?.setIsConnected(true);
      if (fetchPrivate) {
        await h.balanceUpdater.params?.getAESKeyFromSnap(account);
      }
      return true;
    }),
    params: null as null | Record<string, (...args: unknown[]) => unknown>,
    lastAccount: '',
  },
  aesKeyProvider: {
    getAesKey: vi.fn(async () => null as string | null),
  },
  privacyBridge: {
    upsertPodRequest: null as ((request: PodPortalRequest) => void) | null,
  },
  resolvePodStatus: vi.fn(async () => null as unknown),
  wagmiBump: null as (() => void) | null,
}));

vi.mock('wagmi', () => ({
  useAccount: () => {
    const [, setTick] = React.useState(0);
    React.useEffect(() => {
      h.wagmiBump = () => setTick(t => t + 1);
      return () => {
        h.wagmiBump = null;
      };
    }, []);
    return h.wagmi;
  },
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
    h.wagmiBump?.();
  }),
}));

vi.mock('../../src/hooks/useMetamask', () => ({
  useMetamask: (opts?: {
    onAccountChanged?: (account: string) => Promise<void>;
    onSnapCheck?: (account: string) => Promise<void>;
  }) => {
    h.metamask.onAccountChanged = opts?.onAccountChanged ?? null;
    h.metamask.onSnapCheck = opts?.onSnapCheck ?? null;
    return {
      connectWallet: h.metamask.connectWallet,
      checkNetwork: vi.fn(async () => true),
      switchNetwork: h.metamask.switchNetwork,
      networkName: 'COTI Testnet',
      COTI_MAINNET_ID: '0x282b34',
      COTI_TESTNET_ID: '0x6c11a0',
      SEPOLIA_ID: '0xaa36a7',
      chainId: h.metamask.chainId,
      registerEthereumInitializedListener: h.metamask.registerEthereumInitializedListener,
    };
  },
}));

vi.mock('../../src/hooks/useSnap', () => ({
  useSnap: (setSnapError?: (err: string | null) => void) => {
    h.snap.setSnapError = setSnapError ?? null;
    return {
      isSnapInstalled: h.snap.isSnapInstalled,
      executeSnapCheck: h.snap.executeSnapCheck,
      getAESKeyFromSnap: vi.fn(async () => null),
      hasAesKeyInSnap: h.snap.hasAesKeyInSnap,
      saveAESKeyToSnap: vi.fn(async () => undefined),
      connectToSnap: h.snap.connectToSnap,
      requestSnapConnection: h.snap.requestSnapConnection,
      handleManualOnboarding: h.snap.handleManualOnboarding,
      handleKeyVerification: h.snap.handleKeyVerification,
      clearSnapCache: h.snap.clearSnapCache,
    };
  },
}));

vi.mock('../../src/hooks/useWalletType', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/hooks/useWalletType')>();
  return {
    ...actual,
    useWalletType: () => ({ walletType: 'metamask', isMetaMaskWithSnap: true, connectorId: 'io.metamask' }),
  };
});

vi.mock('../../src/hooks/useAesKeyProvider', () => ({
  useAesKeyProvider: () => ({ getAesKey: h.aesKeyProvider.getAesKey }),
}));

vi.mock('../../src/hooks/usePrivateTokenBalance', () => ({
  usePrivateTokenBalance: () => ({ fetchPrivateBalance: vi.fn(async () => '0') }),
}));

vi.mock('../../src/hooks/useBalanceUpdater', () => ({
  useBalanceUpdater: (params: Record<string, (...args: unknown[]) => unknown>) => {
    h.balanceUpdater.params = params;
    return { updateAccountState: h.balanceUpdater.updateAccountState };
  },
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

vi.mock('../../src/hooks/usePrivacyBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/hooks/usePrivacyBridge')>();
  return {
    ...actual,
    usePrivacyBridge: vi.fn((params: { upsertPodRequest?: (r: PodPortalRequest) => void }) => {
      h.privacyBridge.upsertPodRequest = params.upsertPodRequest ?? null;
      return {
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
      };
    }),
  };
});

vi.mock('../../src/chains/portal/podRequestStatus', () => ({
  resolvePodRequestStatus: (...args: unknown[]) => h.resolvePodStatus(...(args as [])),
}));

import {
  PrivacyBridgeProvider,
  usePrivacyBridgeContext,
} from '../../src/context/PrivacyBridgeContext';

type Ctx = ReturnType<typeof usePrivacyBridgeContext>;
const reqMock = window.ethereum!.request as unknown as ReturnType<typeof vi.fn>;

const WALLET_A = '0x1111111111111111111111111111111111111111';
const WALLET_B = '0x2222222222222222222222222222222222222222';

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
      </PrivacyBridgeProvider>,
    );
  });
  return latest as Ctx;
}

async function connectWagmi(address = WALLET_A, chainId = 7082400) {
  h.wagmi.address = address;
  h.wagmi.isConnected = true;
  h.wagmi.chainId = chainId;
  h.disconnect.mockImplementation(() => {
    h.wagmi.isConnected = false;
    h.wagmi.address = undefined;
    h.wagmiBump?.();
  });
  await renderProvider();
}

async function bumpWagmi() {
  await act(async () => {
    h.wagmiBump?.();
  });
}

function makePodRequest(overrides: Partial<PodPortalRequest> = {}): PodPortalRequest {
  return {
    id: 'pod-req-1',
    wallet: WALLET_A,
    kind: 'deposit',
    chainId: SEPOLIA_CHAIN_ID,
    sourceTxHash: '0xsource',
    token: 'p.MTT',
    amount: '1',
    status: 'pod-pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('PrivacyBridgeContext (flow coverage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureCotiPlugin({ clearSessionKeyOnWagmiDisconnect: false });
    localStorage.clear();
    unmuteChainUpdates();
    reqMock.mockReset();
    reqMock.mockResolvedValue(undefined);

    h.wagmi.address = undefined;
    h.wagmi.isConnected = false;
    h.wagmi.chainId = 7082400;
    h.wagmi.connector = undefined;

    h.metamask.chainId = '7082400';
    h.metamask.onAccountChanged = null;
    h.metamask.onSnapCheck = null;
    h.metamask.connectWallet.mockImplementation(async (onConnect: (a: string) => Promise<void>) => {
      await onConnect(WALLET_A);
      return true;
    });
    h.metamask.switchNetwork.mockResolvedValue(true);
    h.metamask.registerEthereumInitializedListener.mockReset();

    h.snap.executeSnapCheck.mockImplementation(async (cb?: () => Promise<boolean>) => {
      if (cb) await cb();
      return true;
    });
    h.snap.handleManualOnboarding.mockResolvedValue(null);
    h.snap.clearSnapCache.mockReset();
    h.snap.hasAesKeyInSnap.mockResolvedValue(false);

    h.balanceUpdater.updateAccountState.mockImplementation(async (account: string, _hasSnap: boolean, fetchPrivate?: boolean) => {
      h.balanceUpdater.params?.setWalletAddress(account);
      h.balanceUpdater.params?.setIsConnected(true);
      if (fetchPrivate) {
        await h.balanceUpdater.params?.getAESKeyFromSnap(account);
      }
      return true;
    });
    h.balanceUpdater.params = null;

    h.aesKeyProvider.getAesKey.mockResolvedValue(null);
    h.resolvePodStatus.mockResolvedValue(null);
    h.privacyBridge.upsertPodRequest = null;

    Object.defineProperty(window, 'ethereum', {
      value: {
        request: reqMock,
        on: vi.fn(),
        removeListener: vi.fn(),
        isMetaMask: true,
      },
      writable: true,
      configurable: true,
    });

    latest = null;
  });

  afterEach(() => {
    unmuteChainUpdates();
    vi.useRealTimers();
  });

  // ─── snapError modal effect ───────────────────────────────────────────────
  it('opens showSnapMissingModal when snapError is set via useSnap callback', async () => {
    await renderProvider();
    act(() => {
      h.snap.setSnapError?.('Snap missing');
    });
    expect(latest!.showSnapMissingModal).toBe(true);
  });

  // ─── unhandledrejection multiple wallets ──────────────────────────────────
  it('shows multiple wallets modal on unhandledrejection with conflict message', async () => {
    await renderProvider();
    const reason = new Error(MULTIPLE_WALLETS_ERROR_SUBSTRING);
    await act(async () => {
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: Promise.resolve(),
          reason,
        }),
      );
    });
    expect(latest!.showMultipleWalletsModal).toBe(true);
  });

  it('ignores unhandledrejection with unrelated errors', async () => {
    await renderProvider();
    await act(async () => {
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: Promise.resolve(),
          reason: new Error('other'),
        }),
      );
    });
    expect(latest!.showMultipleWalletsModal).toBe(false);
  });

  it('shows multiple wallets modal when rejection reason is a plain string', async () => {
    await renderProvider();
    await act(async () => {
      window.dispatchEvent(
        new PromiseRejectionEvent('unhandledrejection', {
          promise: Promise.resolve(),
          reason: MULTIPLE_WALLETS_ERROR_SUBSTRING,
        }),
      );
    });
    expect(latest!.showMultipleWalletsModal).toBe(true);
  });

  // ─── handleConnect ─────────────────────────────────────────────────────────
  describe('handleConnect', () => {
    it('connects via MetaMask and updates account state', async () => {
      const ctx = await renderProvider();
      await act(async () => {
        await ctx.handleConnect();
      });
      expect(h.metamask.connectWallet).toHaveBeenCalled();
      expect(h.balanceUpdater.updateAccountState).toHaveBeenCalledWith(WALLET_A, false, false);
      expect(latest!.isConnected).toBe(true);
    });

    it('shows multiple wallets modal when connect throws conflict error', async () => {
      h.metamask.connectWallet.mockRejectedValueOnce(new Error(MULTIPLE_WALLETS_ERROR_SUBSTRING));
      const ctx = await renderProvider();
      await act(async () => {
        await ctx.handleConnect();
      });
      expect(latest!.showMultipleWalletsModal).toBe(true);
    });

    it('registers ethereum initialized listener on METAMASK_NOT_INSTALLED', async () => {
      h.metamask.connectWallet.mockRejectedValueOnce(new Error('METAMASK_NOT_INSTALLED'));
      const ctx = await renderProvider();
      await act(async () => {
        await ctx.handleConnect();
      });
      expect(latest!.showInstallModal).toBe(true);
      expect(h.metamask.registerEthereumInitializedListener).toHaveBeenCalled();
    });

    it('auto-connects when MetaMask injects after install modal', async () => {
      h.metamask.connectWallet
        .mockRejectedValueOnce(new Error('METAMASK_NOT_INSTALLED'))
        .mockImplementationOnce(async (onConnect: (a: string) => Promise<void>) => {
          await onConnect(WALLET_A);
        });
      const ctx = await renderProvider();
      await act(async () => {
        await ctx.handleConnect();
      });
      const listener = h.metamask.registerEthereumInitializedListener.mock.calls[0][0] as () => void;
      await act(async () => {
        listener();
      });
      expect(latest!.showInstallModal).toBe(false);
      expect(latest!.isConnected).toBe(true);
    });

    it('returns early when ethereum is missing and listener already registered', async () => {
      h.metamask.connectWallet.mockRejectedValueOnce(new Error('METAMASK_NOT_INSTALLED'));
      const ctx = await renderProvider();
      await act(async () => {
        await ctx.handleConnect();
      });
      const calls = h.metamask.registerEthereumInitializedListener.mock.calls.length;

      Object.defineProperty(window, 'ethereum', {
        value: undefined,
        writable: true,
        configurable: true,
      });
      await act(async () => {
        await ctx.handleConnect();
      });
      expect(h.metamask.registerEthereumInitializedListener.mock.calls.length).toBe(calls);
    });
  });

  // ─── onAccountChanged / onSnapCheck ───────────────────────────────────────
  describe('MetaMask callbacks', () => {
    it('ignores onAccountChanged when wagmi manages the connection', async () => {
      await connectWagmi();
      const callsBefore = h.balanceUpdater.updateAccountState.mock.calls.length;
      await act(async () => {
        await h.metamask.onAccountChanged?.(WALLET_B);
      });
      expect(h.balanceUpdater.updateAccountState.mock.calls.length).toBe(callsBefore);
    });

    it('ignores onAccountChanged until explicit MetaMask connect', async () => {
      await renderProvider();
      await act(async () => {
        await h.metamask.onAccountChanged?.(WALLET_A);
      });
      expect(h.balanceUpdater.updateAccountState).not.toHaveBeenCalled();
    });

    it('skips onAccountChanged when account is unchanged', async () => {
      const ctx = await renderProvider();
      await act(async () => {
        await ctx.handleConnect();
      });
      const callsBefore = h.balanceUpdater.updateAccountState.mock.calls.length;
      await act(async () => {
        await h.metamask.onAccountChanged?.(WALLET_A);
      });
      expect(h.balanceUpdater.updateAccountState.mock.calls.length).toBe(callsBefore);
    });

    it('clears session and updates state on account change after MetaMask connect', async () => {
      const ctx = await renderProvider();
      await act(async () => {
        await ctx.handleConnect();
      });
      h.balanceUpdater.params?.setSessionAesKey('a'.repeat(32), WALLET_A);
      h.balanceUpdater.updateAccountState.mockClear();

      await act(async () => {
        await h.metamask.onAccountChanged?.(WALLET_B);
      });
      expect(latest!.sessionAesKey).toBeNull();
      expect(h.balanceUpdater.updateAccountState).toHaveBeenCalledWith(WALLET_B, false, false);
    });

    it('runs onSnapCheck after explicit MetaMask connect', async () => {
      const ctx = await renderProvider();
      await act(async () => {
        await ctx.handleConnect();
      });
      h.balanceUpdater.updateAccountState.mockClear();
      await act(async () => {
        await h.metamask.onSnapCheck?.(WALLET_A);
      });
      expect(h.snap.executeSnapCheck).toHaveBeenCalled();
      expect(h.balanceUpdater.updateAccountState).toHaveBeenCalledWith(WALLET_A, true, false);
    });

    it('ignores onSnapCheck when wagmi is connected', async () => {
      await connectWagmi();
      h.snap.executeSnapCheck.mockClear();
      await act(async () => {
        await h.metamask.onSnapCheck?.(WALLET_A);
      });
      expect(h.snap.executeSnapCheck).not.toHaveBeenCalled();
    });

    it('ignores onSnapCheck until explicit MetaMask connect', async () => {
      await renderProvider();
      await act(async () => {
        await h.metamask.onSnapCheck?.(WALLET_A);
      });
      expect(h.snap.executeSnapCheck).not.toHaveBeenCalled();
    });
  });

  // ─── wagmi sync effects ───────────────────────────────────────────────────
  describe('wagmi sync', () => {
    it('syncs RainbowKit connection and checks Snap for MetaMask connector', async () => {
      h.wagmi.connector = { id: 'io.metamask', name: 'MetaMask' };
      await connectWagmi();
      expect(latest!.walletAddress).toBe(WALLET_A);
      expect(h.snap.isSnapInstalled).toHaveBeenCalled();
    });

    it('clears context when wagmi disconnects after sync', async () => {
      await connectWagmi();
      h.wagmi.isConnected = false;
      h.wagmi.address = undefined;
      await bumpWagmi();
      expect(latest!.isConnected).toBe(false);
      expect(latest!.walletAddress).toBe('');
    });

    it('preserves session key record on wagmi disconnect by default', async () => {
      await connectWagmi();
      await act(async () => {
        h.balanceUpdater.params?.setSessionAesKey('h'.repeat(32), WALLET_A);
      });
      h.wagmi.isConnected = false;
      h.wagmi.address = undefined;
      await bumpWagmi();
      expect(h.snap.clearSnapCache).not.toHaveBeenCalled();

      h.wagmi.address = WALLET_A;
      h.wagmi.isConnected = true;
      await bumpWagmi();
      expect(latest!.sessionAesKey).toBe('h'.repeat(32));
    });

    it('clears session key and snap cache on wagmi disconnect when configured', async () => {
      configureCotiPlugin({ clearSessionKeyOnWagmiDisconnect: true });
      await connectWagmi();
      await act(async () => {
        h.balanceUpdater.params?.setSessionAesKey('h'.repeat(32), WALLET_A);
      });
      h.snap.clearSnapCache.mockClear();
      h.wagmi.isConnected = false;
      h.wagmi.address = undefined;
      await bumpWagmi();
      expect(h.snap.clearSnapCache).toHaveBeenCalled();

      h.wagmi.address = WALLET_A;
      h.wagmi.isConnected = true;
      await bumpWagmi();
      expect(latest!.sessionAesKey).toBeNull();
    });

    it('handles wagmi account switch while connected', async () => {
      await connectWagmi(WALLET_A);
      h.balanceUpdater.updateAccountState.mockClear();
      h.snap.clearSnapCache.mockClear();
      h.wagmi.address = WALLET_B;
      await bumpWagmi();
      expect(h.snap.clearSnapCache).toHaveBeenCalled();
      expect(h.balanceUpdater.updateAccountState).toHaveBeenCalledWith(
        WALLET_B,
        false,
        false,
        undefined,
        7082400,
      );
    });

    it('refreshes balances when wagmi chain changes', async () => {
      await connectWagmi(WALLET_A, 7082400);
      h.balanceUpdater.updateAccountState.mockClear();
      h.wagmi.chainId = 2632500;
      await bumpWagmi();
      expect(h.balanceUpdater.updateAccountState).toHaveBeenCalledWith(
        WALLET_A,
        false,
        true,
        undefined,
        2632500,
      );
    });

    it('ignores wagmi chain change when chain updates are muted', async () => {
      await connectWagmi(WALLET_A, 7082400);
      h.balanceUpdater.updateAccountState.mockClear();
      muteChainUpdates();
      h.wagmi.chainId = 2632500;
      await bumpWagmi();
      expect(h.balanceUpdater.updateAccountState).not.toHaveBeenCalled();
    });

    it('uses wagmi chainId as effective chainId when connected', async () => {
      h.wagmi.chainId = 11155111;
      await connectWagmi(WALLET_A, 11155111);
      expect(latest!.chainId).toBe('11155111');
    });
  });

  // ─── switchNetworkViaWagmiProvider ────────────────────────────────────────
  describe('switchNetwork (wagmi provider path)', () => {
    beforeEach(async () => {
      h.wagmi.connector = { id: 'io.metamask', name: 'MetaMask' };
      await connectWagmi();
    });

    it('returns false when no wagmi connector is available', async () => {
      h.wagmi.connector = undefined;
      await bumpWagmi();
      const ok = await latest!.switchNetwork('0x6c11a0');
      expect(ok).toBe(false);
    });

    it('returns false when getProvider throws', async () => {
      h.wagmi.connector = {
        getProvider: vi.fn(async () => {
          throw new Error('no provider');
        }),
      };
      await bumpWagmi();
      expect(await latest!.switchNetwork('0x6c11a0')).toBe(false);
    });

    it('returns false when provider has no request method', async () => {
      h.wagmi.connector = { getProvider: vi.fn(async () => ({})) };
      await bumpWagmi();
      expect(await latest!.switchNetwork('0x6c11a0')).toBe(false);
    });

    it('switches network successfully via wallet_switchEthereumChain', async () => {
      const providerRequest = vi.fn(async () => undefined);
      h.wagmi.connector = { getProvider: vi.fn(async () => ({ request: providerRequest })) };
      await bumpWagmi();
      expect(await latest!.switchNetwork('0x6c11a0')).toBe(true);
      expect(providerRequest).toHaveBeenCalledWith({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x6c11a0' }],
      });
    });

    it('adds chain on 4902 when network config exists', async () => {
      const providerRequest = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('unknown chain'), { code: 4902 }))
        .mockResolvedValueOnce(undefined);
      h.wagmi.connector = { getProvider: vi.fn(async () => ({ request: providerRequest })) };
      await bumpWagmi();
      expect(await latest!.switchNetwork('0x6c11a0')).toBe(true);
      expect(providerRequest).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'wallet_addEthereumChain' }),
      );
    });

    it('returns false on 4902 when no network config exists', async () => {
      const providerRequest = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('unknown chain'), { code: 4902 }));
      h.wagmi.connector = { getProvider: vi.fn(async () => ({ request: providerRequest })) };
      await bumpWagmi();
      expect(await latest!.switchNetwork('0xdeadbeef')).toBe(false);
    });

    it('returns false when wallet_addEthereumChain fails', async () => {
      const providerRequest = vi
        .fn()
        .mockRejectedValueOnce(Object.assign(new Error('unknown chain'), { code: 4902 }))
        .mockRejectedValueOnce(new Error('user rejected add'));
      h.wagmi.connector = { getProvider: vi.fn(async () => ({ request: providerRequest })) };
      await bumpWagmi();
      expect(await latest!.switchNetwork('0x6c11a0')).toBe(false);
    });

    it('returns false on non-4902 switch failure', async () => {
      const providerRequest = vi.fn().mockRejectedValueOnce(new Error('user rejected'));
      h.wagmi.connector = { getProvider: vi.fn(async () => ({ request: providerRequest })) };
      await bumpWagmi();
      expect(await latest!.switchNetwork('0x6c11a0')).toBe(false);
    });
  });

  it('routes switchNetwork to useMetamask when not synced via wagmi', async () => {
    await renderProvider();
    await act(async () => {
      await latest!.switchNetwork('0x6c11a0');
    });
    expect(h.metamask.switchNetwork).toHaveBeenCalledWith('0x6c11a0');
  });

  // ─── session AES / onboard / unlock ───────────────────────────────────────
  describe('AES key flows', () => {
    it('handleOnboard stores session key when onboarding succeeds', async () => {
      h.snap.handleManualOnboarding.mockResolvedValue('B'.repeat(32));
      await connectWagmi();
      await act(async () => {
        const key = await latest!.handleOnboard();
        expect(key).toBe('B'.repeat(32));
      });
      expect(latest!.sessionAesKey).toBe('B'.repeat(32));
    });

    it('sessionAesKey effect refreshes account state and sets hasSnap', async () => {
      await connectWagmi();
      h.balanceUpdater.updateAccountState.mockClear();
      act(() => {
        latest!.lockPrivateBalances();
      });
      await act(async () => {
        h.balanceUpdater.params?.setSessionAesKey('d'.repeat(32), WALLET_A);
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(h.balanceUpdater.updateAccountState).toHaveBeenCalled();
    });

    it('warns and clears when setSessionAesKey is called without a wallet', async () => {
      await renderProvider();
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      act(() => {
        h.balanceUpdater.params?.setSessionAesKey('e'.repeat(32));
      });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('no wallet'));
      warnSpy.mockRestore();
    });

    it('returns session key from getAESKeyForCurrentNetwork when already set', async () => {
      await connectWagmi();
      await act(async () => {
        h.balanceUpdater.params?.setSessionAesKey('f'.repeat(32), WALLET_A);
      });
      h.aesKeyProvider.getAesKey.mockClear();
      await act(async () => {
        await latest!.refreshPrivateBalances();
      });
      expect(h.aesKeyProvider.getAesKey).not.toHaveBeenCalled();
    });

    it('uses cached session key on manual-aes-key chains before provider lookup', async () => {
      h.wagmi.chainId = 11155111;
      h.metamask.chainId = '11155111';
      await connectWagmi(WALLET_A, 11155111);
      await act(async () => {
        h.balanceUpdater.params?.setSessionAesKey('h'.repeat(32), WALLET_A);
      });
      h.aesKeyProvider.getAesKey.mockClear();
      await act(async () => {
        await latest!.refreshPrivateBalances();
      });
      expect(h.aesKeyProvider.getAesKey).not.toHaveBeenCalled();
    });

    it('saveManualAesKey passes wagmi chain override when update succeeds', async () => {
      reqMock.mockResolvedValue('0x' + 'ab'.repeat(65));
      await connectWagmi(WALLET_A, 11155111);
      await act(async () => {
        await latest!.saveManualAesKey('A'.repeat(32));
      });
      expect(h.balanceUpdater.updateAccountState).toHaveBeenCalledWith(
        WALLET_A,
        true,
        true,
        expect.any(String),
        11155111,
      );
    });

    it('returns null sessionAesKey when the bound wallet does not match', async () => {
      await connectWagmi(WALLET_A);
      await act(async () => {
        h.balanceUpdater.params?.setSessionAesKey('k'.repeat(32), WALLET_A);
      });
      act(() => {
        h.balanceUpdater.params?.setWalletAddress(WALLET_B);
      });
      expect(latest!.sessionAesKey).toBeNull();
    });

    it('handleOnboard returns key without storing session when wallet is disconnected', async () => {
      h.snap.handleManualOnboarding.mockResolvedValue('z'.repeat(32));
      await renderProvider();
      let key: string | null = null;
      await act(async () => {
        key = await latest!.handleOnboard();
      });
      expect(key).toBe('z'.repeat(32));
      expect(latest!.sessionAesKey).toBeNull();
    });

    it('sessionAesKey effect keeps hasSnap when snap is already active', async () => {
      await connectWagmi();
      act(() => {
        h.balanceUpdater.params?.setHasSnap(true);
      });
      await act(async () => {
        h.balanceUpdater.params?.setSessionAesKey('d'.repeat(32), WALLET_A);
      });
      expect(latest!.hasSnap).toBe(true);
    });
  });

  // ─── refreshPrivateBalances error paths ───────────────────────────────────
  describe('refreshPrivateBalances', () => {
    beforeEach(async () => {
      await connectWagmi();
    });

    it('throws SNAP_REQUIRED on SNAP_CONNECT_FAILED', async () => {
      h.balanceUpdater.updateAccountState.mockRejectedValueOnce(new Error('SNAP_CONNECT_FAILED'));
      await expect(latest!.refreshPrivateBalances()).rejects.toMatchObject({
        code: CotiErrorCode.SNAP_REQUIRED,
      });
    });

    it('returns false when user rejects (4001)', async () => {
      const err = Object.assign(new Error('User rejected'), { code: 4001 });
      h.balanceUpdater.updateAccountState.mockRejectedValueOnce(err);
      await expect(latest!.refreshPrivateBalances()).resolves.toBe(false);
    });

    it('rethrows SNAP_DIALOG_REJECTED', async () => {
      h.balanceUpdater.updateAccountState.mockRejectedValueOnce(new Error('SNAP_DIALOG_REJECTED'));
      await expect(latest!.refreshPrivateBalances()).rejects.toMatchObject({
        code: CotiErrorCode.SNAP_DIALOG_REJECTED,
      });
    });

    it('throws ACCOUNT_NOT_ONBOARDED on ACCOUNT_NOT_ONBOARDED', async () => {
      h.balanceUpdater.updateAccountState.mockRejectedValueOnce(new Error('ACCOUNT_NOT_ONBOARDED'));
      await act(async () => {
        await expect(latest!.refreshPrivateBalances()).rejects.toMatchObject({
          code: CotiErrorCode.ACCOUNT_NOT_ONBOARDED,
        });
      });
      expect(h.snap.clearSnapCache).toHaveBeenCalled();
    });

    it('throws AES_KEY_MISMATCH on onboarding-related errors', async () => {
      h.balanceUpdater.updateAccountState.mockRejectedValueOnce(new Error('AES key mismatch during onboarding'));
      await expect(latest!.refreshPrivateBalances()).rejects.toMatchObject({
        code: CotiErrorCode.AES_KEY_MISMATCH,
      });
    });

    it('does not onboard blindly when Snap AES key check is unknown', async () => {
      h.balanceUpdater.updateAccountState.mockClear();
      h.snap.isSnapInstalled.mockResolvedValue(true);
      h.snap.hasAesKeyInSnap.mockResolvedValue(null);

      await expect(latest!.refreshPrivateBalances()).rejects.toMatchObject({
        code: CotiErrorCode.SNAP_KEY_CHECK_FAILED,
        message: 'Could not check Snap AES key.',
      });

      expect(h.snap.hasAesKeyInSnap).toHaveBeenCalledTimes(2);
      expect(h.balanceUpdater.updateAccountState).not.toHaveBeenCalled();
    });

    it('does not error when Snap is not installed and key probe is unavailable', async () => {
      h.balanceUpdater.updateAccountState.mockClear();
      h.snap.isSnapInstalled.mockResolvedValue(false);
      h.snap.hasAesKeyInSnap.mockResolvedValue(null);

      await expect(latest!.refreshPrivateBalances()).resolves.toBe(true);
      expect(h.snap.hasAesKeyInSnap).not.toHaveBeenCalled();
      expect(h.balanceUpdater.updateAccountState).toHaveBeenCalled();
    });

    it('returns false on generic errors', async () => {
      h.balanceUpdater.updateAccountState.mockRejectedValueOnce(new Error('rpc down'));
      await expect(latest!.refreshPrivateBalances()).resolves.toBe(false);
    });

    it('clears snapError on successful refresh', async () => {
      act(() => h.snap.setSnapError?.('old error'));
      await act(async () => {
        await latest!.refreshPrivateBalances();
      });
      expect(latest!.snapError).toBeNull();
    });

    it('returns false without unlocking when updateAccountState fails softly', async () => {
      await connectWagmi();
      h.balanceUpdater.updateAccountState.mockResolvedValue(false);
      await expect(latest!.refreshPrivateBalances()).resolves.toBe(false);
      expect(latest!.isPrivateUnlocked).toBe(false);
    });

    it('does not retry forced contract onboarding after a soft failure', async () => {
      h.balanceUpdater.updateAccountState.mockClear();
      h.balanceUpdater.updateAccountState.mockResolvedValue(false);

      await expect(
        latest!.refreshPrivateBalances({ forceContractOnboarding: true }),
      ).resolves.toBe(false);

      expect(h.balanceUpdater.updateAccountState).toHaveBeenCalledTimes(1);
      expect(h.balanceUpdater.updateAccountState).toHaveBeenCalledWith(
        WALLET_A,
        true,
        true,
        undefined,
        7082400,
        { validateOnUnlock: true, forceContractOnboarding: true },
      );
    });

    it('skips balance fetch and retry for restore-only onboard probe', async () => {
      h.balanceUpdater.updateAccountState.mockClear();
      h.snap.isSnapInstalled.mockResolvedValue(false);
      h.snap.hasAesKeyInSnap.mockResolvedValue(false);

      await expect(
        latest!.refreshPrivateBalances({ restoreOnly: true }),
      ).resolves.toBe(false);

      expect(h.balanceUpdater.updateAccountState).not.toHaveBeenCalled();
    });

    it('passes wagmi chain override during refresh when synced via RainbowKit', async () => {
      await connectWagmi(WALLET_A, 11155111);
      h.balanceUpdater.updateAccountState.mockClear();
      await act(async () => {
        await latest!.refreshPrivateBalances();
      });
      expect(h.balanceUpdater.updateAccountState).toHaveBeenCalledWith(
        WALLET_A,
        true,
        true,
        undefined,
        11155111,
        { validateOnUnlock: true, forceContractOnboarding: true },
      );
    });
  });

  // ─── disconnect / lock ────────────────────────────────────────────────────
  describe('handleDisconnect and lockPrivateBalances', () => {
    it('disconnects via forceWagmiSessionClear when a wagmi session exists', async () => {
      await connectWagmi();
      await act(async () => {
        await latest!.handleDisconnect();
      });
      expect(latest!.isConnected).toBe(false);
      expect(latest!.walletAddress).toBe('');
      expect(latest!.sessionAesKey).toBeNull();
      expect(h.snap.clearSnapCache).toHaveBeenCalled();
    });

    it('clears local session state when MetaMask-connected without wagmi', async () => {
      const ctx = await renderProvider();
      await act(async () => {
        await ctx.handleConnect();
      });
      h.wagmi.isConnected = false;
      await act(async () => {
        await latest!.handleDisconnect();
      });
      expect(latest!.isConnected).toBe(false);
      expect(latest!.walletAddress).toBe('');
    });

    it('lockPrivateBalances clears session and private token display', async () => {
      await connectWagmi();
      await act(async () => {
        h.balanceUpdater.params?.setSessionAesKey('g'.repeat(32), WALLET_A);
      });
      expect(latest!.sessionAesKey).toBe('g'.repeat(32));
      act(() => {
        latest!.lockPrivateBalances();
      });
      expect(latest!.sessionAesKey).toBeNull();
      expect(latest!.isPrivateUnlocked).toBe(false);
      expect(h.snap.clearSnapCache).not.toHaveBeenCalled();
    });
  });

  // ─── token reset effects ──────────────────────────────────────────────────
  describe('disconnect token reset', () => {
    it('skips token reset when chain updates are muted', async () => {
      await connectWagmi();
      const tokensBefore = latest!.publicTokens;
      muteChainUpdates();
      await act(async () => {
        await latest!.handleDisconnect();
      });
      // While muted, the reset effect should not run on isConnected=false
      expect(latest!.publicTokens).toEqual(tokensBefore);
    });

    it('resets private tokens when hasSnap becomes false while connected', async () => {
      await connectWagmi();
      act(() => {
        h.balanceUpdater.params?.setHasSnap(false);
      });
      expect(latest!.privateTokens.length).toBeGreaterThan(0);
    });
  });

  // ─── pod requests ─────────────────────────────────────────────────────────
  describe('pod request lifecycle', () => {
    it('loads pod requests when wallet address changes', async () => {
      const stored = [makePodRequest()];
      localStorage.setItem(podRequestsStorageKey(WALLET_A), JSON.stringify(stored));
      await connectWagmi();
      expect(latest!.podRequests).toHaveLength(1);
    });

    it('upserts pod requests via captured callback', async () => {
      await connectWagmi();
      const req = makePodRequest({ id: 'new-id' });
      act(() => {
        h.privacyBridge.upsertPodRequest?.(req);
      });
      expect(latest!.podRequests.some(r => r.id === 'new-id')).toBe(true);
    });

    it('updates existing pod request on upsert', async () => {
      await connectWagmi();
      const req = makePodRequest({ id: 'dup', status: 'pod-pending' });
      act(() => {
        h.privacyBridge.upsertPodRequest?.(req);
        h.privacyBridge.upsertPodRequest?.({ ...req, status: 'source-mined' });
      });
      expect(latest!.podRequests.find(r => r.id === 'dup')?.status).toBe('source-mined');
    });

    it('refreshPodRequest updates status and triggers balance refresh', async () => {
      h.resolvePodStatus.mockResolvedValue({
        status: 'succeeded',
        message: 'done',
        refreshPrivateBalances: true,
      });
      await connectWagmi();
      const req = makePodRequest({ id: 'refresh-me', requestId: '0x' + 'a'.repeat(64) });
      act(() => {
        h.privacyBridge.upsertPodRequest?.(req);
      });
      await act(async () => {
        await latest!.refreshPodRequest(req);
      });
      expect(latest!.podRequests.find(r => r.id === 'refresh-me')?.status).toBe('succeeded');
    });

    it('refreshPodRequest handles not-found errors', async () => {
      await connectWagmi();
      const req = makePodRequest({ id: 'nf', requestId: '0x' + 'b'.repeat(64) });
      h.resolvePodStatus.mockRejectedValue(new Error('request not found'));
      await act(async () => {
        await latest!.refreshPodRequest(req);
      });
    });

    it('refreshPodRequest logs generic resolve failures', async () => {
      await connectWagmi();
      const req = makePodRequest({ id: 'generic-err', requestId: '0x' + 'e'.repeat(64) });
      h.resolvePodStatus.mockRejectedValue(new Error('rpc timeout'));
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      await act(async () => {
        await latest!.refreshPodRequest(req);
      });
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('refreshPodRequest stringifies non-Error rejections', async () => {
      await connectWagmi();
      const req = makePodRequest({ id: 'str-err', requestId: '0x' + '5'.repeat(64) });
      h.resolvePodStatus.mockRejectedValue('plain failure');
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      await act(async () => {
        await latest!.refreshPodRequest(req);
      });
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('refreshBalancesAfterPodCompletion swallows refreshPrivateBalances errors', async () => {
      h.resolvePodStatus.mockResolvedValue({
        status: 'succeeded',
        message: 'ok',
        refreshPrivateBalances: true,
      });
      h.balanceUpdater.updateAccountState.mockResolvedValue(false);
      await connectWagmi();
      vi.useFakeTimers();
      try {
        const req = makePodRequest({ id: 'catch-refresh', requestId: '0x' + 'f'.repeat(64) });
        act(() => {
          h.privacyBridge.upsertPodRequest?.(req);
        });
        const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
        const refreshPromise = act(async () => {
          await latest!.refreshPodRequest(req);
        });
        await vi.advanceTimersByTimeAsync(10000);
        await refreshPromise;
        expect(warnSpy).toHaveBeenCalledWith(
          'PoD completion balance refresh failed — will retry on next poll',
          expect.objectContaining({ requestId: 'catch-refresh' }),
        );
        warnSpy.mockRestore();
      } finally {
        vi.useRealTimers();
      }
    });

    it('polls active pod requests on an interval', async () => {
      vi.useFakeTimers();
      await connectWagmi();
      const req = makePodRequest({
        id: 'active',
        requestId: '0x' + 'c'.repeat(64),
        status: 'pod-pending',
      });
      act(() => {
        h.privacyBridge.upsertPodRequest?.(req);
      });
      h.resolvePodStatus.mockResolvedValue(null);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(h.resolvePodStatus.mock.calls.length).toBeGreaterThan(1);
    });

    it('refreshBalancesAfterPodCompletion skips duplicate refreshes', async () => {
      await connectWagmi();
      const req = makePodRequest({ id: 'dup-refresh', requestId: '0x' + 'd'.repeat(64) });
      act(() => {
        h.privacyBridge.upsertPodRequest?.(req);
      });
      h.resolvePodStatus.mockResolvedValue({
        status: 'succeeded',
        message: 'ok',
        refreshPrivateBalances: true,
      });
      h.balanceUpdater.updateAccountState.mockClear();
      await act(async () => {
        await latest!.refreshPodRequest(req);
        await latest!.refreshPodRequest(req);
      });
    });
  });

  it('exposes handleVerifyKeys from snap hook', async () => {
    await renderProvider();
    await act(async () => {
      await latest!.handleVerifyKeys();
    });
    expect(h.snap.handleKeyVerification).toHaveBeenCalled();
  });
});
