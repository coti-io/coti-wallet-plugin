import { useCallback, useRef } from 'react';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';
const { generateRSAKeyPair, decryptRSA } = CotiSDK;
import { MetaMaskInpageProvider } from '@metamask/providers';
import { useAccount } from 'wagmi';
import { getPluginConfig } from '../config/plugin';
import { getMetaMaskProvider } from '../lib/ethereum';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from '../lib/logger';
import {
    assertMetaMaskActiveAccount,
    validateAesKeyRoundTrip,
} from '../crypto/aesKeyValidation';
import type { CtUint256 } from '../types/ciphertext';

export interface GetAESKeyFromSnapOptions {
    /** Bypass the in-memory cache and fetch a fresh key from the Snap. */
    skipCache?: boolean;
}

export interface BuildItUint256ViaSnapParams {
    value: bigint | string;
    tokenAddress: string;
    functionSelector: string;
    chainId?: number | string;
}

export interface SnapItUint256 {
    ciphertext: {
        ciphertextHigh: bigint;
        ciphertextLow: bigint;
    };
    signature: string;
}

/**
 * Custom hook that manages the entire lifecycle of the Coti Snap integration.
 * 
 * This hook serves as the central controller for all Snap-related operations, including:
 * 1. **Installation Check**: Verifying if the Coti Snap is installed in the user's MetaMask wallet.
 * 2. **Connection Management**: orchestrating the connection process and requesting necessary permissions.
 * 3. **Key Retrieval**: Securely retrieving the user's AES key from the Snap for on-chain data decryption.
 * 4. **Error Handling**: centralizing error state management and providing retry mechanisms for connection failures.
 * 
 * It acts as a bridge between the DApp and the wallet's Snap capability, ensuring a smooth user experience
 * for privacy-preserving features.
 * 
 * @param setSnapError - Optional state setter to update if Snap is missing or connection fails.
 * @returns {Object} An object containing:
 * - `isSnapInstalled`: Async function that returns true if the Snap is found, false otherwise.
 * - `executeSnapCheck`: Async function that checks installation, logs status, sets error if missing, or executes callback if found.
 * - `connectToSnap`: Async function that requests permissions to connect to the Snap.
 * - `getAESKeyFromSnap`: Async function that specifically retrieves the AES key, handling retries.
 * - `resetError`: Function to clear the error state (if setSnapError is provided).
 */
const snapId = getPluginConfig().snapId;

/**
 * Module-level AES key cache — singleton shared across all `useSnap` hook instances.
 *
 * IMPORTANT: This is intentionally a module-scoped mutable variable, NOT React state.
 * It acts as a process-wide singleton cache so that multiple components mounting
 * `useSnap` share the same cached key without triggering re-renders.
 *
 * Constraints:
 * - Only safe in browser SPA environments (single JS context per tab).
 * - NOT compatible with SSR or React Server Components — the cache would leak
 *   across requests on the server.
 * - Cleared explicitly via `clearSnapCache()` on disconnect or account change.
 * - Never persisted to storage — lost on page refresh by design.
 */
let globalAESKeyCache: Record<string, string> = {};

function getErrorMessage(error: unknown): string {
    if (error && typeof error === 'object') {
        const err = error as {
            message?: string;
            data?: { originalError?: { message?: string } };
        };
        return err.data?.originalError?.message ?? err.message ?? '';
    }
    return '';
}

function isSnapAccountNotReadyError(error: unknown): boolean {
    const message = getErrorMessage(error);
    return (
        message.includes('No account connected') ||
        message.includes('Extension context invalidated')
    );
}

function toSnapChainId(chainId?: number | string): string | undefined {
    return chainId === undefined ? undefined : String(chainId);
}

function stringifyBigInts(value: unknown): unknown {
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map(stringifyBigInts);
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).map(([key, item]) => [
                key,
                stringifyBigInts(item),
            ]),
        );
    }
    return value;
}

function parseSnapItUint256(value: unknown): SnapItUint256 | null {
    const result = value as {
        ciphertext?: { ciphertextHigh?: string | number | bigint; ciphertextLow?: string | number | bigint };
        signature?: string;
    } | null;
    if (!result?.ciphertext || typeof result.signature !== 'string') return null;
    return {
        ciphertext: {
            ciphertextHigh: BigInt(result.ciphertext.ciphertextHigh ?? 0),
            ciphertextLow: BigInt(result.ciphertext.ciphertextLow ?? 0),
        },
        signature: result.signature,
    };
}

async function ensureSnapWalletAccounts(provider: MetaMaskInpageProvider): Promise<void> {
    try {
        await provider.request({ method: 'eth_requestAccounts' });
    } catch (error) {
        logger.warn('⚠️ eth_requestAccounts before Snap RPC failed:', getErrorMessage(error));
    }
}

async function prepareSnapForKeyAccess(
    provider: MetaMaskInpageProvider,
    snapIdValue: string,
): Promise<void> {
    await ensureSnapWalletAccounts(provider);
    try {
        await provider.request({
            method: 'wallet_invokeSnap',
            params: {
                snapId: snapIdValue,
                request: { method: 'connect-to-wallet' },
            },
        });
    } catch (error) {
        logger.warn('⚠️ Snap connect-to-wallet failed (non-fatal):', getErrorMessage(error));
    }
}

export const useSnap = (setSnapError?: (error: string | null) => void) => {
    const isSnapRequestPending = useRef(false);
    const { connector } = useAccount();

    /**
     * Resolves the MetaMask provider for Snap RPCs.
     * Prefers the wagmi connector (EIP-6963 when connected via MetaMask), then
     * EIP-6963 discovery, then window.ethereum fallbacks.
     */
    const resolveProvider = useCallback(async (): Promise<MetaMaskInpageProvider | null> => {
        if (connector) {
            try {
                const connectorProvider = await connector.getProvider();
                if (connectorProvider) {
                    logger.log('🔗 Snap provider: wagmi connector');
                    return connectorProvider as MetaMaskInpageProvider;
                }
            } catch (error) {
                logger.warn('⚠️ connector.getProvider() failed for Snap', error);
            }
        }

        const metaMaskProvider = getMetaMaskProvider();
        if (metaMaskProvider) {
            logger.log('🔗 Snap provider: EIP-6963 / MetaMask fallback');
            return metaMaskProvider as MetaMaskInpageProvider;
        }

        logger.log('❌ No MetaMask provider available for Snap');
        return null;
    }, [connector]);

    // Flag to check if environment is Flask
    const isFlask = useRef<boolean>(false);

    /**
     * Detects if the user is running MetaMask Flask.
     */
    const detectFlask = useCallback(async (): Promise<boolean> => {
        const provider = await resolveProvider();
        /* v8 ignore next -- unreachable: isSnapInstalled guards provider before calling detectFlask */
        if (!provider) return false;
        try {
            const clientVersion = await provider.request({ method: 'web3_clientVersion' });
            const isFlaskDetected = (clientVersion as string).includes('flask');
            logger.log(`🦊 Client Version: ${clientVersion} (Flask: ${isFlaskDetected})`);
            isFlask.current = isFlaskDetected;
            return isFlaskDetected;
        } catch (e) {
            logger.warn('⚠️ Failed to check client version', e);
            return false;
        }
    }, [resolveProvider]);

    /**
     * Checks if the Coti Snap is currently installed AND connected to this origin.
     * Only uses wallet_getSnaps — no dialogs, no side effects.
     * Returns false if snap is not visible (not installed OR not connected to this origin).
     * Also returns false for non-MetaMask wallets that don't support wallet_getSnaps.
     */
    const isSnapInstalled = useCallback(async (): Promise<boolean> => {
        const provider = await resolveProvider();
        if (!provider) {
            logger.log('❌ isSnapInstalled: No MetaMask provider');
            return false;
        }

        try {
            await detectFlask();

            logger.log('🕵️‍♀️ requesting wallet_getSnaps...');
            const snaps = (await provider.request({ method: 'wallet_getSnaps' })) as Record<string, any>;
            logger.log('🕵️‍♀️ wallet_getSnaps result:', JSON.stringify(snaps, null, 2));

            const snapInfo = Object.values(snaps).find(
                (snap: any) => snap.id === snapId
            ) || (snapId in snaps);

            if (snapInfo) {
                logger.log(`✅ Snap found and connected: ${snapId}`);
                return true;
            }

            // Snap not visible — either not installed or installed but not connected to this origin.
            // We cannot distinguish without showing a MetaMask dialog.
            // Return false and let the UI guide the user.
            logger.log(`ℹ️ Snap ${snapId} not visible via wallet_getSnaps.`);
            return false;
        } catch (error: any) {
            // -32601 means the wallet doesn't support wallet_getSnaps (Rabby, Trust, etc.)
            if (error?.code === -32601) {
                logger.log('ℹ️ Wallet does not support wallet_getSnaps (non-MetaMask wallet). Snap unavailable.');
                return false;
            }
            logger.error('❌ Error checking snap connection:', error);
            return false;
        }
    }, [snapId, detectFlask, resolveProvider]);


    /**
     * Connect to COTI Snap (request permissions).
     * Returns false immediately for wallets that don't support snaps.
     */
    const connectToSnap = useCallback(async (): Promise<boolean> => {
        const provider = await resolveProvider();
        if (!provider) {
            logger.log('❌ No MetaMask provider available for Snap install');
            if (setSnapError) {
                setSnapError('No MetaMask provider found. Disable other wallet extensions and retry.');
            }
            return false;
        }

        try {
            logger.log('🔌 Requesting permission to connect to COTI Snap...');
            await provider.request({
                method: 'wallet_requestSnaps',
                params: {
                    [snapId]: {}
                }
            });
            logger.log('✅ Connected to COTI Snap');
            if (setSnapError) setSnapError(null);
            return true;
        } catch (error: any) {
            // Non-MetaMask wallets don't support wallet_requestSnaps
            if (error?.code === -32601) {
                logger.log('ℹ️ Wallet does not support wallet_requestSnaps (non-MetaMask wallet).');
                if (setSnapError) {
                    setSnapError('Snap requires MetaMask. Disable other wallet extensions and retry.');
                }
                return false;
            }
            logger.error('❌ Failed to connect to snap:', error.message);
            if (setSnapError) {
                if (!isFlask.current) {
                    setSnapError('MetaMask Flask is required for this Snap.');
                } else {
                    setSnapError('Failed to connect to Snap');
                }
            }
            // Propagate error for context handling
            throw new CotiPluginError(CotiErrorCode.SNAP_CONNECT_FAILED, 'Failed to connect to COTI Snap');
        }
    }, [snapId, setSnapError, resolveProvider]);


    /**
     * Orchestrates the Snap connection check with logging and error handling.
     * 
     * @param onSnapFound - Callback to execute if Snap is installed (e.g., updateAccountState).
     *                      Should return true if successful, false otherwise.
     * @returns {Promise<void>}
     */
    const executeSnapCheck = useCallback(async (
        onSnapFound: () => Promise<boolean>
    ) => {
        const installed = await isSnapInstalled();

        if (installed) {
            logger.log('✅ Snap is installed. Attempting to retrieve key...');
            const success = await onSnapFound();
            if (!success) {
                logger.log('⚠️ Snap installed but key retrieval failed/cancelled. Banner handles error.');
            }
        } else {
            logger.log('ℹ️ Snap NOT installed/detected.');
            if (setSnapError) setSnapError(null);
        }
    }, [isSnapInstalled, setSnapError]);

    /**
     * Syncs the environment (testnet/mainnet) with the Snap.
     * This ensures the Snap uses the correct config for the current network.
     */
    const syncEnvironment = useCallback(async (): Promise<void> => {
        const provider = await resolveProvider();
        if (!provider) return;

        try {
            await ensureSnapWalletAccounts(provider);

            const chainIdHex = await provider.request({ method: 'eth_chainId' }) as string;
            const chainId = parseInt(chainIdHex, 16);

            // Map the current chain to the correct COTI environment.
            // Non-COTI chains (e.g. Sepolia) default to testnet since that is
            // where the user's AES key is stored during testnet workflows.
            const COTI_MAINNET_ID = 2632500;
            const COTI_TESTNET_ID = 7082400;
            const environment = chainId === COTI_MAINNET_ID ? 'mainnet' : 'testnet';
            const cotiChainId = chainId === COTI_MAINNET_ID ? COTI_MAINNET_ID : COTI_TESTNET_ID;

            logger.log(`🌍 Syncing Snap Environment to: ${environment} (requested ChainID: ${chainId} → COTI ChainID: ${cotiChainId})`);

            await provider.request({
                method: 'wallet_invokeSnap',
                params: {
                    snapId,
                    request: {
                        method: 'set-environment',
                        params: { environment }
                    }
                }
            });
            logger.log('✅ Snap Environment Synced');
        } catch (error) {
            logger.warn('⚠️ Failed to sync Snap environment:', error);
            // Non-critical, but good to know
        }
    }, [snapId, resolveProvider]);

    const invokeSnapOperation = useCallback(async <Result,>(
        method: string,
        params?: Record<string, unknown>,
    ): Promise<Result | null> => {
        const provider = await resolveProvider();
        if (!provider) {
            logger.log('❌ No MetaMask provider available for Snap operation');
            return null;
        }

        const installed = await isSnapInstalled();
        if (!installed) {
            throw new CotiPluginError(
                CotiErrorCode.SNAP_CONNECT_FAILED,
                'COTI Snap is not installed or not connected to this origin',
            );
        }

        await prepareSnapForKeyAccess(provider, snapId);
        await syncEnvironment();

        return provider.request({
            method: 'wallet_invokeSnap',
            params: {
                snapId,
                request: {
                    method,
                    params,
                },
            },
        }) as Promise<Result | null>;
    }, [isSnapInstalled, resolveProvider, snapId, syncEnvironment]);

    const decryptCtUint64ViaSnap = useCallback(async (
        value: bigint | string | number,
        chainId?: number | string,
    ): Promise<bigint | null> => {
        const result = await invokeSnapOperation<string | null>('decrypt', {
            type: 'ctUint64',
            value: value.toString(),
            chainId: toSnapChainId(chainId),
        });
        return result == null ? null : BigInt(result);
    }, [invokeSnapOperation]);

    const decryptCtUint256ViaSnap = useCallback(async (
        value: CtUint256,
        chainId?: number | string,
    ): Promise<bigint | null> => {
        const result = await invokeSnapOperation<string | null>('decrypt', {
            type: 'ctUint256',
            value: stringifyBigInts(value),
            chainId: toSnapChainId(chainId),
        });
        return result == null ? null : BigInt(result);
    }, [invokeSnapOperation]);

    const encryptUint256ViaSnap = useCallback(async (
        value: bigint | string,
        chainId?: number | string,
    ): Promise<{ ciphertextHigh: bigint; ciphertextLow: bigint } | null> => {
        const result = await invokeSnapOperation<{
            ciphertextHigh: string | number | bigint;
            ciphertextLow: string | number | bigint;
        } | null>('encrypt', {
            type: 'uint256',
            value: value.toString(),
            chainId: toSnapChainId(chainId),
        });
        if (!result) return null;
        return {
            ciphertextHigh: BigInt(result.ciphertextHigh),
            ciphertextLow: BigInt(result.ciphertextLow),
        };
    }, [invokeSnapOperation]);

    const buildItUint256ViaSnap = useCallback(async (
        params: BuildItUint256ViaSnapParams,
    ): Promise<SnapItUint256 | null> => {
        const result = await invokeSnapOperation<{ value?: unknown } | null>('build-it-uint256', {
            value: params.value.toString(),
            tokenAddress: params.tokenAddress,
            functionSelector: params.functionSelector,
            chainId: toSnapChainId(params.chainId),
        });
        return parseSnapItUint256(result?.value);
    }, [invokeSnapOperation]);

    /**
     * Get AES key from COTI Snap.
     * Includes retry logic.
     */
    const getAESKeyFromSnap = useCallback(async (
        accountAddress: string,
        options?: GetAESKeyFromSnapOptions,
    ): Promise<string | null> => {
        if (setSnapError) setSnapError(null);

        const skipCache = options?.skipCache === true;

        // Return cached key if available (unless a fresh fetch was requested)
        if (!skipCache && globalAESKeyCache[accountAddress.toLowerCase()]) {
            logger.log('🔑 Returning globally cached AES key');
            return globalAESKeyCache[accountAddress.toLowerCase()];
        }

        if (isSnapRequestPending.current) {
            logger.log('⏳ Snap request already pending, skipping concurrent call.');
            return null;
        }

        const provider = await resolveProvider();
        if (!provider) {
            logger.log('❌ No MetaMask provider available');
            return null;
        }

        const installed = await isSnapInstalled();
        if (!installed) {
            logger.log('❌ Snap not visible via wallet_getSnaps.');
            throw new CotiPluginError(
                CotiErrorCode.SNAP_CONNECT_FAILED,
                'COTI Snap is not installed or not connected to this origin',
            );
        }

        await prepareSnapForKeyAccess(provider, snapId);

        // Sync Environment explicitly before requesting key
        await syncEnvironment();

        // Add a small delay to ensure account is fully connected
        await new Promise(resolve => setTimeout(resolve, 500));

        if (accountAddress) {
            await assertMetaMaskActiveAccount(provider, accountAddress);
        }

        try {
            isSnapRequestPending.current = true;
            logger.log('🔑 Requesting AES key from COTI Snap...');

            const COTI_MAINNET_ID = 2632500;
            const COTI_TESTNET_ID = 7082400;
            const rawChainIdHex = await provider.request({ method: 'eth_chainId' }) as string;
            const rawChainId = parseInt(rawChainIdHex, 16);
            const cotiChainId = rawChainId === COTI_MAINNET_ID ? COTI_MAINNET_ID : COTI_TESTNET_ID;

            let hasKey: boolean;
            try {
                hasKey = await provider.request({
                    method: 'wallet_invokeSnap',
                    params: {
                        snapId,
                        request: {
                            method: 'has-aes-key',
                            params: { chainId: cotiChainId },
                        },
                    },
                }) as boolean;
            } catch (error: unknown) {
                if (isSnapAccountNotReadyError(error)) {
                    logger.log('ℹ️ Snap account not ready during has-aes-key — contract onboarding required');
                    throw new CotiPluginError(
                        CotiErrorCode.AES_KEY_MISSING,
                        'COTI Snap has no AES key stored for this account',
                    );
                }
                throw error;
            }

            if (!hasKey) {
                logger.log('ℹ️ Snap installed but has no AES key — contract onboarding required');
                throw new CotiPluginError(
                    CotiErrorCode.AES_KEY_MISSING,
                    'COTI Snap has no AES key stored for this account',
                );
            }

            // Retry logic for robustness
            let retries = 3;
            let lastError;

            while (retries > 0) {
                try {
                    logger.log(`🔑 Requesting AES key for COTI chainId: ${cotiChainId} (wallet chainId: ${rawChainId})`);

                    // Directly request the key (User preference to force fetch)
                    // Explicitly passing chainId to bypass sync state issues
                    const key = await provider.request({
                        method: 'wallet_invokeSnap',
                        params: {
                            snapId,
                            request: {
                                method: 'get-aes-key',
                                params: { chainId: cotiChainId }
                            }
                        }
                    });

                    logger.log('🔍 wallet_invokeSnap: key received, length:', (key as string)?.length);

                    if (!key) {
                        logger.warn('⚠️ Snap returned null (User likely rejected).');
                        // Throw specific error so we don't trigger "Missing Key" onboarding flow
                        throw new CotiPluginError(CotiErrorCode.SNAP_DIALOG_REJECTED, 'User rejected Snap dialog');
                    }

                    const snapKey = key as string;

                    if (!validateAesKeyRoundTrip(snapKey)) {
                        logger.error('❌ Snap AES key failed encrypt/decrypt round-trip validation');
                        throw new CotiPluginError(
                            CotiErrorCode.AES_KEY_MISMATCH,
                            'AES key failed encrypt/decrypt validation. Re-onboarding required.',
                        );
                    }

                    if (accountAddress) {
                        await assertMetaMaskActiveAccount(provider, accountAddress);
                    }

                    logger.log('✅ AES key received from snap and passed round-trip validation');

                    globalAESKeyCache[accountAddress.toLowerCase()] = snapKey;
                    return snapKey;

                } catch (error: any) {
                    lastError = error;

                    if (error.message?.includes('No account connected') && retries > 1) {
                        logger.log(`⏳ Account not ready, retrying... (${retries - 1} attempts left)`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        retries--;
                    } else {
                        logger.error('❌ Error during Snap interaction:', error);
                        throw error;
                    }
                }
            }

            /* v8 ignore next -- unreachable: retry loop throws or returns before exiting while */
            throw lastError;
        } catch (error: any) {
            logger.error('❌ Failed to get AES key from snap:', error.message);

            if (error instanceof CotiPluginError) {
                throw error;
            }

            if (isSnapAccountNotReadyError(error)) {
                throw new CotiPluginError(
                    CotiErrorCode.AES_KEY_MISSING,
                    'COTI Snap has no AES key stored for this account',
                );
            }

            if (setSnapError) setSnapError(error.message || 'Failed to connect to Snap');
            return null;
        } finally {
            isSnapRequestPending.current = false;
        }
    }, [isSnapInstalled, setSnapError, snapId, resolveProvider, syncEnvironment]);

    /**
     * Save AES key to Snap (persist it for future sessions)
     */
    const saveAESKeyToSnap = useCallback(async (key: string, accountAddress: string = ''): Promise<boolean> => {
        const provider = await resolveProvider();
        if (!provider) return false;
        try {
            const COTI_MAINNET_ID = 2632500;
            const COTI_TESTNET_ID = 7082400;
            const rawChainIdHex = await provider.request({ method: 'eth_chainId' }) as string;
            const rawChainId = parseInt(rawChainIdHex, 16);
            const cotiChainId = rawChainId === COTI_MAINNET_ID ? COTI_MAINNET_ID : COTI_TESTNET_ID;

            logger.log('💾 Saving AES key to Snap...');
            await provider.request({
                method: 'wallet_invokeSnap',
                params: {
                    snapId,
                    request: {
                        method: 'set-aes-key',
                        params: { newUserAesKey: key, chainId: cotiChainId },
                    },
                },
            });
            logger.log('✅ AES key saved to Snap successfully');
            globalAESKeyCache[accountAddress.toLowerCase()] = key; // Update Cache
            if (setSnapError) setSnapError(null);
            return true;
        } catch (err: any) {
            logger.error('❌ Failed to save AES key to Snap:', err);
            return false;
        }
    }, [setSnapError, snapId, resolveProvider]);

    const resetError = useCallback(() => {
        if (setSnapError) setSnapError(null);
    }, [setSnapError]);

    /**
     * Clears the globally cached AES key.
     * This forces the next unlock request to go back to the Snap or Onboarding flow.
     */
    const clearSnapCache = useCallback(() => {
        logger.log('🧹 Clearing global AES key cache');
        globalAESKeyCache = {};
    }, []);

    // Helper to expose sync
    const connectAndSync = useCallback(async () => {
        const connected = await connectToSnap();
        if (connected) {
            await syncEnvironment();
        }
        return connected;
    }, [connectToSnap, syncEnvironment]);

    /**
     * Manually triggers the onboarding flow (Generate/Recover AES key via SDK).
     * Used when Snap is missing or user forces a key regeneration.
     * 
     * @returns {Promise<string | null>} The generated AES key if successful.
     */
    const handleManualOnboarding = useCallback(async (): Promise<string | null> => {
        try {
            logger.log("🚀 Starting manual onboarding flow...");
            const key = await onboardUser();

            /* v8 ignore next 9 -- onboardUser is a same-module stub that always throws in unit tests */
            if (key && key !== "PENDING") {
                logger.log("🔑 Key recovered from SDK:", key);
                await saveAESKeyToSnap(key);
                logger.log("✅ Onboarding flow finished.");
                return key;
            }
            /* v8 ignore next */
            return null;
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : 'Unknown error';
            logger.error('Manual onboarding failed:', e);
            if (setSnapError) setSnapError(`Onboarding failed: ${message}`);
            return null;
        }
    }, [saveAESKeyToSnap, setSnapError]);

    /**
     * Verifies that the key in the Snap matches the key generated by the SDK (Network).
     * Useful for debugging stale states.
     */
    const handleKeyVerification = useCallback(async (): Promise<void> => {
        try {
            logger.log("🔍 STARTING KEY VERIFICATION...");
            logger.log("1️⃣  Fetching AES Key from Snap Storage...");
            const snapKey = await getAESKeyFromSnap('');
            logger.log("   -> Snap Key length:", snapKey?.length);

            logger.log("2️⃣  Computing AES Key from Network (generateOrRecoverAes)...");
            logger.log("   (Please sign the message in MetaMask)");

            /* v8 ignore start -- onboardUser is a same-module stub; comparison UI requires live onboarding */
            const netKey = await onboardUser();
            logger.log("   -> Network Key length:", (netKey as string)?.length);

            logger.log("3️⃣  COMPARISON RESULT:");
            const match = snapKey === netKey;
            logger.log(`   MATCH: ${match ? "✅ YES" : "❌ NO"}`);

            if (!match) {
                logger.error('CRITICAL MISMATCH DETECTED!');
                logger.error('Snap key and Network key do NOT match. You MUST Force Onboard to fix this.');
                if (setSnapError) {
                    setSnapError('AES key mismatch: Snap and network keys do not match. Force onboard to fix.');
                }
            } else {
                logger.log('Keys match. Issues are likely elsewhere.');
                if (setSnapError) setSnapError(null);
            }
            /* v8 ignore stop */

        } catch (e: unknown) {
            logger.error('Key verification failed:', e);
            const message = e instanceof Error ? e.message : 'Key verification failed';
            if (setSnapError) setSnapError(`Verification failed: ${message}`);
            if (e instanceof CotiPluginError) throw e;
        }
    }, [getAESKeyFromSnap, setSnapError]);

    return {
        isSnapInstalled,
        executeSnapCheck,
        connectToSnap: connectAndSync,
        requestSnapConnection: connectToSnap, // explicit wallet_requestSnaps for "Connect Snap" button
        getAESKeyFromSnap,
        saveAESKeyToSnap,
        decryptCtUint64ViaSnap,
        decryptCtUint256ViaSnap,
        encryptUint256ViaSnap,
        buildItUint256ViaSnap,
        resetError,
        handleManualOnboarding,
        handleKeyVerification,
        clearSnapCache
    };
};

/**
 * Signs a 256-bit IT hash using the snap's raw ECDSA signing capability.
 * The snap derives the private key and signs without the Ethereum prefix,
 * which is required by the COTI MPC 256-bit precompile.
 *
 * @param msgHash - 32-byte hex hash to sign (keccak256 of packed message)
 * @returns 65-byte signature as Uint8Array, or null if user rejected
 */
export const signIT256ViaSnap = async (msgHash: string): Promise<Uint8Array | null> => {
    const currentSnapId = getPluginConfig().snapId;
    const provider = getMetaMaskProvider();
    if (!provider) throw new CotiPluginError(CotiErrorCode.NO_PROVIDER, 'No wallet provider found');

    const result = await provider.request({
        method: 'wallet_invokeSnap',
        params: {
            snapId: currentSnapId,
            request: {
                method: 'sign-it256',
                params: { msgHash }
            }
        }
    });

    if (!result) return null; // user rejected

    // Result is an array of numbers (from snap's Array.from(sigBytes))
    return new Uint8Array(result as number[]);
};

/**
 * Onboard user to Coti Network (generate/recover AES key via SDK)
 * This is required if the user has never onboarded or the network was reset.
 */
/**
 * Placeholder onboardUser function - directs users to the MetaMask onboarding page.
 * Actual onboarding happens at https://dev.metamask.coti.io/wallet
 */
export const onboardUser = async () => {
    throw new Error("Please visit https://dev.metamask.coti.io/wallet to complete onboarding");
};
