import { useState, useCallback } from 'react';
import { useConnectorClient } from 'wagmi';
import { BrowserProvider } from '@coti-io/coti-ethers';
import { useSnap } from './useSnap';
import type { WalletTypeInfo } from './useWalletType';

/**
 * Regex pattern for validating AES key format: exactly 64 hexadecimal characters.
 * Represents a 32-byte (256-bit) AES key.
 */
const AES_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;

/**
 * EIP-1193 error code for user rejection of a wallet request.
 */
const EIP_1193_USER_REJECTED = 4001;

/**
 * Result interface for the useAesKeyProvider hook.
 */
export interface AesKeyProviderResult {
  /** Retrieves AES key — routes to Snap or onboard contract based on wallet type */
  getAesKey: (address: string) => Promise<string | null>;
  /** True during the async generateOrRecoverAes() call */
  isOnboarding: boolean;
  /** Error message from failed onboarding attempts; cleared on next call */
  onboardingError: string | null;
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
 * Validates that a string is a valid 64-character hex AES key.
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

  const { getAESKeyFromSnap } = useSnap();
  const { data: connectorClient } = useConnectorClient();

  const getAesKey = useCallback(
    async (address: string): Promise<string | null> => {
      // Clear previous error on each new retrieval attempt
      setOnboardingError(null);

      // Route 1: MetaMask with Snap — delegate to existing Snap flow
      if (walletTypeInfo.isMetaMaskWithSnap) {
        try {
          const key = await getAESKeyFromSnap(address);
          if (key && !isValidAesKey(key)) {
            console.warn('⚠️ AES key from Snap failed format validation');
            return null;
          }
          return key;
        } catch (error: unknown) {
          if (isUserRejection(error)) {
            return null;
          }
          throw error;
        }
      }

      // Route 2: Non-MetaMask wallet — use onboarding contract flow
      if (!connectorClient) {
        setOnboardingError('No wallet provider available. Please connect your wallet.');
        return null;
      }

      try {
        setIsOnboarding(true);

        // Get the EIP-1193 provider from the wagmi connector client
        const walletProvider = connectorClient.transport;

        // Create a @coti-io/coti-ethers BrowserProvider from the EIP-1193 provider
        const provider = new BrowserProvider(walletProvider);

        // Get the signer for the connected address
        const signer = await provider.getSigner(address);

        // Call generateOrRecoverAes() — this triggers a wallet signature request
        await signer.generateOrRecoverAes();

        // Retrieve the AES key from the signer's onboard info
        const onboardInfo = signer.getUserOnboardInfo();
        const aesKey = onboardInfo?.aesKey ?? null;

        if (aesKey && !isValidAesKey(aesKey)) {
          console.warn('⚠️ AES key from onboard contract failed format validation');
          setOnboardingError('Retrieved AES key has invalid format');
          return null;
        }

        return aesKey;
      } catch (error: unknown) {
        // EIP-1193 error code 4001: user rejected the signature request
        if (isUserRejection(error)) {
          return null;
        }

        // Set error state for UI display
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to retrieve AES key from onboarding contract';
        setOnboardingError(errorMessage);
        console.error('❌ Onboarding contract AES key retrieval failed:', error);
        return null;
      } finally {
        setIsOnboarding(false);
      }
    },
    [walletTypeInfo.isMetaMaskWithSnap, getAESKeyFromSnap, connectorClient]
  );

  return {
    getAesKey,
    isOnboarding,
    onboardingError,
  };
}
