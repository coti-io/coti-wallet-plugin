import React, { useMemo, useState } from 'react';
import { usePluginBridge } from '../../hooks/usePluginBridge';
import {
  resolvePluginSurface,
  type CotiPluginSurface,
} from '../../config/plugin';
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
import { mergeCotiPluginSlices, type CotiPluginContextSlices } from './types';
import {
  PrivateUnlockProvider,
  type PrivateUnlockProviderOptions,
} from '../privateUnlock';
import { IDLE_COTI_POD, IDLE_COTI_SWAP } from './idleBridgeSlices';

export interface CotiPluginProviderProps {
  children: React.ReactNode;
  privateUnlock?: PrivateUnlockProviderOptions;
  /**
   * Which subsystems to mount. Overrides `configureCotiPlugin({ pluginSurface })`.
   * Default: `core` (wallet + unlock only).
   */
  surface?: CotiPluginSurface;
  /**
   * When false, skip seeding token lists and fetching balances on mount/connect.
   * Only applies when the resolved surface is `bridge`.
   * Overrides `configureCotiPlugin({ autoInitTokens })`.
   */
  autoInitTokens?: boolean;
}

type Session = ReturnType<typeof usePluginSession>;
type Modals = ReturnType<typeof usePluginModalsState>;

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
  sessionAesKey: session.sessionAesKey,
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
  privateUnlock?: PrivateUnlockProviderOptions;
  children: React.ReactNode;
}> = ({ slices, privateUnlock, children }) => {
  const legacyValue = useMemo(() => mergeCotiPluginSlices(slices), [slices]);

  return (
    <CotiWalletContext.Provider value={slices.wallet}>
      <CotiNetworkContext.Provider value={slices.network}>
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
      </CotiNetworkContext.Provider>
    </CotiWalletContext.Provider>
  );
};

/** Tokens, swap/fees, and PoD polling — only mounted when surface is `bridge`. */
const CotiPluginBridgeLayer: React.FC<{
  session: Session;
  modals: Modals;
  privateUnlock?: PrivateUnlockProviderOptions;
  children: React.ReactNode;
}> = ({ session, modals, privateUnlock, children }) => {
  const podState = usePluginPodState({
    walletAddress: session.walletAddress,
    refreshPrivateBalances: session.refreshPrivateBalances,
  });

  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'to-private' | 'to-public'>('to-private');
  const [selectedTokenIndex, setSelectedTokenIndex] = useState(0);
  const [toastState, setToastState] = useState({
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
    upsertPodRequest: podState.upsertPodRequest,
    sessionAesKey: session.sessionAesKey,
    chainId: session.chainId ? Number(session.chainId) : undefined,
  });

  const slices = useMemo((): CotiPluginContextSlices => ({
    wallet: buildWalletSlice(session),
    network: buildNetworkSlice(session),
    unlock: buildUnlockSlice(session, request => {
      podState.upsertPodRequest(request);
    }),
    tokens: {
      publicTokens: session.publicTokens,
      privateTokens: session.privateTokens,
    },
    swap: {
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
    },
    pod: {
      podRequests: podState.podRequests,
      refreshPodRequest: podState.refreshPodRequest,
    },
    modals,
  }), [
    session,
    modals,
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
    podState.podRequests,
    podState.refreshPodRequest,
    podState.upsertPodRequest,
  ]);

  return (
    <CotiPluginTree slices={slices} privateUnlock={privateUnlock}>
      {children}
    </CotiPluginTree>
  );
};

export const CotiPluginProvider: React.FC<CotiPluginProviderProps> = ({
  children,
  privateUnlock,
  autoInitTokens,
  surface,
}) => {
  const resolvedSurface = resolvePluginSurface(surface);
  const enableBridge = resolvedSurface === 'bridge';
  const modals = usePluginModalsState();
  const session = usePluginSession({
    modals,
    autoInitTokens: enableBridge ? autoInitTokens : false,
  });

  const coreSlices = useMemo((): CotiPluginContextSlices => ({
    wallet: buildWalletSlice(session),
    network: buildNetworkSlice(session),
    unlock: buildUnlockSlice(session),
    tokens: {
      publicTokens: session.publicTokens,
      privateTokens: session.privateTokens,
    },
    swap: IDLE_COTI_SWAP,
    pod: IDLE_COTI_POD,
    modals,
  }), [session, modals]);

  if (!enableBridge) {
    return (
      <CotiPluginTree slices={coreSlices} privateUnlock={privateUnlock}>
        {children}
      </CotiPluginTree>
    );
  }

  return (
    <CotiPluginBridgeLayer
      session={session}
      modals={modals}
      privateUnlock={privateUnlock}
    >
      {children}
    </CotiPluginBridgeLayer>
  );
};
