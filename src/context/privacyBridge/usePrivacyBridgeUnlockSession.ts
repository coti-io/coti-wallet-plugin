import { useCallback } from 'react';
import { useAccount } from 'wagmi';
import { logger } from '../../lib/logger';
import { resolveConnectedProvider } from '../../lib/ethereum';
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
  type AesUnlockPlan,
  buildUnlockPlanFromStrategy,
  resolveAesAccessStrategy,
  resolveRestoreAesAccessStrategy,
  shouldUseLocalCrypto,
  shouldUseSnapCrypto,
} from '../../lib/aesAccessStrategy';
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
    setSnapError,
    setSessionAesKey,
    aesKeyChainId,
    setAesKeyChainId,
    arePrivateBalancesHidden,
    setArePrivateBalancesHidden,
    handleManualOnboarding,
    handleKeyVerification,
    clearSnapCache,
    setPrivateTokens,
    wagmiSyncRef,
    hasAesKeyInSnap,
    checkSnapStatus,
    getAESKeyFromSnap,
    encryptUint256ViaSnap,
    decryptCtUint256ViaSnap,
  } = core;

  const { wagmiChainId } = network;
  const { updateAccountState, currentChainId } = accountSync;
  const walletTypeInfo = useWalletType();
  // Connector for the wallet the user selected via RainbowKit/wagmi — used to
  // resolve the EIP-1193 provider instead of window.ethereum, which is
  // unreliable when multiple wallet extensions are installed.
  const { connector } = useAccount();

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

    const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
    const success = await updateAccountState(walletAddress, true, true, key, chainOverride);
    if (!success) {
      setSessionAesKey(null);
      setArePrivateBalancesHidden(true);
      throw new Error('Wrong AES key');
    }
    setSessionAesKey(key, walletAddress);
    setSnapError(null);
    setArePrivateBalancesHidden(false);
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

  const resolveSessionAesKey = useCallback((): string | undefined => {
    return sessionAesKey
      ?? (walletAddress ? getValidatedAesKeyForUnlock(walletAddress) ?? undefined : undefined);
  }, [sessionAesKey, walletAddress]);

  const resolveAesAccess = useCallback(async (overrideAesKeyChainId?: number) => {
    if (!walletAddress) {
      throw new Error('Wallet not connected');
    }

    const chainIdNum = Number(currentChainId);
    if (!Number.isFinite(chainIdNum) || chainIdNum <= 0) {
      throw new Error('Network not available');
    }

    const isMetaMask = walletTypeInfo.walletType === 'metamask';
    const snapInstalled = isMetaMask ? await checkSnapStatus() : false;

    return resolveAesAccessStrategy({
      address: walletAddress,
      chainId: chainIdNum,
      aesKeyChainId: overrideAesKeyChainId ?? aesKeyChainId,
      snapInstalled,
      sessionAesKey: resolveSessionAesKey(),
      hasAesKeyInSnap,
      confirmSnapInstalled: isMetaMask ? checkSnapStatus : undefined,
    });
  }, [
    currentChainId,
    aesKeyChainId,
    checkSnapStatus,
    hasAesKeyInSnap,
    resolveSessionAesKey,
    walletAddress,
    walletTypeInfo.walletType,
  ]);

  const resolveRestoreUnlockPlan = useCallback(async (
    aesKeyOptions?: AesKeyProviderOptions,
  ): Promise<AesUnlockPlan & { failed?: true }> => {
    if (!walletAddress) {
      return {
        unlockOptions: { validateOnUnlock: true as const, ...aesKeyOptions },
        checkSnap: true,
        keyForUnlock: undefined,
        failed: true as const,
      };
    }

    const unlockOptions = { validateOnUnlock: true as const, ...aesKeyOptions };
    const sessionKey = resolveSessionAesKey();

    if (aesKeyOptions?.forceContractOnboarding) {
      return {
        unlockOptions,
        checkSnap: !sessionKey,
        keyForUnlock: sessionKey,
        accessMode: 'onboard' as const,
      };
    }

    const chainIdNum = Number(currentChainId);
    if (!Number.isFinite(chainIdNum) || chainIdNum <= 0) {
      return {
        unlockOptions,
        checkSnap: true,
        keyForUnlock: sessionKey,
        failed: true as const,
      };
    }

    const isMetaMask = walletTypeInfo.walletType === 'metamask';
    const strategy = aesKeyOptions?.restoreOnly
      ? await resolveRestoreAesAccessStrategy({
        address: walletAddress,
        chainId: chainIdNum,
        aesKeyChainId: aesKeyOptions?.aesKeyChainId ?? aesKeyChainId,
        snapInstalled: isMetaMask ? await checkSnapStatus() : false,
        sessionAesKey: resolveSessionAesKey(),
        hasAesKeyInSnap,
        confirmSnapInstalled: isMetaMask ? checkSnapStatus : undefined,
      })
      : await resolveAesAccess(aesKeyOptions?.aesKeyChainId);
    return buildUnlockPlanFromStrategy(strategy, unlockOptions, sessionKey);
  }, [resolveAesAccess, resolveSessionAesKey, walletAddress, aesKeyChainId, checkSnapStatus, hasAesKeyInSnap, walletTypeInfo.walletType, currentChainId]);

  const refreshPrivateBalances = useCallback(async (aesKeyOptions?: AesKeyProviderOptions) => {
    if (!walletAddress) return false;

    logger.log('Triggering private balance fetch...');
    try {
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      const plan = await resolveRestoreUnlockPlan(aesKeyOptions);
      if (plan.failed === true) {
        return false;
      }
      const {
        unlockOptions,
        checkSnap,
        keyForUnlock: initialKeyForUnlock,
        accessMode,
      } = plan;
      let keyForUnlock = initialKeyForUnlock;

      if (
        aesKeyOptions?.restoreOnly
        && accessMode === 'onboard'
        && !keyForUnlock
      ) {
        logger.log('Restore-only probe: account needs onboarding — skipping balance fetch');
        return false;
      }

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
        if (aesKeyOptions?.forceContractOnboarding) {
          logger.log('Forced contract onboarding did not complete — skipping interactive retry');
          return false;
        }

        if (aesKeyOptions?.restoreOnly) {
          logger.log('Restore-only unlock did not complete — skipping retry');
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

      if (success) {
        setArePrivateBalancesHidden(false);
        setSnapError(null);
      } else if (aesKeyOptions?.forceContractOnboarding) {
        setArePrivateBalancesHidden(true);
        if (walletAddress) {
          clearAesKeyValidatedForUnlock(walletAddress);
        }
        setSessionAesKey(null);
      }
      return success;
    } catch (err: unknown) {
      const errorInfo = err as { code?: number | string; name?: string; message?: string };
      logger.log('Unlock logic caught error', { code: errorInfo.code, name: errorInfo.name });

      if (
        err instanceof CotiPluginError
        && (err.code === CotiErrorCode.SNAP_CONNECT_FAILED
          || err.code === CotiErrorCode.SNAP_KEY_CHECK_FAILED)
      ) {
        throw err;
      }

      if (errorInfo.message === 'SNAP_CONNECT_FAILED' || errorInfo.message?.includes('SNAP_CONNECT_FAILED')) {
        throw new CotiPluginError(
          CotiErrorCode.SNAP_REQUIRED,
          'Snap connection failed — install or reconnect the COTI Snap.',
          errorInfo.message,
        );
      }

      if (
        errorInfo.code === 4001 ||
        errorInfo.message?.includes('User rejected') ||
        errorInfo.message?.includes('rejected the request')
      ) {
        return false;
      }

      if (
        errorInfo.message === 'SNAP_DIALOG_REJECTED' ||
        (err instanceof CotiPluginError && err.code === CotiErrorCode.SNAP_DIALOG_REJECTED)
      ) {
        if (err instanceof CotiPluginError) throw err;
        throw new CotiPluginError(
          CotiErrorCode.SNAP_DIALOG_REJECTED,
          'User dismissed the Snap dialog.',
        );
      }

      if (errorInfo.message?.includes('ACCOUNT_NOT_ONBOARDED')) {
        setSessionAesKey(null);
        clearAesKeyValidatedForUnlock(walletAddress);
        clearSnapCache();
        setArePrivateBalancesHidden(true);
        throw new CotiPluginError(
          CotiErrorCode.ACCOUNT_NOT_ONBOARDED,
          'Account has not been onboarded to the COTI network.',
          errorInfo.message,
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

      if (errorInfo.message?.includes('AES key') || errorInfo.message?.includes('onboarding')) {
        setSessionAesKey(null);
        clearAesKeyValidatedForUnlock(walletAddress);
        clearSnapCache();
        setArePrivateBalancesHidden(true);
        throw new CotiPluginError(
          CotiErrorCode.AES_KEY_MISMATCH,
          'AES key mismatch or onboarding error.',
          errorInfo.message,
        );
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

    const strategy = await resolveAesAccess();
    const sessionKey = resolveSessionAesKey();
    const provider = await resolveConnectedProvider(connector);

    const result = await sendPrivateTokenTransfer({
      chainId: chainIdNum,
      symbol: params.symbol,
      recipient: params.recipient,
      amount: params.amount,
      walletAddress,
      provider,
      sessionAesKey: sessionKey,
      hasSnap: strategy.snapInstalled,
      getAESKeyFromSnap: strategy.snapInstalled ? getAESKeyFromSnap : undefined,
    });

    await refreshPrivateBalances();
    return result;
  }, [
    walletAddress,
    arePrivateBalancesHidden,
    currentChainId,
    connector,
    getAESKeyFromSnap,
    refreshPrivateBalances,
    resolveAesAccess,
    resolveSessionAesKey,
  ]);

  const encryptPrivateValue = useCallback(async (params: {
    amount: string;
    decimals?: number;
  }): Promise<{ ciphertext: string }> => {
    const strategy = await resolveAesAccess();
    const sessionKey = resolveSessionAesKey();

    if (strategy.mode === 'onboard') {
      throw new Error('Unlock private balances before encrypting values.');
    }

    const decimals = params.decimals ?? 18;
    const chainIdNum = Number(currentChainId);
    const wei = parsePrivateAmountToWei(params.amount, decimals);

    if (shouldUseSnapCrypto(strategy)) {
      const ciphertext = await encryptUint256ViaSnap(wei, chainIdNum, walletAddress);
      if (!ciphertext) {
        throw new Error('Snap encrypt was cancelled or failed.');
      }
      return { ciphertext: serializeCtUint256(ciphertext) };
    }

    const localAesKey = shouldUseLocalCrypto(strategy, sessionKey) ? sessionKey : undefined;
    if (!localAesKey) {
      throw new Error('Unlock private balances before encrypting values.');
    }

    const encrypted = encryptPrivateCtUint256({
      amount: params.amount,
      decimals,
      aesKey: localAesKey,
    });
    return { ciphertext: serializeCtUint256(encrypted) };
  }, [
    encryptUint256ViaSnap,
    currentChainId,
    resolveAesAccess,
    resolveSessionAesKey,
    walletAddress,
  ]);

  const decryptPrivateValue = useCallback(async (params: {
    ciphertext: string;
    decimals?: number;
  }): Promise<{ amount: string }> => {
    const strategy = await resolveAesAccess();
    const sessionKey = resolveSessionAesKey();

    if (strategy.mode === 'onboard') {
      throw new Error('Unlock private balances before decrypting values.');
    }

    const decimals = params.decimals ?? 18;
    const chainIdNum = Number(currentChainId);
    const parsed = parseCtUint256Json(params.ciphertext);

    if (shouldUseSnapCrypto(strategy)) {
      const wei = await decryptCtUint256ViaSnap(parsed, chainIdNum, walletAddress);
      if (wei === null) {
        throw new Error('Snap decrypt was cancelled or failed.');
      }
      return { amount: formatPrivateAmountFromWei(wei, decimals) };
    }

    const localAesKey = shouldUseLocalCrypto(strategy, sessionKey) ? sessionKey : undefined;
    if (!localAesKey) {
      throw new Error('Unlock private balances before decrypting values.');
    }

    return {
      amount: decryptPrivateCtUint256({
        ciphertext: parsed,
        decimals,
        aesKey: localAesKey,
      }),
    };
  }, [
    decryptCtUint256ViaSnap,
    currentChainId,
    resolveAesAccess,
    resolveSessionAesKey,
    walletAddress,
  ]);

  const lockPrivateBalances = () => {
    logger.log('Locking private balances (clearing session AES key)');
    setArePrivateBalancesHidden(true);
    setSessionAesKey(null);
    if (walletAddress) clearAesKeyValidatedForUnlock(walletAddress);
    // Snap-stored key is left intact; unlock re-routes via Snap / backup / onboard.
    setPrivateTokens(getInitialPrivateTokens(currentChainId));
  };

  const isPrivateUnlocked = !arePrivateBalancesHidden;

  return {
    handleOnboard,
    saveManualAesKey,
    refreshPublicBalances,
    refreshPrivateBalances,
    lockPrivateBalances,
    sendPrivateToken,
    encryptPrivateValue,
    decryptPrivateValue,
    isPrivateUnlocked,
    handleVerifyKeys: handleKeyVerification,
    aesKeyChainId,
    setAesKeyChainId,
  };
};

export type PrivacyBridgeUnlockSession = ReturnType<typeof usePrivacyBridgeUnlockSession>;
