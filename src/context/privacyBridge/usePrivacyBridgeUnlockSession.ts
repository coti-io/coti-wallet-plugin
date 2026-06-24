import { useCallback } from 'react';
import { logger } from '../../lib/logger';
import {
  getInitialPrivateTokens,
} from '../../hooks/usePrivacyBridge';
import type { PrivacyBridgeAccountSync } from './usePrivacyBridgeAccountSync';
import type { PrivacyBridgeNetworkSession } from './usePrivacyBridgeNetworkSession';
import type { PrivacyBridgeSessionCore } from './sessionShared';

interface UsePrivacyBridgeUnlockSessionOptions {
  core: PrivacyBridgeSessionCore;
  network: PrivacyBridgeNetworkSession;
  accountSync: PrivacyBridgeAccountSync;
}

/** Snap/AES unlock, private balance refresh, and hard lock flows. */
export const usePrivacyBridgeUnlockSession = ({
  core,
  network,
  accountSync,
}: UsePrivacyBridgeUnlockSessionOptions) => {
  const {
    walletAddress,
    setHasSnap,
    snapError,
    setSnapError,
    setSessionAesKey,
    arePrivateBalancesHidden,
    setArePrivateBalancesHidden,
    handleManualOnboarding,
    handleKeyVerification,
    clearSnapCache,
    setPrivateTokens,
    wagmiSyncRef,
  } = core;

  const { wagmiChainId } = network;
  const { updateAccountState, currentChainId } = accountSync;

  const handleOnboard = async () => {
    const key = await handleManualOnboarding();
    if (key && walletAddress) setSessionAesKey(key, walletAddress);
    return key;
  };

  const saveManualAesKey = async (aesKey: string) => {
    if (!walletAddress) throw new Error('Connect your wallet first.');

    // Normalize and validate in-memory only — no localStorage persistence.
    // The key lives in React state for this session and is lost on page refresh by design.
    const trimmedKey = aesKey.trim();
    if (!trimmedKey) throw new Error('AES key is required.');
    // Accept both 32-char (128-bit from onboard contract) and 64-char (256-bit from Snap) keys
    if (!/^[0-9a-fA-F]{32}$|^[0-9a-fA-F]{64}$/.test(trimmedKey)) {
      throw new Error('AES key must be 32 or 64 hexadecimal characters (no 0x prefix).');
    }
    const key = trimmedKey.toLowerCase();

    setSessionAesKey(key, walletAddress);
    setHasSnap(true);
    setSnapError(null);

    const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
    const success = await updateAccountState(walletAddress, true, true, key, chainOverride);
    if (success) setArePrivateBalancesHidden(false);
  };

  const unlockCachedAesKey = async () => {
    // localStorage persistence has been removed — AES keys are session-only.
    // This function is kept for interface compatibility but always reports no cached key.
    throw new Error('No cached AES key. Keys are session-only and lost on page refresh.');
  };

  const refreshPrivateBalances = useCallback(async () => {
    if (!walletAddress) return false;

    logger.log('Triggering private balance fetch...');
    try {
      await new Promise(resolve => setTimeout(resolve, 800));
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      let success = await updateAccountState(walletAddress, true, true, undefined, chainOverride);
      logger.log('Private balance fetch completed', { success });

      if (!success) {
        logger.log('First private balance fetch failed, retrying after 1.5s');
        await new Promise(resolve => setTimeout(resolve, 1500));
        success = await updateAccountState(walletAddress, true, true, undefined, chainOverride);
        logger.log('Retry private balance fetch completed', { success });
      }

      if (success) {
        setArePrivateBalancesHidden(false);
        setSnapError(null);
      }
      return success;
    } catch (err: any) {
      logger.log('Unlock logic caught error', { code: err.code, name: err.name });

      if (err.message === 'SNAP_CONNECT_FAILED' || err.message?.includes('SNAP_CONNECT_FAILED')) {
        throw new Error('SNAP_REQUIRED');
      }

      if (
        err.code === 4001 ||
        err.message?.includes('User rejected') ||
        err.message?.includes('rejected the request')
      ) {
        return false;
      }

      if (err.message === 'SNAP_DIALOG_REJECTED') throw err;

      if (err.message?.includes('ACCOUNT_NOT_ONBOARDED')) {
        setSessionAesKey(null);
        clearSnapCache();
        setArePrivateBalancesHidden(true);
        throw new Error('SNAP_REQUIRED');
      }

      if (err.message?.includes('AES key') || err.message?.includes('onboarding')) {
        setSessionAesKey(null);
        clearSnapCache();
        setArePrivateBalancesHidden(true);
        const mismatchError = new Error('AES_KEY_MISMATCH');
        (mismatchError as any).detail = err.message;
        throw mismatchError;
      }
      return false;
    }
  }, [
    walletAddress,
    updateAccountState,
    wagmiChainId,
    clearSnapCache,
    setSessionAesKey,
    setArePrivateBalancesHidden,
    setSnapError,
    wagmiSyncRef,
  ]);

  const lockPrivateBalances = () => {
    logger.log('Hard locking private balances and clearing caches');
    setArePrivateBalancesHidden(true);
    setSessionAesKey(null);
    clearSnapCache();
    setPrivateTokens(getInitialPrivateTokens(currentChainId));
  };

  const isPrivateUnlocked = !!core.sessionAesKey && !arePrivateBalancesHidden;

  return {
    handleOnboard,
    saveManualAesKey,
    unlockCachedAesKey,
    refreshPrivateBalances,
    lockPrivateBalances,
    isPrivateUnlocked,
    handleVerifyKeys: handleKeyVerification,
  };
};

export type PrivacyBridgeUnlockSession = ReturnType<typeof usePrivacyBridgeUnlockSession>;
