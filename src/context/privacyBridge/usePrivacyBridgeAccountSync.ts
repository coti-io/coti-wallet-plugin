import { useCallback, useEffect } from 'react';
import { useBalanceUpdater } from '../../hooks/useBalanceUpdater';
import { unlockCachedAesKey as unlockCachedAesKeyFromVault } from '../../crypto/localAesKeyVault';
import { getUnlockStrategyForChain } from '../../chains';
import { isChainUpdatesMuted } from '../../lib/chainMute';
import { logger } from '../../lib/logger';
import {
  getInitialPublicTokens,
  getInitialPrivateTokens,
} from '../../hooks/usePrivacyBridge';
import type { PrivacyBridgeNetworkSession } from './usePrivacyBridgeNetworkSession';
import type { PrivacyBridgeSessionCore, UpdateAccountStateRef } from './sessionShared';

interface UsePrivacyBridgeAccountSyncOptions {
  core: PrivacyBridgeSessionCore;
  network: PrivacyBridgeNetworkSession;
  updateAccountStateRef: UpdateAccountStateRef;
}

/** Balance refresh, token list resets, and session-key-driven account updates. */
export const usePrivacyBridgeAccountSync = ({
  core,
  network,
  updateAccountStateRef,
}: UsePrivacyBridgeAccountSyncOptions) => {
  const {
    setWalletAddress,
    setIsConnected,
    setHasSnap,
    setPublicTokens,
    setPrivateTokens,
    sessionAesKey,
    setSessionAesKey,
    setArePrivateBalancesHidden,
    fetchPrivateBalance,
    getAesKeyFromProvider,
    isConnected,
    hasSnap,
    walletAddress,
    wagmiSyncRef,
  } = core;

  const { checkNetwork, currentChainId, wagmiChainId } = network;

  const usesManualAesKey = getUnlockStrategyForChain(currentChainId) === 'manual-aes-key';

  const getAESKeyForCurrentNetwork = useCallback(
    async (accountAddress: string) => {
      if (sessionAesKey) return sessionAesKey;

      if (usesManualAesKey) {
        const cachedKey = await unlockCachedAesKeyFromVault(accountAddress);
        if (cachedKey) return cachedKey;
      }

      return getAesKeyFromProvider(accountAddress);
    },
    [getAesKeyFromProvider, usesManualAesKey, sessionAesKey],
  );

  const { updateAccountState } = useBalanceUpdater({
    setWalletAddress,
    setIsConnected,
    setHasSnap,
    setPublicTokens,
    setPrivateTokens,
    checkNetwork,
    getAESKeyFromSnap: getAESKeyForCurrentNetwork,
    fetchPrivateBalance,
    sessionAesKey,
    setSessionAesKey,
  });

  updateAccountStateRef.current = updateAccountState;

  useEffect(() => {
    if (isChainUpdatesMuted()) return;

    if (!isConnected) {
      setPublicTokens(getInitialPublicTokens(currentChainId));
      setPrivateTokens(getInitialPrivateTokens(currentChainId));
    } else if (!hasSnap) {
      setPrivateTokens(getInitialPrivateTokens(currentChainId));
    }
  }, [isConnected, hasSnap, currentChainId, setPublicTokens, setPrivateTokens]);

  useEffect(() => {
    if (sessionAesKey && walletAddress) {
      logger.log('Session AES Key set, refreshing account state...');
      if (!hasSnap) setHasSnap(true);
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      updateAccountState(walletAddress, true, false, undefined, chainOverride).then(() => {
        setArePrivateBalancesHidden(false);
      });
    }
  }, [
    sessionAesKey,
    walletAddress,
    updateAccountState,
    hasSnap,
    setHasSnap,
    setArePrivateBalancesHidden,
    wagmiSyncRef,
    wagmiChainId,
  ]);

  return { updateAccountState, currentChainId };
};

export type PrivacyBridgeAccountSync = ReturnType<typeof usePrivacyBridgeAccountSync>;
