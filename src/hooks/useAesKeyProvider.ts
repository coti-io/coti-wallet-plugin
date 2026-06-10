import { useState, useCallback } from 'react';
import { useConnectorClient, useAccount } from 'wagmi';
import { BrowserProvider } from '@coti-io/coti-ethers';
import { useSnap } from './useSnap';
import type { WalletTypeInfo } from './useWalletType';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from '../lib/logger';
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID } from '../config/chains';
import { muteChainUpdates, unmuteChainUpdates, isChainUpdatesMuted } from '../lib/chainMute';

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

  const { getAESKeyFromSnap } = useSnap();
  const { connector, chainId: connectedChainId } = useAccount();
  const { data: connectorClient } = useConnectorClient();

  const getAesKey = useCallback(
    async (address: string): Promise<string | null> => {
      // Clear previous error on each new retrieval attempt
      setOnboardingError(null);

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
          // SNAP_CONNECT_FAILED means snap is not available — fall through to contract onboarding
          if (error instanceof CotiPluginError && error.code === CotiErrorCode.SNAP_CONNECT_FAILED) {
            logger.log('ℹ️ Snap not available, falling back to onboard contract');
            // Fall through to Route 2
          } else {
            throw error;
          }
        }
      }

      // Route 2: Non-MetaMask wallet (or MetaMask without snap) — use onboarding contract flow
      if (!connector) {
        setOnboardingError('No wallet provider available. Please connect your wallet.');
        return null;
      }

      try {
        setIsOnboarding(true);

        // Get the EIP-1193 provider from the wagmi connector
        const walletProvider = await connector.getProvider() as any;
        if (!walletProvider) {
          setOnboardingError('Could not get provider from wallet connector.');
          return null;
        }

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
                return null;
              }
            } else {
              unmuteChainUpdates();
              if (switchErr?.code === 4001) return null; // user rejected
              setOnboardingError('Failed to switch to COTI Testnet for onboarding.');
              return null;
            }
          }
        }

        // Create a @coti-io/coti-ethers BrowserProvider (now on COTI Testnet)
        const provider = new BrowserProvider(walletProvider);
        const signer = await provider.getSigner(address);

        // Execute onboarding on COTI Testnet
        await signer.generateOrRecoverAes();

        const onboardInfo = signer.getUserOnboardInfo();
        const aesKey = onboardInfo?.aesKey ?? null;

        if (aesKey && !isValidAesKey(aesKey)) {
          logger.warn('⚠️ AES key from onboard contract failed format validation');
          setOnboardingError('Retrieved AES key has invalid format');
          // Still switch back before returning
        } else {
          logger.log('✅ AES key retrieved successfully:', aesKey?.length, 'characters');
        }

        // Switch wallet back to original chain (unmute happens in finally)
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
          return null;
        }

        // Set error state for UI display
        const errorMessage =
          error instanceof Error ? error.message : 'Failed to retrieve AES key from onboarding contract';
        setOnboardingError(errorMessage);
        logger.error('❌ Onboarding contract AES key retrieval failed:', error);
        return null;
      } finally {
        // Always unmute (after a delay so the switch-back chainChanged event is ignored).
        if (isChainUpdatesMuted()) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          unmuteChainUpdates();
          logger.log('🔊 [AesKeyProvider] Chain updates unmuted');
        }
        setIsOnboarding(false);
      }
    },
    [walletTypeInfo.isMetaMaskWithSnap, getAESKeyFromSnap, connector, connectedChainId]
  );

  return {
    getAesKey,
    isOnboarding,
    onboardingError,
  };
}
