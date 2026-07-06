import { useState, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
import { BrowserProvider, JsonRpcSigner } from '@coti-io/coti-ethers';
import { getBigInt, type BigNumberish } from 'ethers';
import { useSnap } from './useSnap';
import type { WalletTypeInfo } from './useWalletType';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from '../lib/logger';
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID } from '../config/chains';
import { getPluginConfig } from '../config/plugin';
import { decryptAesKeyBackup, encryptAesKeyBackup } from '../crypto/aesKeyBackupVault';
import { normalizeAesKey } from '../crypto/aesKey';
import { muteChainUpdates, unmuteChainUpdates, isChainUpdatesMuted } from '../lib/chainMute';
import { canPersistAesKeyToSnap } from '../lib/snapOrigins';
import { resolveAesKeyChainId } from '../lib/aesAccessStrategy';
import {
  formatOnboardingError,
  isMetaMaskMobileBrowser,
  OnboardingDebugTrace,
} from '../lib/metaMaskMobile';

/**
 * EIP-1193 error code for user rejection of a wallet request.
 */
const EIP_1193_USER_REJECTED = 4001;

/**
 * Onboarding step identifiers matching the contract onboarding flow (steps 3-9).
 */
export type OnboardingStep =
  | 'idle'
  | 'switching-network'
  | 'creating-provider'
  | 'signing-transaction'
  | 'retrieving-key'
  | 'validating-key'
  | 'restoring-network'
  | 'persisting-key'
  | 'restoring-backup'
  | 'granting-funds'
  | 'waiting-for-funds'
  | 'saving-backup'
  | 'complete'
  | 'error';

/**
 * Metadata for each onboarding step (for progress display).
 */
export interface OnboardingStepInfo {
  id: OnboardingStep;
  label: string;
  description: string;
}

/**
 * Ordered list of steps shown in the progress UI (steps 3–9 from the onboarding flow doc).
 */
export const ONBOARDING_STEPS: OnboardingStepInfo[] = [
  { id: 'signing-transaction', label: 'Sign Transaction', description: 'Please sign the transaction in your wallet' },
  { id: 'retrieving-key', label: 'Execute Transaction', description: 'Please execute the next transaction in your wallet to generate or retrieve your AES Key' },
  { id: 'persisting-key', label: 'Persisting Key', description: 'Persisting your AES encryption key' },
];

/**
 * Callback type for receiving onboarding step progress updates.
 */
export type OnboardingProgressCallback = (step: OnboardingStep) => void;

export interface AesKeyProviderOptions {
  /**
   * Skip Snap retrieval and use the AccountOnboard contract path.
   * Required when Snap holds a key for the wrong MetaMask profile.
   */
  forceContractOnboarding?: boolean;
  /** Whether contract-onboarding should save a client-encrypted AES backup. */
  saveBackup?: boolean;
  /** Only restore via Snap-side decrypt / backup; never export raw key or run contract onboarding. */
  restoreOnly?: boolean;
  /** Unlock via Snap typed decrypt RPC (no raw AES export). Used when AES is already stored in Snap. */
  snapSideDecrypt?: boolean;
  /** COTI Testnet/Mainnet chain that owns the AES key for this flow. */
  aesKeyChainId?: number;
  /** Decrypt encrypted backup blob, persist AES to Snap, return null (no raw key to dapp). */
  hydrateSnapFromBackup?: boolean;
  /** Receives contract-onboarding step updates for modal progress UI. */
  onProgress?: OnboardingProgressCallback;
  /** Called when backup restore is cancelled by the user. */
  onRestoreCancelled?: () => void;
}

/** @deprecated Use {@link AesKeyProviderOptions} instead. */
export type GetAesKeyOptions = Pick<AesKeyProviderOptions, 'forceContractOnboarding'>;

/**
 * Result interface for the useAesKeyProvider hook.
 */
export interface AesKeyProviderResult {
  /** Retrieves AES key — routes to Snap or onboard contract based on wallet type */
  getAesKey: (
    address: string,
    onProgress?: OnboardingProgressCallback,
    options?: AesKeyProviderOptions,
  ) => Promise<string | null>;
  /** True during the async generateOrRecoverAes() call */
  isOnboarding: boolean;
  /** Error message from failed onboarding attempts; cleared on next call */
  onboardingError: string | null;
  /** Non-blocking warning from restore/backup flows; cleared on next call */
  onboardingWarning: string | null;
  /** True when the user cancelled the latest backup restore signature. */
  wasRestoreCancelled: boolean;
  /** Current onboarding step (for progress UI) */
  currentStep: OnboardingStep;
  /** Timestamped trace of onboarding steps and RPC calls (for MetaMask Mobile debugging) */
  onboardingDebugTrace?: string[];
}

/**
 * Checks if an error is an EIP-1193 user rejection (code 4001).
 */
function isUserRejection(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as { code?: number | string; message?: string; reason?: string };
    if (err.code === EIP_1193_USER_REJECTED) return true;
    if (err.code === 'ACTION_REJECTED' || err.reason === 'rejected') return true;
    if (err.message?.includes('User rejected') || err.message?.includes('rejected the request')) {
      return true;
    }
  }
  return false;
}

/** Validates that a string is a valid 32-character hex AES key. */
export function isValidAesKey(key: string): boolean {
  try {
    normalizeAesKey(key);
    return true;
  } catch {
    return false;
  }
}

const SIGN_RPC_METHODS = new Set([
  'personal_sign',
  'eth_sign',
  'eth_signTypedData',
  'eth_signTypedData_v3',
  'eth_signTypedData_v4',
]);

type Eip1193RequestPayload = { method: string; params?: unknown[] };
type Eip1193ProviderLike = { request: (args: Eip1193RequestPayload) => Promise<unknown> };

/**
 * Wraps the wallet provider's `request` to log RPC calls and advance the UI
 * between the message-signature and on-chain onboarding transaction steps.
 */
function instrumentWalletProvider(
  walletProvider: Eip1193ProviderLike,
  emitStep: (step: OnboardingStep) => void,
  trace: OnboardingDebugTrace,
): () => void {
  const hadOwnRequest = Object.prototype.hasOwnProperty.call(walletProvider, 'request');
  const originalRequest = walletProvider.request.bind(walletProvider);
  let executeStepEmitted = false;

  walletProvider.request = async function instrumentedRequest(args: Eip1193RequestPayload) {
    const method = args?.method ?? 'unknown';
    trace.push('rpc', method);

    if (args?.method === 'eth_sendTransaction' && !executeStepEmitted) {
      executeStepEmitted = true;
      emitStep('retrieving-key');
    } else if (SIGN_RPC_METHODS.has(method)) {
      trace.push('wallet-prompt', `Approve signature in wallet (${method})`);
    }

    try {
      const result = await originalRequest(args);
      trace.push('rpc-ok', method);
      return result;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      trace.push('rpc-err', `${method}: ${errMsg}`);
      throw error;
    }
  };

  return () => {
    if (hadOwnRequest) {
      walletProvider.request = originalRequest;
    } else {
      try {
        delete (walletProvider as { request?: unknown }).request;
      } catch {
        walletProvider.request = originalRequest;
      }
    }
  };
}

function isServiceEnabled(mode?: 'disabled' | 'custom' | 'official'): boolean {
  return mode === 'custom' || mode === 'official';
}

function toBigInt(value: BigNumberish | undefined, fallback: bigint): bigint {
  if (value === undefined) return fallback;
  return getBigInt(value);
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Single abstraction for AES key retrieval. Routes to Snap or onboarding contract
 * based on wallet type.
 *
 * - When `isMetaMaskWithSnap === true`: delegates to existing `getAESKeyFromSnap(address)`
 * - When `isMetaMaskWithSnap === false`: uses wagmi connector's EIP-1193 provider to create
 *   a `@coti-io/coti-ethers` BrowserProvider, gets a signer, and calls
 *   `signer.generateOrRecoverAes()` to retrieve the AES key from the onboarding contract.
 *
 * @param walletTypeInfo - The wallet type information from useWalletType()
 * @returns AesKeyProviderResult with getAesKey function and state indicators
 */
export function useAesKeyProvider(walletTypeInfo: WalletTypeInfo): AesKeyProviderResult {
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [onboardingWarning, setOnboardingWarning] = useState<string | null>(null);
  const [wasRestoreCancelled, setWasRestoreCancelled] = useState(false);
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('idle');
  const [onboardingDebugTrace, setOnboardingDebugTrace] = useState<string[]>([]);
  const progressCallbackRef = useRef<OnboardingProgressCallback | undefined>();
  const debugTraceRef = useRef(new OnboardingDebugTrace());

  const { getAESKeyFromSnap, saveAESKeyToSnap, clearSnapCache } = useSnap();
  const { connector, chainId: connectedChainId } = useAccount();

  const emitStep = useCallback((step: OnboardingStep) => {
    setCurrentStep(step);
    progressCallbackRef.current?.(step);
  }, []);

  const getAesKey = useCallback(
    async (
      address: string,
      onProgress?: OnboardingProgressCallback,
      options: AesKeyProviderOptions = {},
    ): Promise<string | null> => {
      // Store progress callback for use within the flow
      progressCallbackRef.current = onProgress ?? options.onProgress;
      // Clear previous error and debug trace on each new retrieval attempt
      setOnboardingError(null);
      debugTraceRef.current.clear();
      setOnboardingDebugTrace([]);
      setOnboardingWarning(null);
      setWasRestoreCancelled(false);
      emitStep('idle');
      let restoreBackupFailed = false;

      const trace = debugTraceRef.current;
      trace.push('start', `wallet=${walletTypeInfo.walletType} mobile=${isMetaMaskMobileBrowser()}`);

      const forceContractOnboarding = options?.forceContractOnboarding === true;
      const skipSnapOnMetaMaskMobile =
        walletTypeInfo.walletType === 'metamask' && isMetaMaskMobileBrowser();

      if (forceContractOnboarding) {
        logger.log('ℹ️ Forcing AccountOnboard contract path (skipping Snap read)');
        clearSnapCache();
      }

      if (skipSnapOnMetaMaskMobile) {
        trace.push('route', 'MetaMask Mobile — skipping Snap, using contract onboarding');
        logger.log('ℹ️ MetaMask Mobile detected — skipping Snap path (uses eth_accounts)');
      }

      // Route 1: MetaMask — try Snap path first unless contract onboarding was forced,
      // we're on MetaMask Mobile, or this is restore-only unlock.
      if (
        walletTypeInfo.walletType === 'metamask'
        && !forceContractOnboarding
        && !skipSnapOnMetaMaskMobile
        && !options.restoreOnly
      ) {
        try {
          const key = await getAESKeyFromSnap(address, { skipCache: true });
          if (key && !isValidAesKey(key)) {
            logger.warn('⚠️ AES key from Snap failed format validation');
            return null;
          }
          if (key) return key;
          // Snap returned null (user cancelled) — don't fall through to contract
          return null;
        } catch (error: unknown) {
          if (isUserRejection(error)) {
            return null;
          }
          // Snap missing, empty, or mismatched — fall through to contract onboarding
          if (
            error instanceof CotiPluginError &&
            (error.code === CotiErrorCode.SNAP_CONNECT_FAILED ||
              error.code === CotiErrorCode.AES_KEY_MISSING ||
              error.code === CotiErrorCode.AES_KEY_MISMATCH)
          ) {
            logger.log('ℹ️ Snap unavailable, empty, or mismatched — falling back to onboard contract');
            clearSnapCache();
            // Fall through to Route 2
          } else if (
            error instanceof Error &&
            (error.message.includes('No account connected') ||
              error.message.includes('Extension context invalidated'))
          ) {
            logger.log('ℹ️ Snap wallet not ready, falling back to onboard contract');
            clearSnapCache();
            // Fall through to Route 2
          } else {
            throw error;
          }
        }
      }

      // Route 2: Non-MetaMask wallet (or MetaMask without snap / empty snap) — contract onboarding
      if (!connector) {
        setOnboardingError('No wallet provider available. Please connect your wallet.');
        emitStep('error');
        return null;
      }

      try {
        setIsOnboarding(true);

        // Get the EIP-1193 provider from the wagmi connector
        const walletProvider = await connector.getProvider() as any;
        if (!walletProvider) {
          setOnboardingError('Could not get provider from wallet connector.');
          emitStep('error');
          return null;
        }

        const config = getPluginConfig();
        const services = config.onboardingServices;
        const servicesEnabled = isServiceEnabled(services?.mode);
        const isConnectedCotiChain = connectedChainId === COTI_MAINNET_CHAIN_ID || connectedChainId === COTI_TESTNET_CHAIN_ID;
        const targetCotiChainId = resolveAesKeyChainId(connectedChainId, options.aesKeyChainId);
        const backupContext = { address, chainId: targetCotiChainId };

        if (servicesEnabled && services?.fetchEncryptedAesBackup) {
          try {
            emitStep('restoring-backup');
            const backup = await services.fetchEncryptedAesBackup(backupContext);
            if (backup) {
              const provider = new BrowserProvider(walletProvider);
              const signer = await provider.getSigner(address);
              const restoredKey = await decryptAesKeyBackup(backup, signer, backupContext);
              logger.log('✅ AES key restored from encrypted backup');

              if (
                options.hydrateSnapFromBackup
                && walletTypeInfo.walletType === 'metamask'
                && canPersistAesKeyToSnap()
              ) {
                emitStep('persisting-key');
                const saved = await saveAESKeyToSnap(restoredKey, address);
                if (!saved) {
                  logger.warn('⚠️ Restored AES key but could not persist it to Snap');
                }

                if (saved) {
                  emitStep('complete');
                } else {
                  emitStep('idle');
                }
                // Dedicated hydrate path keeps the raw AES key out of dapp session state.
                return null;
              }

              if (
                options.hydrateSnapFromBackup
                && walletTypeInfo.walletType === 'metamask'
              ) {
                logger.log(
                  'ℹ️ Skipping Snap AES persist — origin not authorized for set-aes-key:',
                  typeof window !== 'undefined' ? window.location.origin : 'unknown',
                );
                return null;
              }

              emitStep('complete');
              return restoredKey;
            }
          } catch (restoreError) {
            if (isUserRejection(restoreError)) {
              setOnboardingWarning('Backup restore was cancelled. Approve the wallet signature to unlock from your encrypted backup.');
              setWasRestoreCancelled(true);
              options.onRestoreCancelled?.();
              emitStep('idle');
              return null;
            }
            const message = restoreError instanceof Error
              ? restoreError.message
              : 'Encrypted AES backup could not be restored.';
            logger.warn('⚠️ AES backup restore failed, falling back to contract onboarding:', restoreError);
            restoreBackupFailed = true;
            setOnboardingWarning(`Encrypted backup could not be restored. Continuing with onboarding. ${message}`);
          }
        }

        if (options.restoreOnly) {
          emitStep('idle');
          return null;
        }

        // Step: Switch network to COTI Testnet
        emitStep('switching-network');
        trace.push('step', 'switching-network');

        // Determine if we need to switch to a COTI chain for onboarding
        const targetCotiChainHex = '0x' + targetCotiChainId.toString(16);
        const originalChainHex = connectedChainId ? '0x' + connectedChainId.toString(16) : null;

        // If not on COTI, mute UI chain reactions and switch provider-level
        if (!isConnectedCotiChain) {
          logger.log('🔇 [AesKeyProvider] Muting chain updates, switching to COTI Testnet for onboarding...');
          muteChainUpdates();
          try {
            await walletProvider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: targetCotiChainHex }],
            });
          } catch (switchErr: any) {
            if (switchErr?.code === 4902) {
              try {
                await walletProvider.request({
                  method: 'wallet_addEthereumChain',
                  params: [{
                    chainId: targetCotiChainHex,
                    chainName: 'COTI Testnet',
                    nativeCurrency: { name: 'COTI', symbol: 'COTI', decimals: 18 },
                    rpcUrls: ['https://testnet.coti.io/rpc'],
                    blockExplorerUrls: ['https://testnet.cotiscan.io'],
                  }],
                });
              } catch {
                unmuteChainUpdates();
                setOnboardingError('Failed to add COTI Testnet to wallet.');
                emitStep('error');
                return null;
              }
            } else {
              unmuteChainUpdates();
              if (switchErr?.code === 4001) { emitStep('idle'); return null; } // user rejected
              setOnboardingError('Failed to switch to COTI Testnet for onboarding.');
              emitStep('error');
              return null;
            }
          }
        }

        // Step: Create provider and signer
        emitStep('creating-provider');
        trace.push('step', 'creating-provider');

        const restoreRequest = instrumentWalletProvider(walletProvider, emitStep, trace);

        // Create a @coti-io/coti-ethers BrowserProvider (now on COTI Testnet).
        // Use JsonRpcSigner directly with the wagmi-connected address — NEVER call
        // BrowserProvider.getSigner(), which always invokes eth_accounts (via hasSigner)
        // and triggers MetaMask Mobile's coalescer stack overflow.
        const provider = new BrowserProvider(walletProvider);
        trace.push('signer', `JsonRpcSigner(${address.slice(0, 10)}…)`);
        let signer;
        try {
          signer = new JsonRpcSigner(provider, address);
        } catch (signerError) {
          restoreRequest();
          throw signerError;
        }

        const configuredMinBalanceWei = toBigInt(config.onboardingGrantMinBalanceWei, 0n);
        if (servicesEnabled && services?.grantNativeCoti) {
          let nativeBalance = await provider.getBalance(address);
          const requiredBalanceWei = configuredMinBalanceWei > 0n ? configuredMinBalanceWei : 1n;
          logger.log('[AesKeyProvider] Native COTI balance before onboarding', {
            address,
            chainId: targetCotiChainId,
            nativeBalanceWei: nativeBalance.toString(),
            requiredBalanceWei: requiredBalanceWei.toString(),
          });
          if (nativeBalance < requiredBalanceWei) {
            emitStep('granting-funds');
            try {
              const grantResult = await services.grantNativeCoti({ address, chainId: targetCotiChainId });
              logger.log('[AesKeyProvider] Native COTI grant requested', grantResult);

              if (grantResult?.status !== 'skipped') {
                emitStep('waiting-for-funds');
                const pollIntervalMs = config.onboardingGrantPollIntervalMs ?? 2000;
                const timeoutMs = config.onboardingGrantTimeoutMs ?? 30000;
                const startedAt = Date.now();

                while (nativeBalance < requiredBalanceWei && Date.now() - startedAt < timeoutMs) {
                  await sleep(pollIntervalMs);
                  nativeBalance = await provider.getBalance(address);
                  logger.log('[AesKeyProvider] Native COTI balance while waiting for grant', {
                    address,
                    chainId: targetCotiChainId,
                    nativeBalanceWei: nativeBalance.toString(),
                    requiredBalanceWei: requiredBalanceWei.toString(),
                  });
                }
              }
            } catch (grantError) {
              logger.warn('[AesKeyProvider] Native COTI grant unavailable; continuing without grant:', grantError);
            }

            if (nativeBalance < requiredBalanceWei) {
              logger.warn('[AesKeyProvider] Native COTI balance remains below onboarding threshold; continuing without grant');
            }
          }
        }

        // Step: Execute onboarding — first wallet interaction is the message signature
        emitStep('signing-transaction');
        trace.push('step', 'signing-transaction');

        // Execute onboarding on COTI Testnet. The instrumented request hook above
        // advances the UI to "Execute Transaction" when the on-chain tx is sent.
        try {
          trace.push('sdk', 'generateOrRecoverAes()');
          await signer.generateOrRecoverAes();
          trace.push('sdk-ok', 'generateOrRecoverAes() complete');
        } finally {
          restoreRequest();
        }

        // Ensure the UI advances past signing even on recover-only paths that
        // never issue an eth_sendTransaction (idempotent if already emitted).
        emitStep('retrieving-key');

        const onboardInfo = signer.getUserOnboardInfo();
        const aesKey = onboardInfo?.aesKey ?? null;

        if (aesKey && !isValidAesKey(aesKey)) {
          logger.warn('⚠️ AES key from onboard contract failed format validation');
          setOnboardingError('Retrieved AES key has invalid format');
          emitStep('error');
          // Still switch back before returning
        } else {
          logger.log('✅ AES key retrieved successfully:', aesKey?.length, 'characters');
          emitStep('persisting-key');
          trace.push('step', 'persisting-key');
        }

        // Step: Switch wallet back to original chain
        emitStep('restoring-network');

        if (!isConnectedCotiChain && originalChainHex) {
          logger.log('🔇 [AesKeyProvider] Switching back to:', originalChainHex);
          try {
            await walletProvider.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: originalChainHex }],
            });
          } catch {
            logger.warn('⚠️ [AesKeyProvider] Could not switch back to original chain');
          }
        }

        // Step: Persist key (MetaMask Snap) or finalize
        let savedToSnap = false;
        if (aesKey && walletTypeInfo.walletType === 'metamask' && canPersistAesKeyToSnap()) {
          savedToSnap = await saveAESKeyToSnap(aesKey, address);
          if (!savedToSnap) {
            logger.warn('⚠️ AES key retrieved but could not persist to Snap');
          }
        } else if (aesKey && walletTypeInfo.walletType === 'metamask') {
          logger.log(
            'ℹ️ Skipping Snap AES persist — origin not authorized for set-aes-key:',
            typeof window !== 'undefined' ? window.location.origin : 'unknown',
          );
        }

        const skipEncryptedBackupForSnap =
          walletTypeInfo.walletType === 'metamask'
          && canPersistAesKeyToSnap()
          && savedToSnap;

        if (
          aesKey &&
          isValidAesKey(aesKey) &&
          options.saveBackup &&
          !skipEncryptedBackupForSnap &&
          servicesEnabled &&
          (services?.saveEncryptedAesBackup || services?.replaceEncryptedAesBackup)
        ) {
          try {
            emitStep('saving-backup');
            const backup = await encryptAesKeyBackup(aesKey, signer, backupContext);
            const saveBackup = restoreBackupFailed && services.replaceEncryptedAesBackup
              ? services.replaceEncryptedAesBackup
              : services.saveEncryptedAesBackup;
            await saveBackup?.({ ...backupContext, backup });
          } catch (backupError) {
            const message = backupError instanceof Error
              ? backupError.message
              : 'Encrypted AES backup could not be saved.';
            logger.warn('⚠️ AES key retrieved but encrypted backup save failed:', backupError);
            setOnboardingWarning(`Onboarding succeeded, but encrypted backup was not saved. ${message}`);
          }
        }

        // Step: Complete
        if (aesKey && isValidAesKey(aesKey)) {
          emitStep('complete');
          trace.push('step', 'complete');
        }

        setOnboardingDebugTrace(trace.toLines());
        return aesKey;
      } catch (error: unknown) {
        // On error, attempt to switch wallet back to the original chain
        if (connectedChainId !== COTI_MAINNET_CHAIN_ID && connectedChainId !== COTI_TESTNET_CHAIN_ID && connectedChainId) {
          try {
            const wp = await connector.getProvider() as any;
            await wp?.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x' + connectedChainId.toString(16) }],
            });
          } catch {
            logger.warn('⚠️ [AesKeyProvider] Could not restore original chain after error');
          }
        }

        // EIP-1193 error code 4001: user rejected the signature request
        if (isUserRejection(error)) {
          emitStep('idle');
          return null;
        }

        // Set error state for UI display
        const errorMessage = formatOnboardingError(error);
        setOnboardingError(errorMessage);
        emitStep('error');
        trace.push('error', errorMessage);
        setOnboardingDebugTrace(trace.toLines());
        logger.error('❌ Onboarding contract AES key retrieval failed:', error);
        return null;
      } finally {
        // Reduced delay: Components 1 & 2 now guard against stale chain-change events
        // resetting private balances. 500ms is sufficient to absorb the immediate
        // chainChanged event from the switch-back.
        if (isChainUpdatesMuted()) {
          await new Promise(resolve => setTimeout(resolve, 500));
          unmuteChainUpdates();
          logger.log('🔊 [AesKeyProvider] Chain updates unmuted');
        }
        setIsOnboarding(false);
        progressCallbackRef.current = undefined;
      }
    },
    [walletTypeInfo.walletType, getAESKeyFromSnap, saveAESKeyToSnap, clearSnapCache, connector, connectedChainId, emitStep]
  );

  return {
    getAesKey,
    isOnboarding,
    onboardingError,
    onboardingWarning,
    wasRestoreCancelled,
    currentStep,
    onboardingDebugTrace,
  };
}
