import { useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';
const { generateRSAKeyPair, decryptRSA } = CotiSDK;
import { MetaMaskInpageProvider } from '@metamask/providers';
import { getPluginConfig } from '../config/plugin';
import { getEthereumProvider } from '../lib/ethereum';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from '../lib/logger';

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

export const useSnap = (setSnapError?: (error: string | null) => void) => {
    const isSnapRequestPending = useRef(false);

    /**
     * Helper to get the MetaMask provider with types.
     * Handles the case where window.ethereum may be in a broken state
     * due to property redefinition conflicts between extensions.
     */
    const getProvider = (): MetaMaskInpageProvider | null => {
        try {
            if (typeof window.ethereum !== 'undefined') {
                return window.ethereum as unknown as MetaMaskInpageProvider;
            }
        } catch {
            // window.ethereum access can throw if property is in a broken state
            logger.warn('⚠️ window.ethereum access failed');
        }
        return null;
    };

    // Flag to check if environment is Flask
    const isFlask = useRef<boolean>(false);

    /**
     * Detects if the user is running MetaMask Flask.
     */
    const detectFlask = useCallback(async (): Promise<boolean> => {
        const provider = getProvider();
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
    }, []);

    /**
     * Checks if the Coti Snap is currently installed AND connected to this origin.
     * Only uses wallet_getSnaps — no dialogs, no side effects.
     * Returns false if snap is not visible (not installed OR not connected to this origin).
     * Also returns false for non-MetaMask wallets that don't support wallet_getSnaps.
     */
    const isSnapInstalled = useCallback(async (): Promise<boolean> => {
        const provider = getProvider();
        if (!provider) {
            logger.log('❌ isSnapInstalled: No window.ethereum');
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
    }, [snapId, detectFlask]);


    /**
     * Connect to COTI Snap (request permissions).
     * Returns false immediately for wallets that don't support snaps.
     */
    const connectToSnap = useCallback(async (): Promise<boolean> => {
        const provider = getProvider();
        if (!provider) {
            logger.log('❌ No window.ethereum available');
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
                if (setSnapError) setSnapError('Snap is only available with MetaMask.');
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
    }, [snapId, setSnapError]);


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
            logger.log('ℹ️ Snap NOT installed/detected. Setting info banner.');
            if (setSnapError) {
                // Customized message based on detection
                if (!isFlask.current) {
                    setSnapError('MetaMask Flask is required.');
                } else {
                    setSnapError('Coti Snap is not connected. Click to connect.');
                }
            }
        }
    }, [isSnapInstalled, setSnapError]);

    /**
     * Get AES key from COTI Snap.
     * Includes retry logic.
     */
    const getAESKeyFromSnap = useCallback(async (accountAddress: string): Promise<string | null> => {
        if (setSnapError) setSnapError(null);

        // Return cached key if available
        if (globalAESKeyCache[accountAddress.toLowerCase()]) {
            logger.log('🔑 Returning globally cached AES key');
            return globalAESKeyCache[accountAddress.toLowerCase()];
        }

        if (isSnapRequestPending.current) {
            logger.log('⏳ Snap request already pending, skipping concurrent call.');
            return null;
        }

        const provider = getProvider();
        if (!provider) {
            logger.log('❌ No window.ethereum available');
            return null;
        }

        // isSnapInstalled() uses only wallet_getSnaps (no dialogs).
        // If snap is not visible, show snap_missing modal immediately.
        const installed = await isSnapInstalled();
        if (!installed) {
            logger.log('❌ Snap not visible via wallet_getSnaps. Showing snap_missing modal.');
            throw new CotiPluginError(CotiErrorCode.SNAP_CONNECT_FAILED, 'COTI Snap is not installed or not connected to this origin');
        }

        // Snap is confirmed visible — call wallet_requestSnaps to ensure permission.
        // Since snap is already installed, this will NOT show an install dialog.
        const connected = await connectToSnap();
        if (!connected) {
            logger.log('❌ Could not connect to snap');
            if (setSnapError) setSnapError('Failed to connect to Snap');
            return null;
        }

        // Sync Environment explicitly before requesting key
        await syncEnvironment();

        // Add a small delay to ensure account is fully connected
        await new Promise(resolve => setTimeout(resolve, 500));

        try {
            isSnapRequestPending.current = true;
            logger.log('🔑 Requesting AES key from COTI Snap...');

            const COTI_MAINNET_ID = 2632500;
            const COTI_TESTNET_ID = 7082400;
            const rawChainIdHex = await provider.request({ method: 'eth_chainId' }) as string;
            const rawChainId = parseInt(rawChainIdHex, 16);
            const cotiChainId = rawChainId === COTI_MAINNET_ID ? COTI_MAINNET_ID : COTI_TESTNET_ID;

            const hasKey = await provider.request({
                method: 'wallet_invokeSnap',
                params: {
                    snapId,
                    request: {
                        method: 'has-aes-key',
                        params: { chainId: cotiChainId },
                    },
                },
            });

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

                    logger.log('✅ AES key received from snap');
                    
                    globalAESKeyCache[accountAddress.toLowerCase()] = key as string; // Update Cache
                    return key as string;

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

            // RETHROW if it's the specific missing key error so upstream can handle onboarding
            // Also rethrow SNAP_DIALOG_REJECTED so Index.tsx can show the AES Key Missing modal
            if (error instanceof CotiPluginError) {
                throw error;
            }

            if (setSnapError) setSnapError(error.message || 'Failed to connect to Snap');
            return null;
        } finally {
            isSnapRequestPending.current = false;
        }
    }, [connectToSnap, setSnapError, snapId]);

    /**
     * Save AES key to Snap (persist it for future sessions)
     */
    const saveAESKeyToSnap = useCallback(async (key: string, accountAddress: string = ''): Promise<boolean> => {
        const provider = getProvider();
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
    }, [setSnapError, snapId]);

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

    /**
     * Syncs the environment (testnet/mainnet) with the Snap.
     * This ensures the Snap uses the correct config for the current network.
     */
    const syncEnvironment = useCallback(async (): Promise<void> => {
        const provider = getProvider();
        if (!provider) return;

        try {
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
    }, [snapId]);

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
    const provider = getEthereumProvider();
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
