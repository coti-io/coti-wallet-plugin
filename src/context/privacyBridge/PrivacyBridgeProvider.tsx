import React, { useMemo, useState } from 'react';
import { usePrivacyBridge } from '../../hooks/usePrivacyBridge';
import {
  resolvePrivacyBridgeSurface,
  type CotiPluginSurface,
} from '../../config/plugin';
import { usePrivacyBridgeModalsState } from './usePrivacyBridgeModalsState';
import { usePrivacyBridgeSession } from './usePrivacyBridgeSession';
import { usePrivacyBridgePodState } from './usePrivacyBridgePodState';
import {
  PrivacyBridgeContext,
  PrivacyBridgeModalsContext,
  PrivacyBridgeNetworkContext,
  PrivacyBridgePodContext,
  PrivacyBridgeSwapContext,
  PrivacyBridgeTokensContext,
  PrivacyBridgeUnlockContext,
  PrivacyBridgeWalletContext,
} from './contexts';
import { mergePrivacyBridgeSlices, type PrivacyBridgeContextSlices } from './types';
import {
  PrivateUnlockProvider,
  type PrivateUnlockProviderOptions,
} from '../privateUnlock';
import { IDLE_PRIVACY_BRIDGE_POD, IDLE_PRIVACY_BRIDGE_SWAP } from './idleBridgeSlices';

export interface PrivacyBridgeProviderProps {
  children: React.ReactNode;
  privateUnlock?: PrivateUnlockProviderOptions;
  /**
   * Which subsystems to mount. Overrides `configureCotiPlugin({ privacyBridgeSurface })`.
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

type Session = ReturnType<typeof usePrivacyBridgeSession>;
type Modals = ReturnType<typeof usePrivacyBridgeModalsState>;

const buildWalletSlice = (session: Session): PrivacyBridgeContextSlices['wallet'] => ({
  isConnected: session.isConnected,
  walletAddress: session.walletAddress,
  handleConnect: session.handleConnect,
  handleDisconnect: session.handleDisconnect,
  metamaskDetected: session.metamaskDetected,
});

const buildNetworkSlice = (session: Session): PrivacyBridgeContextSlices['network'] => ({
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
): PrivacyBridgeContextSlices['unlock'] => ({
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

const PrivacyBridgeTree: React.FC<{
  slices: PrivacyBridgeContextSlices;
  privateUnlock?: PrivateUnlockProviderOptions;
  children: React.ReactNode;
}> = ({ slices, privateUnlock, children }) => {
  const legacyValue = useMemo(() => mergePrivacyBridgeSlices(slices), [slices]);

  return (
    <PrivacyBridgeWalletContext.Provider value={slices.wallet}>
      <PrivacyBridgeNetworkContext.Provider value={slices.network}>
        <PrivacyBridgeUnlockContext.Provider value={slices.unlock}>
          <PrivacyBridgeTokensContext.Provider value={slices.tokens}>
            <PrivacyBridgeSwapContext.Provider value={slices.swap}>
              <PrivacyBridgePodContext.Provider value={slices.pod}>
                <PrivacyBridgeModalsContext.Provider value={slices.modals}>
                  <PrivacyBridgeContext.Provider value={legacyValue}>
                    <PrivateUnlockProvider options={privateUnlock}>
                      {children}
                    </PrivateUnlockProvider>
                  </PrivacyBridgeContext.Provider>
                </PrivacyBridgeModalsContext.Provider>
              </PrivacyBridgePodContext.Provider>
            </PrivacyBridgeSwapContext.Provider>
          </PrivacyBridgeTokensContext.Provider>
        </PrivacyBridgeUnlockContext.Provider>
      </PrivacyBridgeNetworkContext.Provider>
    </PrivacyBridgeWalletContext.Provider>
  );
};

/** Tokens, swap/fees, and PoD polling — only mounted when surface is `bridge`. */
const PrivacyBridgeBridgeLayer: React.FC<{
  session: Session;
  modals: Modals;
  privateUnlock?: PrivateUnlockProviderOptions;
  children: React.ReactNode;
}> = ({ session, modals, privateUnlock, children }) => {
  const podState = usePrivacyBridgePodState({
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
  } = usePrivacyBridge({
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

  const slices = useMemo((): PrivacyBridgeContextSlices => ({
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
    <PrivacyBridgeTree slices={slices} privateUnlock={privateUnlock}>
      {children}
    </PrivacyBridgeTree>
  );
};

export const PrivacyBridgeProvider: React.FC<PrivacyBridgeProviderProps> = ({
  children,
  privateUnlock,
  autoInitTokens,
  surface,
}) => {
  const resolvedSurface = resolvePrivacyBridgeSurface(surface);
  const enableBridge = resolvedSurface === 'bridge';
  const modals = usePrivacyBridgeModalsState();
  const session = usePrivacyBridgeSession({
    modals,
    autoInitTokens: enableBridge ? autoInitTokens : false,
  });

  const coreSlices = useMemo((): PrivacyBridgeContextSlices => ({
    wallet: buildWalletSlice(session),
    network: buildNetworkSlice(session),
    unlock: buildUnlockSlice(session),
    tokens: {
      publicTokens: session.publicTokens,
      privateTokens: session.privateTokens,
    },
    swap: IDLE_PRIVACY_BRIDGE_SWAP,
    pod: IDLE_PRIVACY_BRIDGE_POD,
    modals,
  }), [session, modals]);

  if (!enableBridge) {
    return (
      <PrivacyBridgeTree slices={coreSlices} privateUnlock={privateUnlock}>
        {children}
      </PrivacyBridgeTree>
    );
  }

  return (
    <PrivacyBridgeBridgeLayer
      session={session}
      modals={modals}
      privateUnlock={privateUnlock}
    >
      {children}
    </PrivacyBridgeBridgeLayer>
  );
};
