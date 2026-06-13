import React, { useMemo, useState } from 'react';
import { usePrivacyBridge } from '../../hooks/usePrivacyBridge';
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

export const PrivacyBridgeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const modals = usePrivacyBridgeModalsState();
  const session = usePrivacyBridgeSession({ modals });

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
    getAESKeyFromSnap: session.getAESKeyFromSnap,
    handleOnboard: session.handleOnboard,
    refreshPrivateBalances: session.refreshPrivateBalances,
    upsertPodRequest: podState.upsertPodRequest,
  });

  const slices = useMemo((): PrivacyBridgeContextSlices => {
    const wallet = {
      isConnected: session.isConnected,
      walletAddress: session.walletAddress,
      handleConnect: session.handleConnect,
      handleDisconnect: session.handleDisconnect,
      metamaskDetected: session.metamaskDetected,
    };

    const network = {
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
    };

    const unlock = {
      hasSnap: session.hasSnap,
      snapError: session.snapError,
      connectToSnap: session.connectToSnap,
      requestSnapConnection: session.requestSnapConnection,
      sessionAesKey: session.sessionAesKey,
      isPrivateUnlocked: session.isPrivateUnlocked,
      refreshPrivateBalances: session.refreshPrivateBalances,
      lockPrivateBalances: session.lockPrivateBalances,
      handleOnboard: session.handleOnboard,
      saveManualAesKey: session.saveManualAesKey,
      unlockCachedAesKey: session.unlockCachedAesKey,
      handleVerifyKeys: session.handleVerifyKeys,
      showSnapMissingModal: session.showSnapMissingModal,
      setShowSnapMissingModal: session.setShowSnapMissingModal,
      showCotiWalletAesKeyModal: session.showCotiWalletAesKeyModal,
      setShowCotiWalletAesKeyModal: session.setShowCotiWalletAesKeyModal,
    };

    const tokens = {
      publicTokens: session.publicTokens,
      privateTokens: session.privateTokens,
    };

    const swap = {
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
      feeDebugInfo,
    };

    const pod = {
      podRequests: podState.podRequests,
      refreshPodRequest: podState.refreshPodRequest,
    };

    return { wallet, network, unlock, tokens, swap, pod, modals };
  }, [
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
    feeDebugInfo,
    podState.podRequests,
    podState.refreshPodRequest,
  ]);

  const legacyValue = useMemo(() => mergePrivacyBridgeSlices(slices), [slices]);

  return (
    <PrivacyBridgeWalletContext.Provider value={slices.wallet}>
      <PrivacyBridgeNetworkContext.Provider value={slices.network}>
        <PrivacyBridgeUnlockContext.Provider value={slices.unlock}>
          <PrivacyBridgeTokensContext.Provider value={slices.tokens}>
            <PrivacyBridgeSwapContext.Provider value={slices.swap}>
              <PrivacyBridgePodContext.Provider value={slices.pod}>
                <PrivacyBridgeModalsContext.Provider value={slices.modals}>
                  <PrivacyBridgeContext.Provider value={legacyValue}>{children}</PrivacyBridgeContext.Provider>
                </PrivacyBridgeModalsContext.Provider>
              </PrivacyBridgePodContext.Provider>
            </PrivacyBridgeSwapContext.Provider>
          </PrivacyBridgeTokensContext.Provider>
        </PrivacyBridgeUnlockContext.Provider>
      </PrivacyBridgeNetworkContext.Provider>
    </PrivacyBridgeWalletContext.Provider>
  );
};
