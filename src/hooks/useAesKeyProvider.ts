import { useState, useCallback, useRef } from 'react';
import { useAccount } from 'wagmi';
import { BrowserProvider, JsonRpcSigner } from '@coti-io/coti-ethers';
import { getBigInt, type BigNumberish } from 'ethers';
import { useSnap } from './useSnap';
import type { WalletTypeInfo } from './useWalletType';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from '../lib/logger';
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID, getRpcUrlForChainId } from '../config/chains';
import { getPluginConfig, type EncryptedAesBackup } from '../config/plugin';
import { decryptAesKeyBackup } from '../crypto/aesKeyBackupVault';
import { normalizeAesKey } from '../crypto/aesKey';
import { muteChainUpdates, unmuteChainUpdates, isChainUpdatesMuted } from '../lib/chainMute';
import { canPersistAesKeyToSnap } from '../lib/snapOrigins';
import { resolveAesKeyChainId } from '../lib/aesAccessStrategy';
import { isOnboardingServicesEnabled } from '../lib/onboardingServices';
import { persistEncryptedAesBackup } from '../lib/persistEncryptedAesBackup';
import { isInsufficientFundsError, isUserRejection } from '../lib/walletErrors';
import {
  clearMetaMaskMobileRpcCache,
  formatOnboardingError,
  guardedEthChainId,
  guardedMobileReadOnlyRpc,
  guardedMobileWalletRpc,
  isMetaMaskMobileBrowser,
  mobileHttpJsonRpc,
  MOBILE_READ_ONLY_RPC_METHODS,
  OnboardingDebugTrace,
  resolveMetaMaskMobileWalletProvider,
} from '../lib/metaMaskMobile';

/**
 * Onboarding step identifiers matching the contract onboarding flow (steps 3-9).
 */
export type OnboardingStep =
  | 'idle'
  | 'switching-network'
  | 'creating-provider'
  | 'preparing-onboard'
  | 'signing-transaction'
  | 'retrieving-key'
  | 'validating-key'
  | 'restoring-network'
  | 'persisting-key'
  | 'restoring-backup'
  | 'signing-backup'
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
  { id: 'preparing-onboard', label: 'Preparing', description: 'Checking wallet and preparing onboarding' },
  { id: 'signing-transaction', label: 'Sign Transaction', description: 'Please sign the transaction in your wallet' },
  { id: 'retrieving-key', label: 'Execute Transaction', description: 'Please execute the next transaction in your wallet to generate or retrieve your AES Key' },
  { id: 'persisting-key', label: 'Persisting Key', description: 'Persisting your AES encryption key' },
];

export interface OnboardingProgressDetails {
  /** True when the step transition was caused by explicit user cancellation. */
  cancelled?: boolean;
  /** Human-facing failure message for error transitions. */
  error?: string;
}

/**
 * Callback type for receiving onboarding step progress updates.
 */
export type OnboardingProgressCallback = (
  step: OnboardingStep,
  details?: OnboardingProgressDetails,
) => void;

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
  /** Encrypted backup blob from an earlier access probe — avoids a second fetch before sign. */
  prefetchedEncryptedBackup?: EncryptedAesBackup | null;
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
  readOnlyRpcChainId?: number,
  walletRejectionRef?: { current: boolean },
): () => void {
  const hadOwnRequest = Object.prototype.hasOwnProperty.call(walletProvider, 'request');
  const originalRequest = walletProvider.request.bind(walletProvider);
  let executeStepEmitted = false;
  let signingStepEmitted = false;
  const readOnlyRpcUrl = readOnlyRpcChainId != null
    ? getRpcUrlForChainId(readOnlyRpcChainId)
    : undefined;

  walletProvider.request = async function instrumentedRequest(args: Eip1193RequestPayload) {
    const method = args?.method ?? 'unknown';
    trace.push('rpc', method);

    if (args?.method === 'eth_sendTransaction' && !executeStepEmitted) {
      executeStepEmitted = true;
      emitStep('retrieving-key');
    } else if (SIGN_RPC_METHODS.has(method)) {
      if (!signingStepEmitted) {
        signingStepEmitted = true;
        emitStep('signing-transaction');
      }
      trace.push('wallet-prompt', `Approve signature in wallet (${method})`);
    }

    try {
      if (isMetaMaskMobileBrowser()) {
        if (MOBILE_READ_ONLY_RPC_METHODS.has(method)) {
          const readOnlyProvider = readOnlyRpcUrl
            ? {
                request: ({ method: rpcMethod, params }: Eip1193RequestPayload) =>
                  mobileHttpJsonRpc(readOnlyRpcUrl, rpcMethod, params ?? []),
              }
            : { request: originalRequest };
          if (readOnlyRpcUrl) {
            trace.push('rpc-via', `http(${method})`);
          }
          const result = await guardedMobileReadOnlyRpc(
            readOnlyProvider,
            method,
            args.params ?? [],
          );
          trace.push('rpc-ok', method);
          return result;
        }
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
          clearMetaMaskMobileRpcCache();
        }
        if (SIGN_RPC_METHODS.has(method) || method === 'eth_sendTransaction') {
          trace.push('wallet-send', method);
        }
        const result = await guardedMobileWalletRpc(
          { request: originalRequest },
          method,
          args.params ?? [],
        );
        trace.push('rpc-ok', method);
        return result;
      }

      const result = await originalRequest(args);
      trace.push('rpc-ok', method);
      return result;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      trace.push('rpc-err', `${method}: ${errMsg}`);
      if (
        walletRejectionRef
        && isUserRejection(error)
        && (SIGN_RPC_METHODS.has(method) || method === 'eth_sendTransaction')
      ) {
        walletRejectionRef.current = true;
      }
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
  const progressCallbackRef = useRef<OnboardingProgressCallback | undefined>();
  const debugTraceRef = useRef(new OnboardingDebugTrace());
  const onboardingInFlightRef = useRef<Promise<string | null> | null>(null);

  const { getAESKeyFromSnap, saveAESKeyToSnap, clearSnapCache } = useSnap();
  const { connector, chainId: connectedChainId } = useAccount();

  const emitStep = useCallback((step: OnboardingStep, details?: OnboardingProgressDetails) => {
    setCurrentStep(step);
    progressCallbackRef.current?.(step, details);
  }, []);

  const reportOnboardingFailure = useCallback((message: string) => {
    setOnboardingError(message);
    emitStep('error', { error: message });
  }, [emitStep]);

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
      setOnboardingWarning(null);
      setWasRestoreCancelled(false);
      const forceContractOnboarding = options?.forceContractOnboarding === true;
      if (!forceContractOnboarding) {
        emitStep('idle');
      }
      let restoreBackupFailed = false;

      const trace = debugTraceRef.current;
      trace.push('start', `wallet=${walletTypeInfo.walletType} mobile=${isMetaMaskMobileBrowser()}`);

      if (onboardingInFlightRef.current) {
        trace.push('route', 'onboarding already in flight - joining');
        return onboardingInFlightRef.current;
      }

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
        reportOnboardingFailure('No wallet provider available. Please connect your wallet.');
        return null;
      }

      const walletRejectionRef = { current: false };
      const onboardingPromise = (async (): Promise<string | null> => {
      try {
        setIsOnboarding(true);

        // Get the EIP-1193 provider from the wagmi connector
        const connectorProvider = await connector.getProvider() as Eip1193ProviderLike | null;
        const walletProvider = resolveMetaMaskMobileWalletProvider(
          connectorProvider as Parameters<typeof resolveMetaMaskMobileWalletProvider>[0],
        ) as Eip1193ProviderLike;
        if (isMetaMaskMobileBrowser()) {
          trace.push(
            'provider',
            walletProvider === connectorProvider ? 'wagmi-connector' : 'native-injected',
          );
        }
        if (!walletProvider?.request) {
          reportOnboardingFailure('Could not get provider from wallet connector.');
          return null;
        }

        const config = getPluginConfig();
        const services = config.onboardingServices;
        const servicesEnabled = isOnboardingServicesEnabled();
        const isConnectedCotiChain = connectedChainId === COTI_MAINNET_CHAIN_ID || connectedChainId === COTI_TESTNET_CHAIN_ID;
        const targetCotiChainId = resolveAesKeyChainId(connectedChainId, options.aesKeyChainId);
        const backupContext = { address, chainId: targetCotiChainId };

        if (servicesEnabled && services?.fetchEncryptedAesBackup) {
          try {
            emitStep('restoring-backup');
            const backup = options.prefetchedEncryptedBackup === undefined
              ? await services.fetchEncryptedAesBackup(backupContext)
              : options.prefetchedEncryptedBackup;
            if (backup) {
              const provider = new BrowserProvider(walletProvider);
              const signer = isMetaMaskMobileBrowser()
                ? new JsonRpcSigner(provider, address)
                : await provider.getSigner(address);
              emitStep('signing-backup');
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
                reportOnboardingFailure('Failed to add COTI Testnet to wallet.');
                return null;
              }
            } else {
              unmuteChainUpdates();
              if (switchErr?.code === 4001) {
                emitStep('idle', { cancelled: true });
                return null;
              }
              reportOnboardingFailure('Failed to switch to COTI Testnet for onboarding.');
              return null;
            }
          }
        }

        // Step: Create provider and signer
        emitStep('creating-provider');
        trace.push('step', 'creating-provider');

        const restoreRequest = instrumentWalletProvider(
          walletProvider,
          emitStep,
          trace,
          targetCotiChainId,
          walletRejectionRef,
        );

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

        if (isMetaMaskMobileBrowser()) {
          clearMetaMaskMobileRpcCache();
          const rpcUrl = getRpcUrlForChainId(targetCotiChainId);
          await guardedEthChainId({
            request: ({ method, params }) =>
              mobileHttpJsonRpc(rpcUrl, method, params ?? []),
          });
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
                const timeoutMs = config.onboardingGrantTimeoutMs ?? 60000;
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

        // Step: Execute onboarding - wallet prompts fire from the instrumented RPC hook.
        emitStep('preparing-onboard');
        trace.push('step', 'preparing-onboard');

        // Execute onboarding on COTI Testnet. The instrumented request hook above
        // advances the UI to "Sign Transaction" on personal_sign and
        // "Execute Transaction" when the on-chain tx is sent.
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
          if (!isConnectedCotiChain && originalChainHex) {
            try {
              await walletProvider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: originalChainHex }],
              });
            } catch {
              logger.warn('⚠️ [AesKeyProvider] Could not switch back to original chain after invalid AES key');
            }
          }
          reportOnboardingFailure('Retrieved AES key has invalid format');
          return null;
        }

        logger.log('✅ AES key retrieved successfully:', aesKey?.length, 'characters');

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

        // Step: Persist key (MetaMask Snap / encrypted backup) or finalize
        let savedToSnap = false;
        const canSaveToConnectedSnap =
          aesKey
          && walletTypeInfo.walletType === 'metamask'
          && walletTypeInfo.isMetaMaskWithSnap
          && canPersistAesKeyToSnap();
        const canSaveEncryptedBackup =
          aesKey &&
          isValidAesKey(aesKey) &&
          options.saveBackup &&
          servicesEnabled &&
          (services?.saveEncryptedAesBackup || services?.replaceEncryptedAesBackup);

        if (canSaveToConnectedSnap) {
          emitStep('persisting-key');
          trace.push('step', 'persisting-key');
          savedToSnap = await saveAESKeyToSnap(aesKey, address);
          if (!savedToSnap) {
            logger.warn('⚠️ AES key retrieved but could not persist to Snap');
            setOnboardingWarning(
              'Onboarding succeeded, but the AES key could not be saved to MetaMask Snap. You can retry by unlocking again.',
            );
          }
        } else if (
          aesKey
          && walletTypeInfo.walletType === 'metamask'
          && canPersistAesKeyToSnap()
          && !walletTypeInfo.isMetaMaskWithSnap
        ) {
          logger.log(
            'ℹ️ Skipping Snap AES persist — Snap is not connected to this origin',
          );
        }

        const skipEncryptedBackupForSnap =
          canSaveToConnectedSnap && savedToSnap;

        if (
          canSaveEncryptedBackup &&
          !skipEncryptedBackupForSnap &&
          aesKey
        ) {
          const backupResult = await persistEncryptedAesBackup({
            aesKey,
            address,
            chainId: targetCotiChainId,
            connector,
            preferReplace: restoreBackupFailed,
            onBeforeSign: () => emitStep('signing-backup'),
          });

          if (backupResult.status === 'failed') {
            logger.warn(
              '⚠️ AES key retrieved but encrypted backup save failed:',
              backupResult.message,
            );
            setOnboardingWarning(
              `Onboarding succeeded, but encrypted backup was not saved. ${backupResult.message}`,
            );
          } else if (backupResult.status === 'cancelled') {
            logger.warn('⚠️ AES key retrieved but encrypted backup save was cancelled');
            setOnboardingWarning(
              'Onboarding succeeded, but encrypted backup save was cancelled. You can save it later by re-entering your AES key.',
            );
          }
        }

        // Step: Complete
        if (aesKey && isValidAesKey(aesKey)) {
          emitStep('complete');
          trace.push('step', 'complete');
        }

        return aesKey;
      } catch (error: unknown) {
        // On error, attempt to switch wallet back to the original chain
        if (connectedChainId !== COTI_MAINNET_CHAIN_ID && connectedChainId !== COTI_TESTNET_CHAIN_ID && connectedChainId) {
          try {
            const connectorProvider = await connector.getProvider() as Eip1193ProviderLike | null;
            const wp = resolveMetaMaskMobileWalletProvider(
              connectorProvider as Parameters<typeof resolveMetaMaskMobileWalletProvider>[0],
            ) as Eip1193ProviderLike;
            await wp?.request?.({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: '0x' + connectedChainId.toString(16) }],
            });
          } catch {
            logger.warn('⚠️ [AesKeyProvider] Could not restore original chain after error');
          }
        }

        // EIP-1193 error code 4001: user rejected the signature request.
        // coti-ethers onboard() also rethrows a generic "unable to onboard user." message
        // after personal_sign rejection — walletRejectionRef preserves that signal.
        const signRejectedDuringOnboarding = walletRejectionRef.current;
        if (isUserRejection(error) || signRejectedDuringOnboarding) {
          emitStep('idle', { cancelled: true });
          return null;
        }

        if (isInsufficientFundsError(error)) {
          const errorMessage = 'Insufficient native COTI for onboarding gas. Add COTI and retry.';
          logger.warn('[AesKeyProvider] Insufficient native COTI for onboarding; wallet surfaced the error');
          reportOnboardingFailure(errorMessage);
          return null;
        }

        // Set error state for UI display
        const errorMessage = formatOnboardingError(error);
        reportOnboardingFailure(errorMessage);
        trace.push('error', errorMessage);
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
      })();

      onboardingInFlightRef.current = onboardingPromise;
      try {
        return await onboardingPromise;
      } finally {
        if (onboardingInFlightRef.current === onboardingPromise) {
          onboardingInFlightRef.current = null;
        }
      }
    },
    [walletTypeInfo.walletType, getAESKeyFromSnap, saveAESKeyToSnap, clearSnapCache, connector, connectedChainId, emitStep, reportOnboardingFailure]
  );

  return {
    getAesKey,
    isOnboarding,
    onboardingError,
    onboardingWarning,
    wasRestoreCancelled,
    currentStep,
  };
}
