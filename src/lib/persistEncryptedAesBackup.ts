import { BrowserProvider, JsonRpcSigner } from '@coti-io/coti-ethers';
import type { Connector } from 'wagmi';
import { getPluginConfig } from '../config/plugin';
import { encryptAesKeyBackup } from '../crypto/aesKeyBackupVault';
import { logger } from './logger';
import {
  isMetaMaskMobileBrowser,
  resolveMetaMaskMobileWalletProvider,
} from './metaMaskMobile';

type Eip1193ProviderLike = {
  request?: (args: { method: string; params?: unknown[] | unknown }) => Promise<unknown>;
};

const EIP_1193_USER_REJECTED = 4001;

function isUserRejection(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as {
      code?: number | string;
      message?: string;
      reason?: string;
      info?: { error?: { code?: number | string; message?: string } };
    };
    if (err.code === EIP_1193_USER_REJECTED) return true;
    if (err.info?.error?.code === EIP_1193_USER_REJECTED) return true;
    if (err.code === 'ACTION_REJECTED' || err.reason === 'rejected') return true;
    const message = `${err.message ?? ''} ${err.info?.error?.message ?? ''}`.toLowerCase();
    if (
      message.includes('user rejected')
      || message.includes('user denied')
      || message.includes('rejected the request')
      || message.includes('request rejected')
      || message.includes('action_rejected')
      || message.includes('user cancelled')
      || message.includes('user canceled')
    ) {
      return true;
    }
  }
  return false;
}

function isOnboardingServicesEnabled(): boolean {
  const mode = getPluginConfig().onboardingServices?.mode;
  return mode === 'custom' || mode === 'official';
}

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
  onBeforeSign?: () => void;
}): Promise<PersistEncryptedAesBackupResult> {
  const services = getPluginConfig().onboardingServices;
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
    const connectorProvider = await params.connector.getProvider() as Eip1193ProviderLike | null;
    const walletProvider = resolveMetaMaskMobileWalletProvider(
      connectorProvider as Parameters<typeof resolveMetaMaskMobileWalletProvider>[0],
    ) as Eip1193ProviderLike;

    if (!walletProvider?.request) {
      return { status: 'failed', message: 'Could not get provider from wallet connector.' };
    }

    const provider = new BrowserProvider(walletProvider);
    const signer = isMetaMaskMobileBrowser()
      ? new JsonRpcSigner(provider, params.address)
      : await provider.getSigner(params.address);

    params.onBeforeSign?.();

    const backup = await encryptAesKeyBackup(params.aesKey, signer, backupContext);

    let existingBackup = null;
    if (services.fetchEncryptedAesBackup) {
      try {
        existingBackup = await services.fetchEncryptedAesBackup(backupContext);
      } catch (error) {
        logger.warn('[AesBackup] Existing backup probe failed:', error);
      }
    }

    const saveBackup = existingBackup && services.replaceEncryptedAesBackup
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
