import { useCallback } from 'react';
import { logger } from '../../lib/logger';
import { CotiPluginError, CotiErrorCode } from '../../errors';
import { clearAesKeyValidatedForUnlock, getValidatedAesKeyForUnlock } from '../../crypto/aesKeyValidation';
import {
  getInitialPrivateTokens,
} from '../../hooks/usePrivacyBridge';
import { useWalletType } from '../../hooks/useWalletType';
import type { PrivacyBridgeAccountSync } from './usePrivacyBridgeAccountSync';
import type { PrivacyBridgeNetworkSession } from './usePrivacyBridgeNetworkSession';
import type { PrivacyBridgeSessionCore } from './sessionShared';
import type { AesKeyProviderOptions } from '../../hooks/useAesKeyProvider';
import { normalizeAesKey } from '../../crypto/aesKey';
import {
  sendPrivateTokenTransfer,
  type ExecutePrivateTokenTransferResult,
} from '../../hooks/privacyBridge/executePrivateTokenTransfer';
import {
  decryptPrivateCtUint256,
  encryptPrivateCtUint256,
  parseCtUint256Json,
  parsePrivateAmountToWei,
  formatPrivateAmountFromWei,
  serializeCtUint256,
} from '../../hooks/privacyBridge/privateValueCrypto';

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
    hasSnap,
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
    hasAesKeyInSnap,
  } = core;

  const { wagmiChainId } = network;
  const { updateAccountState, currentChainId } = accountSync;
  const walletTypeInfo = useWalletType();

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

  const resolveRestoreUnlockPlan = useCallback(async (
    aesKeyOptions?: AesKeyProviderOptions,
  ): Promise<{
    unlockOptions: AesKeyProviderOptions & { validateOnUnlock: true };
    checkSnap: boolean;
    keyForUnlock: string | undefined;
    failed?: boolean;
  }> => {
    const unlockOptions = { validateOnUnlock: true as const, ...aesKeyOptions };
    const keyForUnlock =
      sessionAesKey ?? getValidatedAesKeyForUnlock(walletAddress!) ?? undefined;

    if (!aesKeyOptions?.restoreOnly || keyForUnlock) {
      return { unlockOptions, checkSnap: !keyForUnlock, keyForUnlock };
    }

    const snapInstalled =
      walletTypeInfo.walletType === 'metamask'
      && (walletTypeInfo.isMetaMaskWithSnap || hasSnap);

    if (!snapInstalled) {
      return { unlockOptions, checkSnap: true, keyForUnlock: undefined };
    }

    const snapHasKey = await hasAesKeyInSnap(walletAddress!);
    if (snapHasKey === true) {
      logger.log('Snap AES key present — unlock via Snap-side decrypt');
      return {
        unlockOptions: { ...unlockOptions, snapSideDecrypt: true },
        checkSnap: false,
        keyForUnlock: undefined,
      };
    }

    if (snapHasKey === false) {
      logger.log(
        'Snap installed but no AES key for this account — restoring from local backup without Snap persist',
      );
    }

    return { unlockOptions, checkSnap: true, keyForUnlock: undefined };
  }, [
    sessionAesKey,
    walletAddress,
    walletTypeInfo.walletType,
    walletTypeInfo.isMetaMaskWithSnap,
    hasSnap,
    hasAesKeyInSnap,
  ]);

  const refreshPrivateBalances = useCallback(async (aesKeyOptions?: AesKeyProviderOptions) => {
    if (!walletAddress) return false;

    logger.log('Triggering private balance fetch...');
    try {
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      const plan = await resolveRestoreUnlockPlan(aesKeyOptions);
      if (plan.failed) {
        return false;
      }
      const { unlockOptions, checkSnap, keyForUnlock: initialKeyForUnlock } = plan;
      let keyForUnlock = initialKeyForUnlock;

      let success = await updateAccountState(
        walletAddress,
        checkSnap,
        true,
        keyForUnlock,
        chainOverride,
        unlockOptions,
      );
      logger.log('Private balance fetch completed', { success });

      if (!success) {
        const validatedKey = getValidatedAesKeyForUnlock(walletAddress);
        if (validatedKey) {
          logger.log('Unlock validated AES key present — treating unlock as successful');
          setSessionAesKey(validatedKey, walletAddress);
          setArePrivateBalancesHidden(false);
          setSnapError(null);
          return true;
        }

        if (aesKeyOptions?.forceContractOnboarding) {
          logger.log('Forced contract onboarding did not complete — skipping interactive retry');
          return false;
        }

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
        throw new CotiPluginError(
          CotiErrorCode.SNAP_REQUIRED,
          'Snap connection failed — install or reconnect the COTI Snap.',
          err.message,
        );
      }

      if (
        err.code === 4001 ||
        err.message?.includes('User rejected') ||
        err.message?.includes('rejected the request')
      ) {
        return false;
      }

      if (
        err.message === 'SNAP_DIALOG_REJECTED' ||
        (err instanceof CotiPluginError && err.code === CotiErrorCode.SNAP_DIALOG_REJECTED)
      ) {
        if (err instanceof CotiPluginError) throw err;
        throw new CotiPluginError(
          CotiErrorCode.SNAP_DIALOG_REJECTED,
          'User dismissed the Snap dialog.',
        );
      }

      if (err.message?.includes('ACCOUNT_NOT_ONBOARDED')) {
        setSessionAesKey(null);
        clearAesKeyValidatedForUnlock(walletAddress);
        clearSnapCache();
        setArePrivateBalancesHidden(true);
        throw new CotiPluginError(
          CotiErrorCode.ACCOUNT_NOT_ONBOARDED,
          'Account has not been onboarded to the COTI network.',
          err.message,
        );
      }

      if (
        err instanceof CotiPluginError && err.code === CotiErrorCode.AES_KEY_MISMATCH
      ) {
        setSessionAesKey(null);
        clearAesKeyValidatedForUnlock(walletAddress);
        clearSnapCache();
        setArePrivateBalancesHidden(true);
        throw err;
      }

      if (err.message?.includes('AES key') || err.message?.includes('onboarding')) {
        setSessionAesKey(null);
        clearAesKeyValidatedForUnlock(walletAddress);
        clearSnapCache();
        setArePrivateBalancesHidden(true);
        throw new CotiPluginError(
          CotiErrorCode.AES_KEY_MISMATCH,
          'AES key mismatch or onboarding error.',
          err.message,
        );
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
    resolveRestoreUnlockPlan,
  ]);

  const sendPrivateToken = useCallback(async (params: {
    symbol: string;
    recipient: string;
    amount: string;
  }): Promise<ExecutePrivateTokenTransferResult> => {
    if (!walletAddress) {
      throw new Error('Wallet not connected');
    }
    if (arePrivateBalancesHidden) {
      throw new Error('Private balances are locked. Unlock to send tokens.');
    }

    const chainIdNum = Number(currentChainId);
    if (!Number.isFinite(chainIdNum) || chainIdNum <= 0) {
      throw new Error('Network not available');
    }

    const result = await sendPrivateTokenTransfer({
      chainId: chainIdNum,
      symbol: params.symbol,
      recipient: params.recipient,
      amount: params.amount,
      walletAddress,
      sessionAesKey: core.sessionAesKey,
      hasSnap: core.hasSnap,
      buildItUint256ViaSnap: core.buildItUint256ViaSnap,
    });

    await refreshPrivateBalances();
    return result;
  }, [
    walletAddress,
    arePrivateBalancesHidden,
    currentChainId,
    core.sessionAesKey,
    core.hasSnap,
    core.buildItUint256ViaSnap,
    refreshPrivateBalances,
  ]);

  const resolveActiveAesKey = useCallback((): string | null => {
    return core.sessionAesKey ?? (walletAddress ? getValidatedAesKeyForUnlock(walletAddress) : null);
  }, [core.sessionAesKey, walletAddress]);

  const encryptPrivateValue = useCallback(async (params: {
    amount: string;
    decimals?: number;
  }): Promise<{ ciphertext: string }> => {
    const activeAesKey = resolveActiveAesKey();
    if (!activeAesKey && !core.hasSnap) {
      throw new Error('Unlock private balances before encrypting values.');
    }

    const decimals = params.decimals ?? 18;
    const chainIdNum = Number(currentChainId);
    if (!Number.isFinite(chainIdNum) || chainIdNum <= 0) {
      throw new Error('Network not available');
    }

    const wei = parsePrivateAmountToWei(params.amount, decimals);

    if (core.hasSnap) {
      const ciphertext = await core.encryptUint256ViaSnap(wei, chainIdNum, walletAddress);
      if (!ciphertext) {
        throw new Error('Snap encrypt was cancelled or failed.');
      }
      return { ciphertext: serializeCtUint256(ciphertext) };
    }

    if (!activeAesKey) {
      throw new Error('AES key not available for encrypt.');
    }

    const encrypted = encryptPrivateCtUint256({
      amount: params.amount,
      decimals,
      aesKey: activeAesKey,
    });
    return { ciphertext: serializeCtUint256(encrypted) };
  }, [core.encryptUint256ViaSnap, core.hasSnap, currentChainId, resolveActiveAesKey]);

  const decryptPrivateValue = useCallback(async (params: {
    ciphertext: string;
    decimals?: number;
  }): Promise<{ amount: string }> => {
    const activeAesKey = resolveActiveAesKey();
    if (!activeAesKey && !core.hasSnap) {
      throw new Error('Unlock private balances before decrypting values.');
    }

    const decimals = params.decimals ?? 18;
    const chainIdNum = Number(currentChainId);
    if (!Number.isFinite(chainIdNum) || chainIdNum <= 0) {
      throw new Error('Network not available');
    }

    const parsed = parseCtUint256Json(params.ciphertext);

    if (core.hasSnap) {
      const wei = await core.decryptCtUint256ViaSnap(parsed, chainIdNum, walletAddress);
      if (wei === null) {
        throw new Error('Snap decrypt was cancelled or failed.');
      }
      return { amount: formatPrivateAmountFromWei(wei, decimals) };
    }

    if (!activeAesKey) {
      throw new Error('AES key not available for decrypt.');
    }

    return {
      amount: decryptPrivateCtUint256({
        ciphertext: parsed,
        decimals,
        aesKey: activeAesKey,
      }),
    };
  }, [
    core.decryptCtUint256ViaSnap,
    core.hasSnap,
    currentChainId,
    resolveActiveAesKey,
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

  const isPrivateUnlocked = !arePrivateBalancesHidden;

  return {
    handleOnboard,
    saveManualAesKey,
    unlockCachedAesKey,
    refreshPublicBalances,
    refreshPrivateBalances,
    lockPrivateBalances,
    sendPrivateToken,
    encryptPrivateValue,
    decryptPrivateValue,
    isPrivateUnlocked,
    handleVerifyKeys: handleKeyVerification,
  };
};

export type PrivacyBridgeUnlockSession = ReturnType<typeof usePrivacyBridgeUnlockSession>;
