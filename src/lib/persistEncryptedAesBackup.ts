import { BrowserProvider, JsonRpcSigner } from '@coti-io/coti-ethers';
import type { Connector } from 'wagmi';
import { getPluginConfig } from '../config/plugin';
import { decryptAesKeyBackup, encryptAesKeyBackup } from '../crypto/aesKeyBackupVault';
import { logger } from './logger';
import { isOnboardingServicesEnabled } from './onboardingServices';
import { isUserRejection } from './walletErrors';
import type { EIP1193Provider } from './ethereum';
import {
  isMetaMaskMobileBrowser,
  resolveMetaMaskMobileWalletProvider,
} from './metaMaskMobile';

export type PersistEncryptedAesBackupResult =
  | { status: 'saved' }
  | { status: 'skipped' }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

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
      return { status: 'failed', message: 'Could not get provider from wallet connector.' };
    }

    const provider = new BrowserProvider(walletProvider);
    const signer = isMetaMaskMobileBrowser()
      ? new JsonRpcSigner(provider, params.address)
      : await provider.getSigner(params.address);

    params.onBeforeSign?.();

    const backup = await encryptAesKeyBackup(params.aesKey, signer, backupContext);

    // Second signature: confirms the wallet produces deterministic ECDSA for this
    // typed-data message. Without this, a randomized signer would save a blob that
    // can never be restored. Default on; set verifyBackupDeterminism: false to skip.
    if (config.verifyBackupDeterminism !== false) {
      try {
        await decryptAesKeyBackup(backup, signer, backupContext);
      } catch (determinismError) {
        if (isUserRejection(determinismError)) {
          return { status: 'cancelled' };
        }
        const detail = determinismError instanceof Error
          ? determinismError.message
          : 'signature was not reproducible';
        return {
          status: 'failed',
          message:
            `Wallet signature is not deterministic; encrypted backup was not saved. ${detail}`,
        };
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

    await saveBackup({ ...backupContext, backup });
    return { status: 'saved' };
  } catch (error) {
    if (isUserRejection(error)) {
      return { status: 'cancelled' };
    }

    const message = error instanceof Error
      ? error.message
      : 'Encrypted AES backup could not be saved.';
    return { status: 'failed', message };
  }
}
