import { useCallback } from 'react';
import { useAccount } from 'wagmi';
import { getPluginConfig, isAutoInitTokensEnabled } from '../../config/plugin';
import { logger } from '../../lib/logger';
import { resolveConnectedProvider } from '../../lib/ethereum';
import { CotiErrorCode, CotiPluginError, hasCotiErrorCode, isCotiPluginError } from '../../errors';
import { isUserRejection } from '../../lib/walletErrors';
import { clearAesKeyValidatedForUnlock, getValidatedAesKeyForUnlock } from '../../crypto/aesKeyValidation';
import {
  getInitialPrivateTokens,
} from '../../hooks/usePluginBridge';
import { useWalletType } from '../../hooks/useWalletType';
import type { PluginAccountSync } from './usePluginAccountSync';
import type { PluginNetworkSession } from './usePluginNetworkSession';
import {
  ACCOUNT_STATE_OK,
  accountStateFailed,
  type AccountStateFailureReason,
  type AccountStateResult,
  type PluginSessionState,
} from './sessionShared';
import type { AesKeyProviderOptions } from '../../hooks/useAesKeyProvider';
import { normalizeAesKey } from '../../crypto/aesKey';
import { resolveAesKeyChainId } from '../../lib/aesAccessStrategy';
import { persistEncryptedAesBackup } from '../../lib/persistEncryptedAesBackup';
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
} from '../../hooks/bridge/executePrivateTokenTransfer';
import {
  decryptPrivateCtUint256,
  encryptPrivateCtUint256,
  parseCtUint256Json,
  parsePrivateAmountToWei,
  formatPrivateAmountFromWei,
  serializeCtUint256,
} from '../../hooks/bridge/privateValueCrypto';
import type { RefreshPrivateBalancesOptions } from './types';
import { allowSnapOperations } from '../../hooks/accountState/aesSession';

interface UsePluginUnlockSessionOptions {
  core: PluginSessionState;
  network: PluginNetworkSession;
  accountSync: PluginAccountSync;
  autoInitTokens?: boolean;
}

/** Snap/AES unlock, private balance refresh, and hard lock flows. */
export const usePluginUnlockSession = ({
  core,
  network,
  accountSync,
  autoInitTokens: autoInitTokensProp,
}: UsePluginUnlockSessionOptions) => {
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
    hasSnap,
    hasAesKeyInSnap,
    checkSnapStatus,
    getAESKeyFromSnap,
    encryptUint256ViaSnap,
    decryptCtUint256ViaSnap,
  } = core;

  const { wagmiChainId } = network;
  const {
    establishAesSession,
    refreshPublicBalances: syncPublicBalances,
    refreshPrivateBalances: syncPrivateBalances,
    currentChainId,
  } = accountSync;
  const autoInitTokens = isAutoInitTokensEnabled(autoInitTokensProp);
  const walletTypeInfo = useWalletType();
  // Connector for the wallet the user selected via RainbowKit/wagmi — used to
  // resolve the EIP-1193 provider instead of window.ethereum, which is
  // unreliable when multiple wallet extensions are installed.
  const { connector } = useAccount();

  const canUseSnapOperations =
    walletTypeInfo.walletType === 'metamask'
    && (walletTypeInfo.isMetaMaskWithSnap || hasSnap);

  type ComposeUnlockResult =
    | { ok: true; restoredAesKey: string | null }
    | { ok: false; reason: AccountStateFailureReason; restoredAesKey?: string | null };

  const toHostResult = (result: ComposeUnlockResult): AccountStateResult =>
    result.ok ? ACCOUNT_STATE_OK : accountStateFailed(result.reason);

  const composeUnlockRefresh = async ({
    account,
    chainId,
    aesKey,
    checkSnap,
    options,
  }: {
    account: string;
    chainId?: number;
    aesKey?: string;
    checkSnap?: boolean;
    options?: Parameters<typeof establishAesSession>[0]['options'];
  }): Promise<ComposeUnlockResult> => {
    const aes = await establishAesSession({
      account,
      chainId,
      aesKey,
      checkSnap,
      options,
    });
    if (!aes.ok) return aes;
    if (!autoInitTokens) return { ok: true, restoredAesKey: aes.aesKey };
    if (!options?.restoreOnly) {
      const pub = await syncPublicBalances({ account, chainId });
      if (!pub.ok) return { ...pub, restoredAesKey: aes.aesKey };
    }
    const priv = await syncPrivateBalances({
      account,
      chainId,
      aesKey: aesKey ?? aes.aesKey,
      allowSnapDecrypt: allowSnapOperations(canUseSnapOperations, options),
    });
    if (!priv.ok) return { ...priv, restoredAesKey: aes.aesKey };
    return { ok: true, restoredAesKey: aes.aesKey };
  };

  const commitAesKeyUnlock = async (key: string): Promise<void> => {
    if (!walletAddress) throw new Error('Connect your wallet first.');

    const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
    try {
      const result = await composeUnlockRefresh({
        account: walletAddress,
        aesKey: key,
        chainId: chainOverride,
        checkSnap: true,
      });
      if (!result.ok) {
        throw new Error('Could not unlock private balances. Try again.');
      }
      setSessionAesKey(key, walletAddress);
      setSnapError(null);
      setArePrivateBalancesHidden(false);
    } catch (err: unknown) {
      if (
        err instanceof CotiPluginError
        && (err.code === CotiErrorCode.AES_KEY_MISMATCH
          || err.code === CotiErrorCode.ACCOUNT_NOT_ONBOARDED)
      ) {
        setSessionAesKey(null);
        clearAesKeyValidatedForUnlock(walletAddress);
        clearSnapCache();
        setArePrivateBalancesHidden(true);
      }
      throw err;
    }
  };

  const handleOnboard = async () => {
    const key = await handleManualOnboarding();
    if (!key || !walletAddress) return key;

    await commitAesKeyUnlock(key);
    return key;
  };

  const saveManualAesKey = async (
    aesKey: string,
    options?: Pick<AesKeyProviderOptions, 'saveBackup' | 'onProgress'>,
  ): Promise<{ backupWarning?: string; backupCancelled?: boolean }> => {
    if (!walletAddress) throw new Error('Connect your wallet first.');

    // Normalize and validate in-memory only — no localStorage persistence unless saveBackup is enabled.
    let key: string;
    try {
      key = normalizeAesKey(aesKey.trim());
    } catch {
      throw new Error('AES key must be 32 hexadecimal characters.');
    }

    await commitAesKeyUnlock(key);

    if (options?.saveBackup && connector) {
      const targetChainId = resolveAesKeyChainId(
        wagmiSyncRef.current ? wagmiChainId : Number(currentChainId),
        aesKeyChainId,
      );
      const backupResult = await persistEncryptedAesBackup({
        aesKey: key,
        address: walletAddress,
        chainId: targetChainId,
        connector,
        onBeforeSign: () => options.onProgress?.('signing-backup'),
      });
      options.onProgress?.('idle');

      if (backupResult.status === 'failed') {
        logger.warn(
          'Manual AES unlock succeeded but encrypted backup save failed:',
          backupResult.code,
          backupResult.message,
        );
        const unsupported =
          backupResult.code === CotiErrorCode.AES_BACKUP_WALLET_NOT_SUPPORTED;
        return {
          backupWarning: unsupported
            ? `This wallet cannot save a recoverable encrypted backup. ${backupResult.message}`
            : `Encrypted backup was not saved. ${backupResult.message}`,
        };
      } else if (backupResult.status === 'cancelled') {
        logger.warn('Manual AES unlock succeeded but encrypted backup save was cancelled.');
        return {
          backupWarning: 'Encrypted backup save was cancelled. Your key works for this session.',
          backupCancelled: true,
        };
      }
    }
    return {};
  };

  const refreshPublicBalances = useCallback(async (): Promise<AccountStateResult> => {
    if (!walletAddress) return accountStateFailed('not_connected');

    logger.log('Triggering public balance fetch...');
    try {
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      return await syncPublicBalances({
        account: walletAddress,
        chainId: chainOverride,
      });
    } catch (err: unknown) {
      logger.warn('Public balance fetch failed', err);
      return accountStateFailed('failed');
    }
  }, [walletAddress, syncPublicBalances, wagmiChainId, wagmiSyncRef]);

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
    if (aesKeyOptions?.forceContractOnboarding) {
      return {
        unlockOptions,
        checkSnap: true,
        keyForUnlock: undefined,
        accessMode: 'onboard' as const,
      };
    }

    const sessionKey = resolveSessionAesKey();

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

  const refreshPrivateBalances = useCallback(async (
    aesKeyOptions?: RefreshPrivateBalancesOptions,
  ): Promise<AccountStateResult> => {
    if (!walletAddress) return accountStateFailed('not_connected');

    const lockSessionOnAesFailure = !aesKeyOptions?.preserveSessionOnError;
    const clearSessionAfterAesFailure = () => {
      setSessionAesKey(null);
      clearAesKeyValidatedForUnlock(walletAddress);
      clearSnapCache();
      setArePrivateBalancesHidden(true);
    };

    logger.log('Triggering private balance fetch...');
    try {
      const chainOverride = wagmiSyncRef.current ? wagmiChainId : undefined;
      const plan = await resolveRestoreUnlockPlan(aesKeyOptions);
      if (plan.failed === true) {
        return accountStateFailed('unsupported_chain');
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
        return accountStateFailed('no_aes_key');
      }

      let result = await composeUnlockRefresh({
        account: walletAddress,
        checkSnap,
        aesKey: keyForUnlock,
        chainId: chainOverride,
        options: unlockOptions,
      });
      logger.log('Private balance fetch completed', { success: result.ok });

      if (!result.ok) {
        if (aesKeyOptions?.forceContractOnboarding) {
          logger.log('Forced contract onboarding did not complete — skipping interactive retry');
          return toHostResult(result);
        }

        const restoredKey = result.restoredAesKey ?? keyForUnlock;
        if (aesKeyOptions?.restoreOnly) {
          if (
            !restoredKey
            || result.reason === 'no_aes_key'
            || result.reason === 'user_rejected'
          ) {
            logger.log('Restore-only unlock did not complete — skipping retry');
            return toHostResult(result);
          }
          logger.log('Restore-only catalog did not complete after AES session — retrying');
          result = await composeUnlockRefresh({
            account: walletAddress,
            checkSnap,
            aesKey: restoredKey,
            chainId: chainOverride,
            options: unlockOptions,
          });
          logger.log('Restore-only catalog retry completed', { success: result.ok });
        } else {
          keyForUnlock =
            keyForUnlock ?? getValidatedAesKeyForUnlock(walletAddress) ?? undefined;
          logger.log('First private balance fetch failed, retrying after 1.5s');
          await new Promise(resolve => setTimeout(resolve, 1500));
          result = await composeUnlockRefresh({
            account: walletAddress,
            aesKey: keyForUnlock,
            chainId: chainOverride,
            options: unlockOptions,
          });
          logger.log('Retry private balance fetch completed', { success: result.ok });
        }
      }

      if (result.ok) {
        setArePrivateBalancesHidden(false);
        setSnapError(null);
      }
      return toHostResult(result);
    } catch (err: unknown) {
      const errorInfo = err as { code?: number | string; name?: string };
      logger.log('Unlock logic caught error', { code: errorInfo.code, name: errorInfo.name });

      const rethrowCoded = (code: CotiErrorCode, message: string): never => {
        throw isCotiPluginError(err) ? err : new CotiPluginError(code, message);
      };

      if (
        hasCotiErrorCode(err, CotiErrorCode.SNAP_CONNECT_FAILED)
        || hasCotiErrorCode(err, CotiErrorCode.SNAP_KEY_CHECK_FAILED)
      ) {
        rethrowCoded(
          hasCotiErrorCode(err, CotiErrorCode.SNAP_KEY_CHECK_FAILED)
            ? CotiErrorCode.SNAP_KEY_CHECK_FAILED
            : CotiErrorCode.SNAP_CONNECT_FAILED,
          'Snap connection failed — install or reconnect the COTI Snap.',
        );
      }

      if (hasCotiErrorCode(err, CotiErrorCode.SNAP_DIALOG_REJECTED)) {
        rethrowCoded(CotiErrorCode.SNAP_DIALOG_REJECTED, 'User dismissed the Snap dialog.');
      }

      if (hasCotiErrorCode(err, CotiErrorCode.ACCOUNT_NOT_ONBOARDED)) {
        if (lockSessionOnAesFailure) clearSessionAfterAesFailure();
        rethrowCoded(
          CotiErrorCode.ACCOUNT_NOT_ONBOARDED,
          'Account has not been onboarded to the COTI network.',
        );
      }

      if (
        hasCotiErrorCode(err, CotiErrorCode.AES_KEY_MISMATCH)
        || hasCotiErrorCode(err, CotiErrorCode.ONBOARDING_INCOMPLETE)
      ) {
        if (lockSessionOnAesFailure) clearSessionAfterAesFailure();
        rethrowCoded(
          hasCotiErrorCode(err, CotiErrorCode.ONBOARDING_INCOMPLETE)
            ? CotiErrorCode.ONBOARDING_INCOMPLETE
            : CotiErrorCode.AES_KEY_MISMATCH,
          'AES key mismatch or onboarding error.',
        );
      }

      if (isUserRejection(err) || hasCotiErrorCode(err, CotiErrorCode.USER_REJECTED)) {
        return accountStateFailed('user_rejected');
      }

      return accountStateFailed('failed');
    }
  }, [
    walletAddress,
    establishAesSession,
    syncPublicBalances,
    syncPrivateBalances,
    autoInitTokens,
    hasSnap,
    walletTypeInfo.walletType,
    walletTypeInfo.isMetaMaskWithSnap,
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

    if (getPluginConfig().waitForBalanceRefreshAfterTransfer) {
      await refreshPrivateBalances();
    } else {
      // Don't block the success UI on balance decryption — refresh in the background.
      // Preserve the session: AES/onboarding failures must not lock the wallet after a
      // successful transfer when the caller already received success (errors are logged only).
      void refreshPrivateBalances({ preserveSessionOnError: true }).catch(err =>
        logger.error('Background balance refresh after transfer failed', err),
      );
    }
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
    if (arePrivateBalancesHidden) {
      throw new Error('Private balances are locked. Unlock to encrypt values.');
    }

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
    arePrivateBalancesHidden,
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
    if (arePrivateBalancesHidden) {
      throw new Error('Private balances are locked. Unlock to decrypt values.');
    }

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
    arePrivateBalancesHidden,
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
    if (autoInitTokens) {
      setPrivateTokens(getInitialPrivateTokens(currentChainId));
    } else {
      setPrivateTokens(prev => prev.map(token => ({ ...token, balance: '0.00' })));
    }
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

export type PluginUnlockSession = ReturnType<typeof usePluginUnlockSession>;
