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
    isConnected,
    hasSnap,
    walletAddress,
    wagmiSyncRef,
  } = core;

  const { checkNetwork, currentChainId, wagmiChainId } = network;

  const getAESKeyForCurrentNetwork = useCallback(
    async (accountAddress: string) => {
      // Always prioritize the in-memory session key — this avoids any interactive
      // wallet prompts (personal_sign, Snap dialogs, onboarding) during automatic
      // balance refreshes. The session key is set once during explicit user unlock
      // and reused for the entire session.
      if (sessionAesKey) return sessionAesKey;

      // If no session key is available, do NOT trigger interactive flows here.
      // This function is called from automatic balance refreshes — prompting the user
      // for a signature or launching contract onboarding would cause repeated,
      // unexpected popups. Return null to signal "key unavailable" and let the UI
      // show locked/zero private balances until the user explicitly unlocks again.
      logger.log('ℹ️ [getAESKeyForCurrentNetwork] No session AES key — skipping interactive retrieval');
      return null;
    },
    [sessionAesKey],
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
