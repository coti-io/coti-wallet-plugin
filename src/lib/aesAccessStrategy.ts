import {
  assertAesKeyChainId,
  getPluginConfig,
  isAesKeyChainId,
  type AesKeyChainId,
  type EncryptedAesBackup,
} from '../config/plugin';
import { COTI_TESTNET_CHAIN_ID } from '../config/chains';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from './logger';

import type { AesKeyProviderOptions } from '../hooks/useAesKeyProvider';

/** How private AES material should be accessed for unlock and crypto ops. */
export type AesAccessMode = 'snap' | 'local' | 'onboard';

export interface AesAccessStrategy {
  mode: AesAccessMode;
  aesKeyChainId: AesKeyChainId;
  snapInstalled: boolean;
  snapHasKey: boolean;
  hasEncryptedBackup: boolean;
  /** Populated when a backup probe loaded the encrypted blob. */
  encryptedBackup?: EncryptedAesBackup | null;
}

export interface ResolveAesAccessStrategyInput {
  address: string;
  chainId?: number;
  aesKeyChainId?: number;
  snapInstalled: boolean;
  sessionAesKey?: string | null;
  hasAesKeyInSnap: (accountAddress?: string) => Promise<boolean | null>;
  /** Re-checks Snap availability when key probe returns null (avoids false errors). */
  confirmSnapInstalled?: () => Promise<boolean>;
  snapKeyProbeRetries?: number;
}

function isOnboardingServicesEnabled(): boolean {
  const mode = getPluginConfig().onboardingServices?.mode;
  return mode === 'custom' || mode === 'official';
}

async function fetchEncryptedBackupProbe(
  address: string,
  chainId: number,
): Promise<EncryptedAesBackup | null> {
  const services = getPluginConfig().onboardingServices;
  if (!isOnboardingServicesEnabled() || !services?.fetchEncryptedAesBackup) {
    return null;
  }

  try {
    return await services.fetchEncryptedAesBackup({ address, chainId });
  } catch (error) {
    logger.warn('[AesAccess] local backup probe failed:', error);
    return null;
  }
}

async function probeLocalBackup(address: string, chainId: number): Promise<boolean> {
  const backup = await fetchEncryptedBackupProbe(address, chainId);
  return backup != null;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export function resolveAesKeyChainId(
  currentChainId?: number | null,
  overrideChainId?: number | null,
): AesKeyChainId {
  const configuredChainId = getPluginConfig().aesKeyChainId;
  assertAesKeyChainId(configuredChainId);

  if (overrideChainId !== undefined && overrideChainId !== null) {
    assertAesKeyChainId(overrideChainId);
    return overrideChainId;
  }

  if (configuredChainId !== undefined) {
    return configuredChainId;
  }

  if (isAesKeyChainId(currentChainId)) {
    return currentChainId;
  }

  return COTI_TESTNET_CHAIN_ID;
}

async function probeSnapKeyWithRetry(
  hasAesKeyInSnap: (accountAddress?: string) => Promise<boolean | null>,
  address: string,
  retries: number,
  confirmSnapInstalled?: () => Promise<boolean>,
): Promise<boolean> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const result = await hasAesKeyInSnap(address);
    if (result !== null) return result;
    if (attempt < retries) await sleep(250);
  }

  if (confirmSnapInstalled && !(await confirmSnapInstalled())) {
    return false;
  }

  throw new CotiPluginError(
    CotiErrorCode.SNAP_KEY_CHECK_FAILED,
    'Could not check Snap AES key.',
  );
}

/**
 * Single routing table for AES unlock / crypto:
 * 1. no snap + no local backup → onboard
 * 2. snap + no snap key + no local backup → onboard (persist to snap when possible)
 * 3. snap + no snap key + local backup → local key only
 * 4. snap + snap key + local backup → snap
 * 5. snap + snap key + no local backup → snap
 */
export function resolveAesAccessMode(input: {
  snapInstalled: boolean;
  snapHasKey: boolean;
  hasEncryptedBackup: boolean;
  sessionAesKey?: string | null;
}): AesAccessMode {
  if (input.snapInstalled && input.snapHasKey) {
    return 'snap';
  }
  if (input.hasEncryptedBackup || input.sessionAesKey) {
    return 'local';
  }
  return 'onboard';
}

export async function resolveAesAccessStrategy(
  input: ResolveAesAccessStrategyInput,
): Promise<AesAccessStrategy> {
  const aesKeyChainId = resolveAesKeyChainId(input.chainId, input.aesKeyChainId);
  let snapHasKey = false;
  let encryptedBackup: EncryptedAesBackup | null;

  if (input.snapInstalled) {
    const backupProbe = fetchEncryptedBackupProbe(input.address, aesKeyChainId);
    const [snapResult, backupResult] = await Promise.all([
      probeSnapKeyWithRetry(
        input.hasAesKeyInSnap,
        input.address,
        input.snapKeyProbeRetries ?? 1,
        input.confirmSnapInstalled,
      ),
      backupProbe,
    ]);
    snapHasKey = snapResult;
    encryptedBackup = snapHasKey ? null : backupResult;
  } else {
    encryptedBackup = await fetchEncryptedBackupProbe(input.address, aesKeyChainId);
  }
  const hasEncryptedBackup = encryptedBackup != null;

  const mode = resolveAesAccessMode({
    snapInstalled: input.snapInstalled,
    snapHasKey,
    hasEncryptedBackup,
    sessionAesKey: input.sessionAesKey,
  });

  logger.log('[AesAccess] resolved strategy', {
    mode,
    aesKeyChainId,
    snapInstalled: input.snapInstalled,
    snapHasKey,
    hasEncryptedBackup,
    hasSessionKey: !!input.sessionAesKey,
  });

  return {
    mode,
    aesKeyChainId,
    snapInstalled: input.snapInstalled,
    snapHasKey,
    hasEncryptedBackup,
    encryptedBackup,
  };
}

/**
 * Restore-only routing: load encrypted backup first so the wallet sign prompt is
 * not blocked by Snap probes or duplicate backup fetches.
 */
export async function resolveRestoreAesAccessStrategy(
  input: ResolveAesAccessStrategyInput,
): Promise<AesAccessStrategy> {
  const aesKeyChainId = resolveAesKeyChainId(input.chainId, input.aesKeyChainId);
  const encryptedBackup = await fetchEncryptedBackupProbe(input.address, aesKeyChainId);
  if (encryptedBackup) {
    logger.log('[AesAccess] restore probe: encrypted backup found — fast local path');
    return {
      mode: 'local',
      aesKeyChainId,
      snapInstalled: input.snapInstalled,
      snapHasKey: false,
      hasEncryptedBackup: true,
      encryptedBackup,
    };
  }

  return resolveAesAccessStrategy(input);
}

export interface AesUnlockPlan {
  unlockOptions: AesKeyProviderOptions & { validateOnUnlock: true };
  checkSnap: boolean;
  keyForUnlock?: string;
  accessMode?: AesAccessMode;
}

/** Maps a resolved strategy to balance-updater / getAesKey options. */
export function buildUnlockPlanFromStrategy(
  strategy: AesAccessStrategy,
  unlockOptions: AesKeyProviderOptions & { validateOnUnlock: true },
  sessionKey?: string,
): AesUnlockPlan {
  switch (strategy.mode) {
    case 'snap':
      return {
        unlockOptions: { ...unlockOptions, snapSideDecrypt: true },
        checkSnap: false,
        keyForUnlock: undefined,
        accessMode: strategy.mode,
      };
    case 'local':
      return {
        unlockOptions: sessionKey
          ? unlockOptions
          : {
            ...unlockOptions,
            restoreOnly: true,
            prefetchedEncryptedBackup: strategy.encryptedBackup,
          },
        checkSnap: !sessionKey,
        keyForUnlock: sessionKey,
        accessMode: strategy.mode,
      };
    case 'onboard':
      return {
        unlockOptions: unlockOptions.restoreOnly
          ? unlockOptions
          : { ...unlockOptions, forceContractOnboarding: true },
        checkSnap: !sessionKey,
        keyForUnlock: sessionKey,
        accessMode: strategy.mode,
      };
  }
}

export function shouldUseSnapCrypto(strategy: AesAccessStrategy): boolean {
  return strategy.mode === 'snap';
}

export function shouldUseLocalCrypto(
  strategy: AesAccessStrategy,
  sessionAesKey?: string | null,
): boolean {
  return strategy.mode === 'local' && !!sessionAesKey;
}
