import { useCallback, useEffect } from 'react';
import { useAccount } from 'wagmi';
import { useBalanceUpdater } from '../../hooks/useBalanceUpdater';
import { isChainUpdatesMuted } from '../../lib/chainMute';
import { logger } from '../../lib/logger';
import { getMetaMaskProvider } from '../../lib/ethereum';
import { validateMetaMaskAesKeyOnUnlock as validateMetaMaskAesKeyOnUnlockFn } from '../../crypto/aesKeyValidation';
import { useWalletType } from '../../hooks/useWalletType';
import {
  getInitialPublicTokens,
  getInitialPrivateTokens,
} from '../../hooks/usePrivacyBridge';
import type { PrivacyBridgeNetworkSession } from './usePrivacyBridgeNetworkSession';
import type { PrivacyBridgeSessionCore, UpdateAccountStateRef } from './sessionShared';
import type { AesKeyProviderOptions } from '../../hooks/useAesKeyProvider';

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
    arePrivateBalancesHidden,
    setArePrivateBalancesHidden,
    fetchPrivateBalance,
    getAesKeyFromProvider,
    getAESKeyFromSnap,
    isConnected,
    hasSnap,
    walletAddress,
    wagmiSyncRef,
  } = core;

  const { checkNetwork, currentChainId, wagmiChainId } = network;
  const { chainId: connectedChainId } = useAccount();
  const walletTypeInfo = useWalletType();

  const validateMetaMaskAesKeyOnUnlock = useCallback(
    async (snapKey: string, accountAddress: string, chainIdOverride?: number | null) => {
      if (walletTypeInfo.walletType !== 'metamask') return;

      const provider = getMetaMaskProvider();
      if (!provider) {
        throw new Error('MetaMask provider not available for AES key validation.');
      }

      await validateMetaMaskAesKeyOnUnlockFn(
        snapKey,
        accountAddress,
        provider,
        chainIdOverride ?? connectedChainId ?? null,
      );
    },
    [walletTypeInfo.walletType, connectedChainId],
  );

  const getAESKeyForCurrentNetwork = useCallback(
    async (
      accountAddress: string,
      options?: { skipCache?: boolean } & AesKeyProviderOptions,
    ) => {
      if (options?.skipCache) {
        return getAESKeyFromSnap(accountAddress, { skipCache: true });
      }

      // Always prioritize the in-memory session key — avoids any interactive prompts
      // during automatic balance refreshes.
      if (sessionAesKey) return sessionAesKey;

      // Fall through to the wallet-type-aware provider (useAesKeyProvider).
      // For MetaMask: tries Snap (non-interactive if already connected)
      // For non-MetaMask: triggers contract onboarding (interactive — but only called
      // when checkSnap=true, i.e. explicit user-initiated unlock flows).
      return options === undefined
        ? getAesKeyFromProvider(accountAddress)
        : getAesKeyFromProvider(accountAddress, undefined, options);
    },
    [sessionAesKey, getAesKeyFromProvider, getAESKeyFromSnap],
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
    validateMetaMaskAesKeyOnUnlock,
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
    if (sessionAesKey && walletAddress && arePrivateBalancesHidden) {
      logger.log('Session AES Key set, refreshing account state...');
      if (!hasSnap) setHasSnap(true);
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      updateAccountState(walletAddress, false, true, sessionAesKey, chainOverride).then(() => {
        setArePrivateBalancesHidden(false);
      });
    }
  }, [
    sessionAesKey,
    walletAddress,
    arePrivateBalancesHidden,
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
