import { useEffect, useRef } from 'react';
import { getPluginConfig } from '../../config/plugin';
import { mapConnectorIdToWalletType } from '../../hooks/useWalletType';
import { isChainUpdatesMuted } from '../../lib/chainMute';
import { logger } from '../../lib/logger';
import { truncateAddress } from '../../lib/format';
import { clearAesKeyValidatedForUnlock } from '../../crypto/aesKeyValidation';
import { getInitialPrivateTokens, getInitialPublicTokens } from '../../hooks/usePrivacyBridge';
import { reportPluginError, hasCotiErrorCode, CotiErrorCode } from '../../errors';
import { isRateLimitedRpcError } from '../../lib/rpcProvider';
import type { PrivacyBridgeAccountSync } from './usePrivacyBridgeAccountSync';
import type { PrivacyBridgeNetworkSession } from './usePrivacyBridgeNetworkSession';
import type { PrivacyBridgeSessionCore } from './sessionShared';

const reportBalanceRefreshFailure = (context: string, err: unknown) => {
  logger.error(context, err);
  if (
    hasCotiErrorCode(err, CotiErrorCode.RPC_RATE_LIMITED)
    || isRateLimitedRpcError(err)
  ) {
    reportPluginError(err);
  }
};

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
    setPublicTokens,
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
      void updateAccountState(wagmiAddress, false, true, undefined, wagmiChainId).catch(err => {
        reportBalanceRefreshFailure('Wagmi connect balance refresh failed', err);
      });

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
        if (walletAddress) clearAesKeyValidatedForUnlock(walletAddress);
        if (wagmiAddress) clearAesKeyValidatedForUnlock(wagmiAddress);
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
      void updateAccountState(wagmiAddress, false, false, undefined, wagmiChainId).catch(err => {
        reportBalanceRefreshFailure('Wagmi account-switch balance refresh failed', err);
      });
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
        // Swap both lists to the new chain together so Index pairing never
        // mixes Fuji publics with COTI privates (or the reverse) mid-refresh.
        setPublicTokens(getInitialPublicTokens(wagmiChainId));
        setPrivateTokens(getInitialPrivateTokens(wagmiChainId));
        // When a session AES key exists, re-fetch with the key so balances refill.
        if (core.sessionAesKey) {
          logger.log('[ChainChange] sessionAesKey present — refreshing with private balances', {
            from: prevWagmiChainIdRef.current,
            to: wagmiChainId,
          });
          prevWagmiChainIdRef.current = wagmiChainId;
          void updateAccountState(wagmiAddress, true, true, core.sessionAesKey, wagmiChainId).catch(err => {
            reportBalanceRefreshFailure('Wagmi chain-change balance refresh failed', err);
          });
          return;
        }
        logger.log('RainbowKit chain changed', {
          from: prevWagmiChainIdRef.current,
          to: wagmiChainId,
        });
        void updateAccountState(wagmiAddress, false, true, undefined, wagmiChainId).catch(err => {
          reportBalanceRefreshFailure('Wagmi chain-change balance refresh failed', err);
        });
      }
      prevWagmiChainIdRef.current = wagmiChainId;
    }
  }, [
    wagmiConnected,
    wagmiAddress,
    walletAddress,
    isConnected,
    wagmiChainId,
    updateAccountState,
    core.sessionAesKey,
    setPrivateTokens,
    setPublicTokens,
  ]);
};
