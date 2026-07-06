import { useRef } from 'react';
import { logger } from '../../lib/logger';
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

  const { connectWallet, registerEthereumInitializedListener, wagmiConnected, wagmiDisconnect } = network;
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
    disconnectingRef.current = true;
    if (wagmiSyncRef.current || wagmiConnected) {
      wagmiDisconnect();
      wagmiSyncRef.current = false;
    }

    if (window.ethereum && !wagmiConnected) {
      try {
        await (window.ethereum as any).request({
          method: 'wallet_revokePermissions',
          params: [{ eth_accounts: {} }],
        });
      } catch (err) {
        logger.warn('wallet_revokePermissions failed (may not be supported):', err);
      }
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
    logger.log('Disconnected wallet');
    disconnectingRef.current = false;
  };

  return { handleConnect, handleDisconnect };
};
