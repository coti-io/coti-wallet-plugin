import { useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { isSnapEnabled, isAutoInitTokensEnabled } from '../../config/plugin';
import { useBalanceUpdater } from '../../hooks/useBalanceUpdater';
import { isChainUpdatesMuted } from '../../lib/chainMute';
import { logger } from '../../lib/logger';
import { getMetaMaskProvider } from '../../lib/ethereum';
import { validateMetaMaskAesKeyOnUnlock as validateMetaMaskAesKeyOnUnlockFn } from '../../crypto/aesKeyValidation';
import { useWalletType } from '../../hooks/useWalletType';
import {
  getInitialPublicTokens,
  getInitialPrivateTokens,
} from '../../hooks/usePluginBridge';
import type { PluginNetworkSession } from './usePluginNetworkSession';
import type { PluginSessionState, UpdateAccountStateRef } from './sessionShared';
import type { AesKeyProviderOptions } from '../../hooks/useAesKeyProvider';

interface UsePluginAccountSyncOptions {
  core: PluginSessionState;
  network: PluginNetworkSession;
  updateAccountStateRef: UpdateAccountStateRef;
  autoInitTokens?: boolean;
}

/** Balance refresh, token list resets, and session-key-driven account updates. */
export const usePluginAccountSync = ({
  core,
  network,
  updateAccountStateRef,
  autoInitTokens: autoInitTokensProp,
}: UsePluginAccountSyncOptions) => {
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
    checkSnapStatus,
  } = core;

  const { checkNetwork, currentChainId, wagmiChainId } = network;
  const { chainId: connectedChainId } = useAccount();
  const walletTypeInfo = useWalletType();
  const autoInitTokens = isAutoInitTokensEnabled(autoInitTokensProp);

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
      if (
        options?.skipCache
        && walletTypeInfo.walletType === 'metamask'
        && isSnapEnabled()
        && !options.forceContractOnboarding
        && !options.restoreOnly
      ) {
        return getAESKeyFromSnap(accountAddress, { skipCache: true });
      }

      // Always prioritize the in-memory session key — avoids any interactive prompts
      // during automatic balance refreshes.
      if (sessionAesKey && !options?.forceContractOnboarding) return sessionAesKey;

      // Fall through to the wallet-type-aware provider (useAesKeyProvider).
      // For MetaMask: tries Snap (non-interactive if already connected).
      // For non-MetaMask: triggers contract onboarding (interactive — but only called
      // when checkSnap=true, i.e. explicit user-initiated unlock flows).
      return options === undefined
        ? getAesKeyFromProvider(accountAddress)
        : getAesKeyFromProvider(accountAddress, options.onProgress, options);
    },
    [sessionAesKey, getAesKeyFromProvider, getAESKeyFromSnap, walletTypeInfo.walletType],
  );

  const accountState = useBalanceUpdater({
    setWalletAddress,
    setIsConnected,
    setHasSnap,
    setPublicTokens,
    setPrivateTokens,
    checkNetwork,
    getAESKeyFromSnap: getAESKeyForCurrentNetwork,
    fetchPrivateBalance,
    canUseSnapOperations:
      walletTypeInfo.walletType === 'metamask'
      && (walletTypeInfo.isMetaMaskWithSnap || hasSnap),
    snapDecryptOptions: {
      decryptCtUint64: core.decryptCtUint64ViaSnap,
      decryptCtUint256: core.decryptCtUint256ViaSnap,
    },
    sessionAesKey,
    setSessionAesKey,
    validateMetaMaskAesKeyOnUnlock,
    autoInitTokens,
  });

  updateAccountStateRef.current = accountState;

  // Proactively detect Snap on MetaMask wallet connect so hasSnap is available
  // before the user triggers refreshPrivateBalances / unlock routing.
  useEffect(() => {
    if (
      walletTypeInfo.walletType !== 'metamask'
      || !walletAddress
      || hasSnap
    ) {
      return;
    }

    checkSnapStatus().catch(() => {
      // Non-fatal — hasSnap stays false and unlock falls back to contract path.
    });
  }, [walletAddress, walletTypeInfo.walletType, hasSnap, checkSnapStatus]);

  useEffect(() => {
    if (!autoInitTokens) return;
    if (isChainUpdatesMuted()) return;

    if (!isConnected) {
      setPublicTokens(getInitialPublicTokens(currentChainId));
      setPrivateTokens(getInitialPrivateTokens(currentChainId));
    }
  }, [autoInitTokens, isConnected, currentChainId, setPublicTokens, setPrivateTokens]);

  // Track the previous sessionAesKey value so we only auto-unlock when the key
  // *arrives* for the first time (null → value), not on every render where a key
  // is already present but balances happen to be hidden (e.g. after a manual lock).
  const prevSessionAesKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const keyJustArrived = !prevSessionAesKeyRef.current && !!sessionAesKey;
    prevSessionAesKeyRef.current = sessionAesKey;

    if (keyJustArrived && sessionAesKey && walletAddress && arePrivateBalancesHidden) {
      if (!autoInitTokens) return;
      logger.log('Session AES Key arrived — refreshing private balances...');
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      accountState.refreshPrivateBalances({
        account: walletAddress,
        aesKey: sessionAesKey,
        chainId: chainOverride,
      }).then((result) => {
        if (result.ok) {
          setArePrivateBalancesHidden(false);
        }
      });
    }
  }, [
    sessionAesKey,
    walletAddress,
    arePrivateBalancesHidden,
    accountState.refreshPrivateBalances,
    setArePrivateBalancesHidden,
    wagmiSyncRef,
    wagmiChainId,
    autoInitTokens,
  ]);

  return { ...accountState, currentChainId };
};

export type PluginAccountSync = ReturnType<typeof usePluginAccountSync>;
