import { useState, useCallback, useRef } from 'react';
import { useConnectorClient, useAccount } from 'wagmi';
import { BrowserProvider } from '@coti-io/coti-ethers';
import { useSnap } from './useSnap';
import type { WalletTypeInfo } from './useWalletType';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from '../lib/logger';
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID } from '../config/chains';
import { muteChainUpdates, unmuteChainUpdates, isChainUpdatesMuted } from '../lib/chainMute';
import { canPersistAesKeyToSnap } from '../lib/snapOrigins';

/**
 * Regex pattern for validating AES key format: 32 or 64 hexadecimal characters.
 * Supports both 128-bit (32 chars) and 256-bit (64 chars) AES keys.
 * - Onboard contract returns 32-char keys (128-bit)
 * - Snap returns 64-char keys (256-bit)
 */
const AES_KEY_PATTERN = /^[0-9a-fA-F]{32}$|^[0-9a-fA-F]{64}$/;

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
  { id: 'validating-key', label: 'Validate Key', description: 'Validating AES key format' },
];

/**
 * Callback type for receiving onboarding step progress updates.
 */
export type OnboardingProgressCallback = (step: OnboardingStep) => void;

/**
 * Result interface for the useAesKeyProvider hook.
 */
export interface AesKeyProviderResult {
  /** Retrieves AES key — routes to Snap or onboard contract based on wallet type */
  getAesKey: (address: string, onProgress?: OnboardingProgressCallback) => Promise<string | null>;
  /** True during the async generateOrRecoverAes() call */
  isOnboarding: boolean;
  /** Error message from failed onboarding attempts; cleared on next call */
  onboardingError: string | null;
  /** Current onboarding step (for progress UI) */
  currentStep: OnboardingStep;
}

/**
 * Checks if an error is an EIP-1193 user rejection (code 4001).
 */
function isUserRejection(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as { code?: number; message?: string };
    if (err.code === EIP_1193_USER_REJECTED) return true;
    if (err.message?.includes('User rejected') || err.message?.includes('rejected the request')) {
      return true;
    }
  }
  return false;
}

/**
 * Validates that a string is a valid 32 or 64-character hex AES key.
 * Accepts both 128-bit (32 chars) and 256-bit (64 chars) keys.
 */
export function isValidAesKey(key: string): boolean {
  return AES_KEY_PATTERN.test(key);
}

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
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('idle');
  const progressCallbackRef = useRef<OnboardingProgressCallback | undefined>();

  const { getAESKeyFromSnap, saveAESKeyToSnap } = useSnap();
  const { connector, chainId: connectedChainId } = useAccount();
  const { data: connectorClient } = useConnectorClient();

  const emitStep = useCallback((step: OnboardingStep) => {
    setCurrentStep(step);
    progressCallbackRef.current?.(step);
  }, []);

  const getAesKey = useCallback(
    async (address: string, onProgress?: OnboardingProgressCallback): Promise<string | null> => {
      // Store progress callback for use within the flow
      progressCallbackRef.current = onProgress;
      // Clear previous error on each new retrieval attempt
      setOnboardingError(null);
      emitStep('idle');

      // Route 1: MetaMask — try Snap path first (handles snap connection on demand)
      if (walletTypeInfo.walletType === 'metamask') {
        try {
          const key = await getAESKeyFromSnap(address);
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
          // Snap missing or empty — fall through to contract onboarding (mirrors companion site)
          if (
            error instanceof CotiPluginError &&
            (error.code === CotiErrorCode.SNAP_CONNECT_FAILED ||
              error.code === CotiErrorCode.AES_KEY_MISSING)
          ) {
            logger.log('ℹ️ Snap unavailable or empty, falling back to onboard contract');
            // Fall through to Route 2
          } else if (
            error instanceof Error &&
            (error.message.includes('No account connected') ||
              error.message.includes('Extension context invalidated'))
          ) {
            logger.log('ℹ️ Snap wallet not ready, falling back to onboard contract');
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

        // Step: Switch network to COTI Testnet
        emitStep('switching-network');

        // Determine if we need to switch to a COTI chain for onboarding
        const isCotiChain = connectedChainId === COTI_MAINNET_CHAIN_ID || connectedChainId === COTI_TESTNET_CHAIN_ID;
        const targetCotiChainHex = '0x' + COTI_TESTNET_CHAIN_ID.toString(16);
        const originalChainHex = connectedChainId ? '0x' + connectedChainId.toString(16) : null;

        // If not on COTI, mute UI chain reactions and switch provider-level
        if (!isCotiChain) {
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

        // Instrument the wallet provider's `request` method so we can detect when
        // the SDK moves from the message signature to the on-chain onboarding
        // transaction. `generateOrRecoverAes()` performs TWO wallet interactions
        // inside a single call:
        //   1. a message signature   → "Sign Transaction" step (already active)
        //   2. an eth_sendTransaction → "Execute Transaction" step
        // Without this hook the UI cannot advance between the two wallet prompts
        // and appears stuck on step 1.
        let executeStepEmitted = false;
        const hadOwnRequest = Object.prototype.hasOwnProperty.call(walletProvider, 'request');
        const originalRequest = walletProvider.request;
        walletProvider.request = function instrumentedRequest(args: any) {
          if (args?.method === 'eth_sendTransaction' && !executeStepEmitted) {
            executeStepEmitted = true;
            // Mark "Sign Transaction" complete and activate "Execute Transaction"
            emitStep('retrieving-key');
          }
          return originalRequest.call(walletProvider, args);
        };
        const restoreRequest = () => {
          if (hadOwnRequest) {
            walletProvider.request = originalRequest;
          } else {
            try {
              delete walletProvider.request;
            } catch {
              walletProvider.request = originalRequest;
            }
          }
        };

        // Create a @coti-io/coti-ethers BrowserProvider (now on COTI Testnet)
        const provider = new BrowserProvider(walletProvider);
        const signer = await provider.getSigner(address);

        // Step: Execute onboarding — first wallet interaction is the message signature
        emitStep('signing-transaction');

        // Execute onboarding on COTI Testnet. The instrumented request hook above
        // advances the UI to "Execute Transaction" when the on-chain tx is sent.
        try {
          await signer.generateOrRecoverAes();
        } finally {
          restoreRequest();
        }

        // Ensure the UI advances past signing even on recover-only paths that
        // never issue an eth_sendTransaction (idempotent if already emitted).
        emitStep('retrieving-key');

        const onboardInfo = signer.getUserOnboardInfo();
        const aesKey = onboardInfo?.aesKey ?? null;

        // Step: Validate key format
        emitStep('validating-key');

        if (aesKey && !isValidAesKey(aesKey)) {
          logger.warn('⚠️ AES key from onboard contract failed format validation');
          setOnboardingError('Retrieved AES key has invalid format');
          emitStep('error');
          // Still switch back before returning
        } else {
          logger.log('✅ AES key retrieved successfully:', aesKey?.length, 'characters');
        }

        // Step: Switch wallet back to original chain
        emitStep('restoring-network');

        if (!isCotiChain && originalChainHex) {
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
        emitStep('persisting-key');

        if (aesKey && walletTypeInfo.walletType === 'metamask' && canPersistAesKeyToSnap()) {
          const saved = await saveAESKeyToSnap(aesKey, address);
          if (!saved) {
            logger.warn('⚠️ AES key retrieved but could not persist to Snap');
          }
        } else if (aesKey && walletTypeInfo.walletType === 'metamask') {
          logger.log(
            'ℹ️ Skipping Snap AES persist — origin not authorized for set-aes-key:',
            typeof window !== 'undefined' ? window.location.origin : 'unknown',
          );
        }

        // Step: Complete
        if (aesKey && isValidAesKey(aesKey)) {
          emitStep('complete');
        }

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
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to retrieve AES key from onboarding contract';
        setOnboardingError(errorMessage);
        emitStep('error');
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
    [walletTypeInfo.walletType, getAESKeyFromSnap, saveAESKeyToSnap, connector, connectedChainId, emitStep]
  );

  return {
    getAesKey,
    isOnboarding,
    onboardingError,
    currentStep,
  };
}
