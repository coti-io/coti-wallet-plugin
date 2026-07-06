import { useRef } from 'react';
import { logger } from '../../lib/logger';
import { forceWagmiSessionClear } from '../../lib/wagmiDisconnect';
import { isMultipleWalletsError } from '../../utils/walletErrors';
import {
  getInitialPublicTokens,
  getInitialPrivateTokens,
} from '../../hooks/usePrivacyBridge';
import type { PrivacyBridgeAccountSync } from './usePrivacyBridgeAccountSync';
import type { PrivacyBridgeNetworkSession } from './usePrivacyBridgeNetworkSession';
import type { PrivacyBridgeSessionCore } from './sessionShared';

interface UsePrivacyBridgeWalletConnectionOptions {
  core: PrivacyBridgeSessionCore;
  network: PrivacyBridgeNetworkSession;
  accountSync: PrivacyBridgeAccountSync;
}

/** MetaMask connect/disconnect flows. */
export const usePrivacyBridgeWalletConnection = ({
  core,
  network,
  accountSync,
}: UsePrivacyBridgeWalletConnectionOptions) => {
  const {
    modals: { setShowInstallModal, setShowMultipleWalletsModal },
    metamaskExplicitConnect,
    ethereumListenerRegistered,
    isConnected,
    setIsConnected,
    setWalletAddress,
    setHasSnap,
    setPublicTokens,
    setPrivateTokens,
    setSessionAesKey,
    setArePrivateBalancesHidden,
    clearSnapCache,
    wagmiSyncRef,
    disconnectingRef,
    setMetamaskDetected,
  } = core;

  const {
    connectWallet,
    registerEthereumInitializedListener,
    wagmiConnected,
    wagmiConnector,
    wagmiConfig,
  } = network;
  const { updateAccountState, currentChainId } = accountSync;

  const handleConnectRef = useRef<() => Promise<void>>();

  const handleConnect = async () => {
    if (!window.ethereum && ethereumListenerRegistered.current) return;
    metamaskExplicitConnect.current = true;
    try {
      const connected = await connectWallet(async account => {
        await updateAccountState(account, false, false);
      });
      if (connected && !wagmiSyncRef.current && !wagmiConnected) {
        setMetamaskDetected(true);
      }
    } catch (error: any) {
      logger.error('Connection failed:', error);

      if (isMultipleWalletsError(error?.message)) {
        setShowMultipleWalletsModal(true);
        return;
      }

      if (error.message === 'METAMASK_NOT_INSTALLED') {
        setShowInstallModal(true);
        if (!ethereumListenerRegistered.current) {
          registerEthereumInitializedListener(() => {
            ethereumListenerRegistered.current = false;
            setShowInstallModal(false);
            handleConnectRef.current?.();
          });
          ethereumListenerRegistered.current = true;
        }
      }
    }
  };

  handleConnectRef.current = handleConnect;

  const handleDisconnect = async () => {
    const wasConnected = wagmiSyncRef.current || wagmiConnected || isConnected;
    if (wasConnected) {
      disconnectingRef.current = true;
    }

    metamaskExplicitConnect.current = false;

    const shouldClearWagmi = wagmiConnected || wagmiSyncRef.current || !!wagmiConnector;
    wagmiSyncRef.current = false;

    if (shouldClearWagmi) {
      await forceWagmiSessionClear(wagmiConfig, wagmiConnector);
    }

    setIsConnected(false);
    setWalletAddress('');
    setHasSnap(false);
    setMetamaskDetected(false);
    setPublicTokens(getInitialPublicTokens(currentChainId));
    setPrivateTokens(getInitialPrivateTokens(currentChainId));
    setSessionAesKey(null);
    setArePrivateBalancesHidden(true);
    setShowMultipleWalletsModal(false);
    clearSnapCache();
    disconnectingRef.current = false;
    logger.log('Disconnected wallet');
  };

  return { handleConnect, handleDisconnect };
};
