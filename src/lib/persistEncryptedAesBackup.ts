import { BrowserProvider, JsonRpcSigner } from '@coti-io/coti-ethers';
import type { Connector } from 'wagmi';
import { getPluginConfig } from '../config/plugin';
import {
  AES_BACKUP_WALLET_NOT_SUPPORTED,
  decryptAesKeyBackup,
  encryptAesKeyBackup,
} from '../crypto/aesKeyBackupVault';
import { CotiErrorCode, CotiPluginError, isCotiPluginError } from '../errors';
import { logger } from './logger';
import { isOnboardingServicesEnabled } from './onboardingServices';
import { isUserRejection } from './walletErrors';
import type { EIP1193Provider } from './ethereum';
import {
  isMetaMaskMobileBrowser,
  resolveMetaMaskMobileWalletProvider,
} from './metaMaskMobile';

export type AesBackupPersistFailureCode =
  | typeof CotiErrorCode.AES_BACKUP_WALLET_NOT_SUPPORTED
  | typeof CotiErrorCode.AES_BACKUP_CRYPTO_VALIDATION_FAILED
  | typeof CotiErrorCode.AES_BACKUP_STORAGE_FAILED
  | typeof CotiErrorCode.NO_PROVIDER;

export type PersistEncryptedAesBackupResult =
  | { status: 'saved' }
  | { status: 'skipped' }
  /** User rejected a required backup signature (encrypt or determinism check). */
  | { status: 'cancelled'; code: typeof CotiErrorCode.USER_REJECTED }
  | { status: 'failed'; code: AesBackupPersistFailureCode; message: string };

function failed(
  code: AesBackupPersistFailureCode,
  message: string,
): PersistEncryptedAesBackupResult {
  return { status: 'failed', code, message };
}

export async function persistEncryptedAesBackup(params: {
  aesKey: string;
  address: string;
  chainId: number;
  connector: Connector;
  preferReplace?: boolean;
  onBeforeSign?: () => void;
}): Promise<PersistEncryptedAesBackupResult> {
  const config = getPluginConfig();
  const services = config.onboardingServices;
  if (
    !isOnboardingServicesEnabled()
    || (!services?.saveEncryptedAesBackup && !services?.replaceEncryptedAesBackup)
  ) {
    return { status: 'skipped' };
  }

  const backupContext = {
    address: params.address,
    chainId: params.chainId,
  };

  try {
    const connectorProvider = await params.connector.getProvider() as EIP1193Provider | null;
    const walletProvider = resolveMetaMaskMobileWalletProvider(
      connectorProvider as Parameters<typeof resolveMetaMaskMobileWalletProvider>[0],
    ) as EIP1193Provider;

    if (!walletProvider?.request) {
      return failed(
        CotiErrorCode.NO_PROVIDER,
        'Could not get provider from wallet connector.',
      );
    }

    const provider = new BrowserProvider(walletProvider);
    const signer = isMetaMaskMobileBrowser()
      ? new JsonRpcSigner(provider, params.address)
      : await provider.getSigner(params.address);

    params.onBeforeSign?.();

    const backup = await encryptAesKeyBackup(params.aesKey, signer, backupContext);

    // Default: require a second independent signature that successfully decrypts
    // the newly created backup before any storage write. Skip only via the
    // explicitly unsafe escape hatch.
    if (config.unsafeSkipBackupDeterminismCheck !== true) {
      try {
        await decryptAesKeyBackup(backup, signer, backupContext);
      } catch (determinismError) {
        if (isUserRejection(determinismError)) {
          return { status: 'cancelled', code: CotiErrorCode.USER_REJECTED };
        }
        // Second independent sign failed to decrypt the blob we just created —
        // the wallet did not reproduce identical signing material.
        const detail = determinismError instanceof Error
          ? determinismError.message
          : 'signature was not reproducible';
        return failed(
          CotiErrorCode.AES_BACKUP_WALLET_NOT_SUPPORTED,
          `Wallet cannot reliably reproduce backup signatures (${AES_BACKUP_WALLET_NOT_SUPPORTED}); `
            + `encrypted backup was not saved. ${detail}`,
        );
      }
    }

    let existingBackup = null;
    if (!params.preferReplace && services.fetchEncryptedAesBackup) {
      try {
        existingBackup = await services.fetchEncryptedAesBackup(backupContext);
      } catch (error) {
        logger.warn('[AesBackup] Existing backup probe failed:', error);
      }
    }

    const saveBackup = (params.preferReplace || existingBackup) && services.replaceEncryptedAesBackup
      ? services.replaceEncryptedAesBackup
      : services.saveEncryptedAesBackup;

    if (!saveBackup) {
      return { status: 'skipped' };
    }

    try {
      await saveBackup({ ...backupContext, backup });
    } catch (storageError) {
      const message = storageError instanceof Error
        ? storageError.message
        : 'Encrypted AES backup storage service failed.';
      return failed(CotiErrorCode.AES_BACKUP_STORAGE_FAILED, message);
    }

    return { status: 'saved' };
  } catch (error) {
    if (isUserRejection(error)) {
      return { status: 'cancelled', code: CotiErrorCode.USER_REJECTED };
    }

    if (isCotiPluginError(error) && error.code === CotiErrorCode.AES_BACKUP_CRYPTO_VALIDATION_FAILED) {
      return failed(CotiErrorCode.AES_BACKUP_CRYPTO_VALIDATION_FAILED, error.message);
    }

    const message = error instanceof Error
      ? error.message
      : 'Encrypted AES backup could not be saved.';
    return failed(CotiErrorCode.AES_BACKUP_CRYPTO_VALIDATION_FAILED, message);
  }
}
