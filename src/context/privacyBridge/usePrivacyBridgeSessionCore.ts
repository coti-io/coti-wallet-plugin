import { useCallback, useEffect, useRef, useState } from 'react';
import { useSnap } from '../../hooks/useSnap';
import { usePrivateTokenBalance } from '../../hooks/usePrivateTokenBalance';
import { useWalletType } from '../../hooks/useWalletType';
import { useAesKeyProvider } from '../../hooks/useAesKeyProvider';
import {
  getInitialPublicTokens,
  getInitialPrivateTokens,
  type Token,
} from '../../hooks/usePrivacyBridge';
import type { PrivacyBridgeModalsContextValue } from './types';
import { usePrivacyBridgeSessionKey } from './usePrivacyBridgeSessionKey';
import type { PrivacyBridgeSessionCore } from './sessionShared';

interface UsePrivacyBridgeSessionCoreOptions {
  modals: PrivacyBridgeModalsContextValue;
}

/** Shared wallet, token, snap, and session-key state for the bridge provider. */
export const usePrivacyBridgeSessionCore = ({
  modals,
}: UsePrivacyBridgeSessionCoreOptions): PrivacyBridgeSessionCore => {
  const [isConnected, setIsConnected] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [hasSnap, setHasSnap] = useState(false);
  const [snapError, setSnapError] = useState<string | null>(null);
  const [publicTokens, setPublicTokens] = useState<Token[]>(getInitialPublicTokens());
  const [privateTokens, setPrivateTokens] = useState<Token[]>(getInitialPrivateTokens());
  const [showSnapMissingModal, setShowSnapMissingModal] = useState(false);
  const [showCotiWalletAesKeyModal, setShowCotiWalletAesKeyModal] = useState(false);
  const [metamaskDetected, setMetamaskDetected] = useState(false);
  const ethereumListenerRegistered = useRef(false);
  const wagmiSyncRef = useRef(false);
  const metamaskExplicitConnect = useRef(false);
  const snapCheckInFlightRef = useRef<Promise<boolean> | null>(null);

  const {
    sessionAesKey,
    setSessionAesKey,
    arePrivateBalancesHidden,
    setArePrivateBalancesHidden,
  } = usePrivacyBridgeSessionKey(walletAddress);

  useEffect(() => {
    if (snapError) setShowSnapMissingModal(true);
  }, [snapError]);

  const {
    isSnapInstalled,
    executeSnapCheck,
    getAESKeyFromSnap,
    hasAesKeyInSnap,
    connectToSnap,
    requestSnapConnection,
    decryptCtUint64ViaSnap,
    decryptCtUint256ViaSnap,
    buildItUint256ViaSnap,
    handleManualOnboarding,
    handleKeyVerification,
    clearSnapCache,
  } = useSnap(setSnapError);

  const checkSnapStatus = useCallback(async (): Promise<boolean> => {
    if (snapCheckInFlightRef.current) {
      return snapCheckInFlightRef.current;
    }

    const promise = isSnapInstalled().then(installed => {
      setHasSnap(installed);
      return installed;
    });

    snapCheckInFlightRef.current = promise;

    try {
      return await promise;
    } finally {
      if (snapCheckInFlightRef.current === promise) {
        snapCheckInFlightRef.current = null;
      }
    }
  }, [isSnapInstalled, setHasSnap]);

  const walletTypeInfo = useWalletType();
  const { getAesKey: getAesKeyFromProvider } = useAesKeyProvider(walletTypeInfo);
  const { fetchPrivateBalance } = usePrivateTokenBalance();

  return {
    modals,
    isConnected,
    setIsConnected,
    walletAddress,
    setWalletAddress,
    hasSnap,
    setHasSnap,
    snapError,
    setSnapError,
    publicTokens,
    setPublicTokens,
    privateTokens,
    setPrivateTokens,
    showSnapMissingModal,
    setShowSnapMissingModal,
    showCotiWalletAesKeyModal,
    setShowCotiWalletAesKeyModal,
    metamaskDetected,
    setMetamaskDetected,
    ethereumListenerRegistered,
    wagmiSyncRef,
    metamaskExplicitConnect,
    sessionAesKey,
    setSessionAesKey,
    arePrivateBalancesHidden,
    setArePrivateBalancesHidden,
    executeSnapCheck,
    checkSnapStatus,
    getAESKeyFromSnap,
    hasAesKeyInSnap,
    connectToSnap,
    requestSnapConnection,
    decryptCtUint64ViaSnap,
    decryptCtUint256ViaSnap,
    buildItUint256ViaSnap,
    handleManualOnboarding,
    handleKeyVerification,
    clearSnapCache,
    fetchPrivateBalance,
    getAesKeyFromProvider,
  };
};
