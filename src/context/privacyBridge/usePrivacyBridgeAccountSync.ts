import { useCallback, useEffect } from 'react';
import { useBalanceUpdater } from '../../hooks/useBalanceUpdater';
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

  const getAESKeyForCurrentNetwork = useCallback(
    async (accountAddress: string) => {
      // Always prioritize the in-memory session key — avoids any interactive prompts
      // during automatic balance refreshes.
      if (sessionAesKey) return sessionAesKey;

      // Fall through to the wallet-type-aware provider (useAesKeyProvider).
      // For MetaMask: tries Snap (non-interactive if already connected)
      // For non-MetaMask: triggers contract onboarding (interactive — but only called
      // when checkSnap=true, i.e. explicit user-initiated unlock flows).
      return getAesKeyFromProvider(accountAddress);
    },
    [sessionAesKey, getAesKeyFromProvider],
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
    }
  }, [isConnected, currentChainId, setPublicTokens, setPrivateTokens]);

  useEffect(() => {
    if (sessionAesKey && walletAddress) {
      logger.log('Session AES Key set, refreshing account state...');
      if (!hasSnap) setHasSnap(true);
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      updateAccountState(walletAddress, true, true, sessionAesKey, chainOverride).then(() => {
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
