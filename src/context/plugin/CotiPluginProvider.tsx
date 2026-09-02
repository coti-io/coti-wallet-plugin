import React, { useMemo, useState } from 'react';
import { usePluginBridge } from '../../hooks/usePluginBridge';
import {
  resolvePluginFeatures,
  type CotiPluginFeature,
} from '../../config/plugin';
import type { PodPortalRequest } from '../../contracts/pod';
import { usePluginModalsState } from './usePluginModalsState';
import { usePluginSession } from './usePluginSession';
import { usePluginPodState } from './usePluginPodState';
import {
  CotiPluginContext,
  CotiModalsContext,
  CotiNetworkContext,
  CotiPodContext,
  CotiSwapContext,
  CotiTokensContext,
  CotiUnlockContext,
  CotiWalletContext,
} from './contexts';
import { SessionAesKeyContext } from './sessionAesKeyContext';
import { PluginRuntimeContext, usePluginRuntimeLease } from './pluginRuntimeContext';
import {
  mergeCotiPluginSlices,
  type CotiPluginContextSlices,
  type CotiPodContextValue,
  type CotiSwapContextValue,
} from './types';
import {
  PrivateUnlockProvider,
  type PrivateUnlockProviderOptions,
} from '../privateUnlock';
import { IDLE_COTI_POD, IDLE_COTI_SWAP } from './idleBridgeSlices';

/**
 * Plugin session + unlock. Must sit under a wagmi `WagmiProvider`
 * (and typically a React Query `QueryClientProvider`).
 * Use `WagmiRainbowKitProvider` from `@coti-io/coti-wallet-plugin/rainbowkit`,
 * or supply your own wagmi config.
 */
export interface CotiPluginProviderProps {
  children: React.ReactNode;
  privateUnlock?: PrivateUnlockProviderOptions;
  /**
   * Optional subsystems on top of core (wallet + unlock).
   * Overrides `configureCotiPlugin({ pluginFeatures })`.
   * Default: none (`[]`).
   */
  features?: readonly CotiPluginFeature[];
  /**
   * When false, skip seeding token lists and fetching balances on mount/connect.
   * Only applies when the `tokens` feature is on (including via `portal`).
   * Overrides `configureCotiPlugin({ autoInitTokens })`.
   */
  autoInitTokens?: boolean;
}

type Session = ReturnType<typeof usePluginSession>;
type Modals = ReturnType<typeof usePluginModalsState>;

type PodHandle = {
  slice: CotiPodContextValue;
  upsert: (request: PodPortalRequest) => void;
};

const noopUpsertPodRequest = (_request: PodPortalRequest) => {};

const IDLE_POD_HANDLE: PodHandle = {
  slice: IDLE_COTI_POD,
  upsert: noopUpsertPodRequest,
};

const buildWalletSlice = (session: Session): CotiPluginContextSlices['wallet'] => ({
  isConnected: session.isConnected,
  walletAddress: session.walletAddress,
  handleConnect: session.handleConnect,
  handleDisconnect: session.handleDisconnect,
  metamaskDetected: session.metamaskDetected,
});

const buildNetworkSlice = (session: Session): CotiPluginContextSlices['network'] => ({
  chainId: session.chainId,
  switchNetwork: session.switchNetwork,
  networkName: session.networkName,
  isUnsupportedNetwork: session.isUnsupportedNetwork,
  isOffTargetNetwork: session.isOffTargetNetwork,
  isWrongNetwork: session.isWrongNetwork,
  networkMismatchWarning: session.networkMismatchWarning,
  enforceNetwork: session.enforceNetwork,
  COTI_MAINNET_ID: session.COTI_MAINNET_ID,
  COTI_TESTNET_ID: session.COTI_TESTNET_ID,
  SEPOLIA_ID: session.SEPOLIA_ID,
});

const buildUnlockSlice = (
  session: Session,
  onPrivateTokenRequest?: (request: NonNullable<
    Awaited<ReturnType<Session['sendPrivateToken']>>['request']
  >) => void,
): CotiPluginContextSlices['unlock'] => ({
  hasSnap: session.hasSnap,
  snapError: session.snapError,
  hasAesKeyInSnap: session.hasAesKeyInSnap,
  connectToSnap: session.connectToSnap,
  requestSnapConnection: session.requestSnapConnection,
  checkSnapStatus: session.checkSnapStatus,
  aesKeyChainId: session.aesKeyChainId,
  setAesKeyChainId: session.setAesKeyChainId,
  isPrivateUnlocked: session.isPrivateUnlocked,
  sendPrivateToken: async (params: {
    symbol: string;
    recipient: string;
    amount: string;
  }) => {
    const result = await session.sendPrivateToken(params);
    if (result.request) {
      onPrivateTokenRequest?.(result.request);
    }
    return result;
  },
  encryptPrivateValue: session.encryptPrivateValue,
  decryptPrivateValue: session.decryptPrivateValue,
  refreshPrivateBalances: session.refreshPrivateBalances,
  onboardingError: session.onboardingError,
  onboardingWarnings: session.onboardingWarnings,
  lockPrivateBalances: session.lockPrivateBalances,
  handleOnboard: session.handleOnboard,
  saveManualAesKey: session.saveManualAesKey,
  handleVerifyKeys: session.handleVerifyKeys,
  showSnapMissingModal: session.showSnapMissingModal,
  setShowSnapMissingModal: session.setShowSnapMissingModal,
  showCotiWalletAesKeyModal: session.showCotiWalletAesKeyModal,
  setShowCotiWalletAesKeyModal: session.setShowCotiWalletAesKeyModal,
});

const CotiPluginTree: React.FC<{
  slices: CotiPluginContextSlices;
  sessionAesKey: string | null;
  privateUnlock?: PrivateUnlockProviderOptions;
  children: React.ReactNode;
}> = ({ slices, sessionAesKey, privateUnlock, children }) => {
  const legacyValue = useMemo(() => mergeCotiPluginSlices(slices), [slices]);

  return (
    <CotiWalletContext.Provider value={slices.wallet}>
      <CotiNetworkContext.Provider value={slices.network}>
        <SessionAesKeyContext.Provider value={sessionAesKey}>
          <CotiUnlockContext.Provider value={slices.unlock}>
            <CotiTokensContext.Provider value={slices.tokens}>
              <CotiSwapContext.Provider value={slices.swap}>
                <CotiPodContext.Provider value={slices.pod}>
                  <CotiModalsContext.Provider value={slices.modals}>
                    <CotiPluginContext.Provider value={legacyValue}>
                      <PrivateUnlockProvider options={privateUnlock}>
                        {children}
                      </PrivateUnlockProvider>
                    </CotiPluginContext.Provider>
                  </CotiModalsContext.Provider>
                </CotiPodContext.Provider>
              </CotiSwapContext.Provider>
            </CotiTokensContext.Provider>
          </CotiUnlockContext.Provider>
        </SessionAesKeyContext.Provider>
      </CotiNetworkContext.Provider>
    </CotiWalletContext.Provider>
  );
};

const CotiPluginAssembled: React.FC<{
  session: Session;
  modals: Modals;
  swap: CotiSwapContextValue;
  pod: PodHandle;
  privateUnlock?: PrivateUnlockProviderOptions;
  children: React.ReactNode;
}> = ({ session, modals, swap, pod, privateUnlock, children }) => {
  const slices = useMemo((): CotiPluginContextSlices => ({
    wallet: buildWalletSlice(session),
    network: buildNetworkSlice(session),
    unlock: buildUnlockSlice(session, request => {
      pod.upsert(request);
    }),
    tokens: {
      publicTokens: session.publicTokens,
      privateTokens: session.privateTokens,
    },
    swap,
    pod: pod.slice,
    modals,
  }), [session, modals, swap, pod]);

  return (
    <CotiPluginTree
      slices={slices}
      sessionAesKey={session.sessionAesKey}
      privateUnlock={privateUnlock}
    >
      {children}
    </CotiPluginTree>
  );
};

const CotiPluginPodMounted: React.FC<{
  session: Session;
  children: (pod: PodHandle) => React.ReactNode;
}> = ({ session, children }) => {
  const podState = usePluginPodState({
    walletAddress: session.walletAddress,
    refreshPrivateBalances: session.refreshPrivateBalances,
  });

  const pod = useMemo((): PodHandle => ({
    slice: {
      podRequests: podState.podRequests,
      refreshPodRequest: podState.refreshPodRequest,
    },
    upsert: podState.upsertPodRequest,
  }), [podState.podRequests, podState.refreshPodRequest, podState.upsertPodRequest]);

  return <>{children(pod)}</>;
};

/** Privacy Portal swap/fees — only mounted when `portal` is enabled. */
const CotiPluginPortalMounted: React.FC<{
  session: Session;
  upsertPodRequest: (request: PodPortalRequest) => void;
  children: (swap: CotiSwapContextValue) => React.ReactNode;
}> = ({ session, upsertPodRequest, children }) => {
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'to-private' | 'to-public'>('to-private');
  const [selectedTokenIndex, setSelectedTokenIndex] = useState(0);
  const [, setToastState] = useState({
    visible: false,
    title: '',
    message: '' as React.ReactNode,
  });
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  const {
    handleSwap,
    isBridgingLoading,
    isApprovalNeeded,
    isApproving,
    handleApprove,
    estimatedGasFee,
    updateGasFee,
    isGasEstimating,
    portalFeeCoti,
    portalFee,
    portalFeeSymbol,
    podInboxFee,
    l1GasFee,
    isPodChain,
    feeDebugInfo,
  } = usePluginBridge({
    isConnected: session.isConnected,
    walletAddress: session.walletAddress,
    publicTokens: session.publicTokens,
    setPublicTokens: session.setPublicTokens,
    setPrivateTokens: session.setPrivateTokens,
    setToastState,
    amount,
    setAmount,
    direction,
    setDirection,
    selectedTokenIndex,
    setSelectedTokenIndex,
    error,
    hasSnap: session.hasSnap,
    setHasSnap: session.setHasSnap,
    handleOnboard: session.handleOnboard,
    refreshPublicBalances: session.refreshPublicBalances,
    refreshPrivateBalances: session.refreshPrivateBalances,
    upsertPodRequest,
    sessionAesKey: session.sessionAesKey,
    chainId: session.chainId ? Number(session.chainId) : undefined,
  });

  const swap = useMemo((): CotiSwapContextValue => ({
    amount,
    direction,
    selectedTokenIndex,
    setAmount,
    setDirection,
    setSelectedTokenIndex,
    handleSwap,
    isBridgingLoading,
    isApprovalNeeded,
    isApproving,
    handleApprove,
    estimatedGasFee,
    updateGasFee,
    isGasEstimating,
    portalFeeCoti,
    portalFee,
    portalFeeSymbol,
    podInboxFee,
    l1GasFee,
    isPodChain,
    feeDebugInfo,
  }), [
    amount,
    direction,
    selectedTokenIndex,
    handleSwap,
    isBridgingLoading,
    isApprovalNeeded,
    isApproving,
    handleApprove,
    estimatedGasFee,
    updateGasFee,
    isGasEstimating,
    portalFeeCoti,
    portalFee,
    portalFeeSymbol,
    podInboxFee,
    l1GasFee,
    isPodChain,
    feeDebugInfo,
  ]);

  return <>{children(swap)}</>;
};

const CotiPluginWithOptionalPortal: React.FC<{
  enablePortal: boolean;
  session: Session;
  modals: Modals;
  pod: PodHandle;
  privateUnlock?: PrivateUnlockProviderOptions;
  children: React.ReactNode;
}> = ({ enablePortal, session, modals, pod, privateUnlock, children }) => {
  if (!enablePortal) {
    return (
      <CotiPluginAssembled
        session={session}
        modals={modals}
        swap={IDLE_COTI_SWAP}
        pod={pod}
        privateUnlock={privateUnlock}
      >
        {children}
      </CotiPluginAssembled>
    );
  }

  return (
    <CotiPluginPortalMounted session={session} upsertPodRequest={pod.upsert}>
      {swap => (
        <CotiPluginAssembled
          session={session}
          modals={modals}
          swap={swap}
          pod={pod}
          privateUnlock={privateUnlock}
        >
          {children}
        </CotiPluginAssembled>
      )}
    </CotiPluginPortalMounted>
  );
};

export const CotiPluginProvider: React.FC<CotiPluginProviderProps> = (props) => {
  const runtime = usePluginRuntimeLease();
  return (
    <PluginRuntimeContext.Provider value={runtime}>
      <CotiPluginProviderInner {...props} />
    </PluginRuntimeContext.Provider>
  );
};

const CotiPluginProviderInner: React.FC<CotiPluginProviderProps> = ({
  children,
  privateUnlock,
  autoInitTokens,
  features,
}) => {
  const resolvedFeatures = resolvePluginFeatures(features);
  const enableTokens = resolvedFeatures.includes('tokens');
  const enablePortal = resolvedFeatures.includes('portal');
  const enablePod = resolvedFeatures.includes('pod');
  const modals = usePluginModalsState();
  const session = usePluginSession({
    modals,
    autoInitTokens: enableTokens ? autoInitTokens : false,
  });

  const shell = (pod: PodHandle) => (
    <CotiPluginWithOptionalPortal
      enablePortal={enablePortal}
      session={session}
      modals={modals}
      pod={pod}
      privateUnlock={privateUnlock}
    >
      {children}
    </CotiPluginWithOptionalPortal>
  );

  if (!enablePod) {
    return shell(IDLE_POD_HANDLE);
  }

  return (
    <CotiPluginPodMounted session={session}>
      {pod => shell(pod)}
    </CotiPluginPodMounted>
  );
};
