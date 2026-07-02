import { useCallback } from 'react';
import { logger } from '../../lib/logger';
import { CotiPluginError, CotiErrorCode } from '../../errors';
import { clearAesKeyValidatedForUnlock, getValidatedAesKeyForUnlock } from '../../crypto/aesKeyValidation';
import {
  getInitialPrivateTokens,
} from '../../hooks/usePrivacyBridge';
import type { PrivacyBridgeAccountSync } from './usePrivacyBridgeAccountSync';
import type { PrivacyBridgeNetworkSession } from './usePrivacyBridgeNetworkSession';
import type { PrivacyBridgeSessionCore } from './sessionShared';
import type { AesKeyProviderOptions } from '../../hooks/useAesKeyProvider';
import { normalizeAesKey } from '../../crypto/aesKey';

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
    sessionAesKey,
    setHasSnap,
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
    let key: string;
    try {
      key = normalizeAesKey(aesKey.trim());
    } catch {
      throw new Error('AES key must be 32 hexadecimal characters.');
    }

    setSessionAesKey(key, walletAddress);
    setHasSnap(true);
    setSnapError(null);

    const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
    const success = await updateAccountState(walletAddress, true, true, key, chainOverride);
    if (success) setArePrivateBalancesHidden(false);
  };

  const unlockCachedAesKey = async () => {
    // If the session key is still in memory (user locked without page reload), reuse it.
    const existingKey = core.sessionAesKey;
    if (existingKey && walletAddress) {
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      const success = await updateAccountState(walletAddress, false, true, existingKey, chainOverride);
      if (success) {
        setArePrivateBalancesHidden(false);
        return;
      }
    }
    // No in-memory key and no localStorage fallback — caller must re-onboard.
    throw new Error('No cached AES key. Keys are session-only and lost on page refresh.');
  };

  const refreshPublicBalances = useCallback(async () => {
    if (!walletAddress) return false;

    logger.log('Triggering public balance fetch...');
    try {
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      return await updateAccountState(walletAddress, false, false, undefined, chainOverride);
    } catch (err: unknown) {
      logger.warn('Public balance fetch failed', err);
      return false;
    }
  }, [walletAddress, updateAccountState, wagmiChainId, wagmiSyncRef]);

  const refreshPrivateBalances = useCallback(async (aesKeyOptions?: AesKeyProviderOptions) => {
    if (!walletAddress) return false;

    logger.log('Triggering private balance fetch...');
    try {
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      const unlockOptions = { validateOnUnlock: true as const, ...aesKeyOptions };
      let keyForUnlock =
        sessionAesKey ?? getValidatedAesKeyForUnlock(walletAddress) ?? undefined;
      let success = await updateAccountState(
        walletAddress,
        !keyForUnlock,
        true,
        keyForUnlock,
        chainOverride,
        unlockOptions,
      );
      logger.log('Private balance fetch completed', { success });

      if (!success) {
        keyForUnlock =
          keyForUnlock ?? getValidatedAesKeyForUnlock(walletAddress) ?? undefined;
        logger.log('First private balance fetch failed, retrying after 1.5s');
        await new Promise(resolve => setTimeout(resolve, 1500));
        success = await updateAccountState(
          walletAddress,
          false,
          true,
          keyForUnlock,
          chainOverride,
          unlockOptions,
        );
        logger.log('Retry private balance fetch completed', { success });
      }

      const validatedKey = getValidatedAesKeyForUnlock(walletAddress);
      if (!success && validatedKey) {
        logger.log('Unlock validated AES key present — treating unlock as successful');
        setSessionAesKey(validatedKey, walletAddress);
        setArePrivateBalancesHidden(false);
        setSnapError(null);
        return true;
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
        clearAesKeyValidatedForUnlock(walletAddress);
        clearSnapCache();
        setArePrivateBalancesHidden(true);
        throw new Error('SNAP_REQUIRED');
      }

      if (
        err instanceof CotiPluginError && err.code === CotiErrorCode.AES_KEY_MISMATCH
      ) {
        setSessionAesKey(null);
        clearAesKeyValidatedForUnlock(walletAddress);
        clearSnapCache();
        setArePrivateBalancesHidden(true);
        const mismatchError = new Error('AES_KEY_MISMATCH');
        (mismatchError as any).detail = err.message;
        throw mismatchError;
      }

      if (err.message?.includes('AES key') || err.message?.includes('onboarding')) {
        setSessionAesKey(null);
        clearAesKeyValidatedForUnlock(walletAddress);
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
    sessionAesKey,
    updateAccountState,
    wagmiChainId,
    clearSnapCache,
    setSessionAesKey,
    setArePrivateBalancesHidden,
    setSnapError,
    wagmiSyncRef,
  ]);

  const lockPrivateBalances = () => {
    logger.log('Locking private balances (AES key preserved in session for re-unlock)');
    setArePrivateBalancesHidden(true);
    // NOTE: We intentionally do NOT clear sessionAesKey here.
    // The key stays in React state for the lifetime of the browser session so the
    // user can unlock again without going through onboarding.  The key is only
    // discarded on wallet disconnect or an AES_KEY_MISMATCH error.
    setPrivateTokens(getInitialPrivateTokens(currentChainId));
  };

  const isPrivateUnlocked = !arePrivateBalancesHidden && (!!core.sessionAesKey || core.hasSnap);

  return {
    handleOnboard,
    saveManualAesKey,
    unlockCachedAesKey,
    refreshPublicBalances,
    refreshPrivateBalances,
    lockPrivateBalances,
    isPrivateUnlocked,
    handleVerifyKeys: handleKeyVerification,
  };
};

export type PrivacyBridgeUnlockSession = ReturnType<typeof usePrivacyBridgeUnlockSession>;
