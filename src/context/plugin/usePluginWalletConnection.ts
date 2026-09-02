import { useRef } from 'react';
import { logger } from '../../lib/logger';
import { forceWagmiSessionClear } from '../../lib/wagmiDisconnect';
import { isMultipleWalletsError } from '../../utils/walletErrors';
import { isAutoInitTokensEnabled } from '../../config/plugin';
import {
  getInitialPublicTokens,
  getInitialPrivateTokens,
} from '../../hooks/usePluginBridge';
import type { PluginAccountSync } from './usePluginAccountSync';
import type { PluginNetworkSession } from './usePluginNetworkSession';
import type { PluginSessionState } from './sessionShared';

interface UsePluginWalletConnectionOptions {
  core: PluginSessionState;
  network: PluginNetworkSession;
  accountSync: PluginAccountSync;
  autoInitTokens?: boolean;
}

/** MetaMask connect/disconnect flows. */
export const usePluginWalletConnection = ({
  core,
  network,
  accountSync,
  autoInitTokens: autoInitTokensProp,
}: UsePluginWalletConnectionOptions) => {
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
  const { bindAccount, currentChainId } = accountSync;
  const autoInitTokens = isAutoInitTokensEnabled(autoInitTokensProp);

  const handleConnectRef = useRef<() => Promise<void>>();

  const handleConnect = async () => {
    if (!window.ethereum && ethereumListenerRegistered.current) return;
    metamaskExplicitConnect.current = true;
    try {
      const connected = await connectWallet(async account => {
        if (autoInitTokens) {
          await bindAccount(account);
        } else {
          setWalletAddress(account);
          setIsConnected(true);
        }
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
    if (autoInitTokens) {
      setPublicTokens(getInitialPublicTokens(currentChainId));
      setPrivateTokens(getInitialPrivateTokens(currentChainId));
    } else {
      setPublicTokens([]);
      setPrivateTokens([]);
    }
    setSessionAesKey(null);
    setArePrivateBalancesHidden(true);
    setShowMultipleWalletsModal(false);
    clearSnapCache();
    disconnectingRef.current = false;
    logger.log('Disconnected wallet');
  };

  return { handleConnect, handleDisconnect };
};
