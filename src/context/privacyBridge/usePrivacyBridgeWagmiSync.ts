import { useEffect, useRef } from 'react';
import { getPluginConfig } from '../../config/plugin';
import { mapConnectorIdToWalletType } from '../../hooks/useWalletType';
import { isChainUpdatesMuted } from '../../lib/chainMute';
import { logger } from '../../lib/logger';
import { truncateAddress } from '../../lib/format';
import { clearAesKeyValidatedForUnlock } from '../../crypto/aesKeyValidation';
import { getInitialPrivateTokens } from '../../hooks/usePrivacyBridge';
import type { PrivacyBridgeAccountSync } from './usePrivacyBridgeAccountSync';
import type { PrivacyBridgeNetworkSession } from './usePrivacyBridgeNetworkSession';
import type { PrivacyBridgeSessionCore } from './sessionShared';

interface UsePrivacyBridgeWagmiSyncOptions {
  core: PrivacyBridgeSessionCore;
  network: PrivacyBridgeNetworkSession;
  accountSync: PrivacyBridgeAccountSync;
}

/** Syncs RainbowKit/wagmi connection state into the bridge session. */
export const usePrivacyBridgeWagmiSync = ({
  core,
  network,
  accountSync,
}: UsePrivacyBridgeWagmiSyncOptions) => {
  const {
    isConnected,
    walletAddress,
    setIsConnected,
    setWalletAddress,
    setHasSnap,
    wagmiSyncRef,
    disconnectingRef,
    setSessionAesKey,
    setArePrivateBalancesHidden,
    setPrivateTokens,
    checkSnapStatus,
    clearSnapCache,
    setMetamaskDetected,
  } = core;

  const {
    wagmiAddress,
    wagmiConnected,
    wagmiChainId,
    wagmiConnector,
  } = network;

  const { updateAccountState } = accountSync;

  useEffect(() => {
    if (wagmiConnected && wagmiAddress && !isConnected && !disconnectingRef.current) {
      logger.log('RainbowKit connection detected, syncing to context', {
        address: truncateAddress(wagmiAddress),
        chainId: wagmiChainId,
      });
      wagmiSyncRef.current = true;
      updateAccountState(wagmiAddress, false, true, undefined, wagmiChainId);

      const isMetaMask = mapConnectorIdToWalletType(wagmiConnector?.id) === 'metamask';
      if (isMetaMask) {
        logger.log('MetaMask detected via RainbowKit — checking Snap...');
        void checkSnapStatus();
      }
    }

    if (!wagmiConnected && wagmiSyncRef.current) {
      logger.log('RainbowKit disconnected, clearing context');
      wagmiSyncRef.current = false;
      disconnectingRef.current = false;
      setIsConnected(false);
      setWalletAddress('');
      setHasSnap(false);
      setMetamaskDetected(false);
      if (getPluginConfig().clearSessionKeyOnWagmiDisconnect) {
        setSessionAesKey(null);
        clearSnapCache();
      }
      setArePrivateBalancesHidden(true);
    }

    if (wagmiConnected && wagmiAddress && isConnected && wagmiAddress !== walletAddress) {
      logger.log('RainbowKit account switched', truncateAddress(wagmiAddress));
      if (walletAddress) clearAesKeyValidatedForUnlock(walletAddress);
      clearAesKeyValidatedForUnlock(wagmiAddress);
      setSessionAesKey(null);
      clearSnapCache();
      setArePrivateBalancesHidden(true);
      setPrivateTokens(getInitialPrivateTokens(wagmiChainId));
      updateAccountState(wagmiAddress, false, false, undefined, wagmiChainId);
    }
  }, [
    wagmiConnected,
    wagmiAddress,
    walletAddress,
    isConnected,
    wagmiChainId,
    wagmiConnector,
    updateAccountState,
    wagmiSyncRef,
    setIsConnected,
    setWalletAddress,
    setHasSnap,
    setSessionAesKey,
    setArePrivateBalancesHidden,
    setPrivateTokens,
    checkSnapStatus,
    clearSnapCache,
    setMetamaskDetected,
  ]);

  useEffect(() => {
    if (wagmiConnected && wagmiConnector) {
      const isMetaMask = mapConnectorIdToWalletType(wagmiConnector.id) === 'metamask';
      setMetamaskDetected(isMetaMask);
      if (!isMetaMask) {
        setHasSnap(false);
      }
      return;
    }
    if (!wagmiConnected && wagmiSyncRef.current) {
      setMetamaskDetected(false);
      setHasSnap(false);
    }
  }, [wagmiConnected, wagmiConnector, wagmiSyncRef, setMetamaskDetected, setHasSnap]);

  const prevWagmiChainIdRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (wagmiConnected && wagmiAddress && isConnected && wagmiAddress === walletAddress && wagmiChainId) {
      if (prevWagmiChainIdRef.current !== undefined && prevWagmiChainIdRef.current !== wagmiChainId) {
        if (isChainUpdatesMuted()) {
          logger.log('[ChainMuted] Ignoring chain change during onboarding', {
            from: prevWagmiChainIdRef.current,
            to: wagmiChainId,
          });
          prevWagmiChainIdRef.current = wagmiChainId;
          return;
        }
        // When a session AES key exists, private balances are already correct.
        // Re-fetch with the key to avoid resetting private tokens to zero.
        if (core.sessionAesKey) {
          logger.log('[ChainChange] sessionAesKey present — refreshing with private balances', {
            from: prevWagmiChainIdRef.current,
            to: wagmiChainId,
          });
          prevWagmiChainIdRef.current = wagmiChainId;
          updateAccountState(wagmiAddress, true, true, core.sessionAesKey, wagmiChainId);
          return;
        }
        logger.log('RainbowKit chain changed', {
          from: prevWagmiChainIdRef.current,
          to: wagmiChainId,
        });
        updateAccountState(wagmiAddress, false, true, undefined, wagmiChainId);
      }
      prevWagmiChainIdRef.current = wagmiChainId;
    }
  }, [wagmiConnected, wagmiAddress, walletAddress, isConnected, wagmiChainId, updateAccountState, core.sessionAesKey]);
};
