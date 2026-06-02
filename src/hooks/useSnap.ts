import { useCallback, useRef } from 'react';
import { ethers } from 'ethers';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';
const { generateRSAKeyPair, decryptRSA } = CotiSDK;
import { MetaMaskInpageProvider } from '@metamask/providers';
import { getPluginConfig } from '../config/plugin';
import { getEthereumProvider } from '../lib/ethereum';

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
            console.warn('⚠️ window.ethereum access failed');
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
        if (!provider) return false;
        try {
            const clientVersion = await provider.request({ method: 'web3_clientVersion' });
            const isFlaskDetected = (clientVersion as string).includes('flask');
            console.log(`🦊 Client Version: ${clientVersion} (Flask: ${isFlaskDetected})`);
            isFlask.current = isFlaskDetected;
            return isFlaskDetected;
        } catch (e) {
            console.warn('⚠️ Failed to check client version', e);
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
            console.log('❌ isSnapInstalled: No window.ethereum');
            return false;
        }

        try {
            await detectFlask();

            console.log('🕵️‍♀️ requesting wallet_getSnaps...');
            const snaps = (await provider.request({ method: 'wallet_getSnaps' })) as Record<string, any>;
            console.log('🕵️‍♀️ wallet_getSnaps result:', JSON.stringify(snaps, null, 2));

            const snapInfo = Object.values(snaps).find(
                (snap: any) => snap.id === snapId
            ) || (snapId in snaps);

            if (snapInfo) {
                console.log(`✅ Snap found and connected: ${snapId}`);
                return true;
            }

            // Snap not visible — either not installed or installed but not connected to this origin.
            // We cannot distinguish without showing a MetaMask dialog.
            // Return false and let the UI guide the user.
            console.log(`ℹ️ Snap ${snapId} not visible via wallet_getSnaps.`);
            return false;
        } catch (error: any) {
            // -32601 means the wallet doesn't support wallet_getSnaps (Rabby, Trust, etc.)
            if (error?.code === -32601) {
                console.log('ℹ️ Wallet does not support wallet_getSnaps (non-MetaMask wallet). Snap unavailable.');
                return false;
            }
            console.error('❌ Error checking snap connection:', error);
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
            console.log('❌ No window.ethereum available');
            return false;
        }

        try {
            console.log('🔌 Requesting permission to connect to COTI Snap...');
            await provider.request({
                method: 'wallet_requestSnaps',
                params: {
                    [snapId]: {}
                }
            });
            console.log('✅ Connected to COTI Snap');
            if (setSnapError) setSnapError(null);
            return true;
        } catch (error: any) {
            // Non-MetaMask wallets don't support wallet_requestSnaps
            if (error?.code === -32601) {
                console.log('ℹ️ Wallet does not support wallet_requestSnaps (non-MetaMask wallet).');
                if (setSnapError) setSnapError('Snap is only available with MetaMask.');
                return false;
            }
            console.error('❌ Failed to connect to snap:', error.message);
            if (setSnapError) {
                if (!isFlask.current) {
                    setSnapError('MetaMask Flask is required for this Snap.');
                } else {
                    setSnapError('Failed to connect to Snap');
                }
            }
            // Propagate error for context handling
            throw new Error("SNAP_CONNECT_FAILED");
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
            console.log('✅ Snap is installed. Attempting to retrieve key...');
            const success = await onSnapFound();
            if (!success) {
                console.log('⚠️ Snap installed but key retrieval failed/cancelled. Banner handles error.');
            }
        } else {
            console.log('ℹ️ Snap NOT installed/detected. Setting info banner.');
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
            console.log('🔑 Returning globally cached AES key');
            return globalAESKeyCache[accountAddress.toLowerCase()];
        }

        if (isSnapRequestPending.current) {
            console.log('⏳ Snap request already pending, skipping concurrent call.');
            return null;
        }

        const provider = getProvider();
        if (!provider) {
            console.log('❌ No window.ethereum available');
            return null;
        }

        // isSnapInstalled() uses only wallet_getSnaps (no dialogs).
        // If snap is not visible, show snap_missing modal immediately.
        const installed = await isSnapInstalled();
        if (!installed) {
            console.log('❌ Snap not visible via wallet_getSnaps. Showing snap_missing modal.');
            throw new Error("SNAP_CONNECT_FAILED");
        }

        // Snap is confirmed visible — call wallet_requestSnaps to ensure permission.
        // Since snap is already installed, this will NOT show an install dialog.
        const connected = await connectToSnap();
        if (!connected) {
            console.log('❌ Could not connect to snap');
            if (setSnapError) setSnapError('Failed to connect to Snap');
            return null;
        }

        // Sync Environment explicitly before requesting key
        await syncEnvironment();

        // Add a small delay to ensure account is fully connected
        await new Promise(resolve => setTimeout(resolve, 500));

        try {
            isSnapRequestPending.current = true;
            console.log('🔑 Requesting AES key from COTI Snap...');

            // Fetch ChainID for explicit context
            const chainIdHex = await provider.request({ method: 'eth_chainId' }) as string;
            const chainId = parseInt(chainIdHex, 16);

            // Retry logic for robustness
            let retries = 3;
            let lastError;

            while (retries > 0) {
                try {
                    // Resolve to the correct COTI chainId regardless of which chain
                    // the wallet is currently connected to.
                    // Sepolia (and other non-COTI chains) → COTI testnet (7082400)
                    // COTI mainnet (2632500) → COTI mainnet
                    const COTI_MAINNET_ID = 2632500;
                    const COTI_TESTNET_ID = 7082400;
                    const rawChainIdHex = await provider.request({ method: 'eth_chainId' }) as string;
                    const rawChainId = parseInt(rawChainIdHex, 16);
                    const cotiChainId = rawChainId === COTI_MAINNET_ID ? COTI_MAINNET_ID : COTI_TESTNET_ID;

                    console.log(`🔑 Requesting AES key for COTI chainId: ${cotiChainId} (wallet chainId: ${rawChainId})`);

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

                    console.log('🔍 wallet_invokeSnap: key received, length:', (key as string)?.length);

                    if (!key) {
                        console.warn('⚠️ Snap returned null (User likely rejected).');
                        // Throw specific error so we don't trigger "Missing Key" onboarding flow
                        throw new Error('SNAP_DIALOG_REJECTED');
                    }

                    console.log('✅ AES key received from snap');
                    
                    globalAESKeyCache[accountAddress.toLowerCase()] = key as string; // Update Cache
                    return key as string;

                } catch (error: any) {
                    lastError = error;

                    if (error.message?.includes('No account connected') && retries > 1) {
                        console.log(`⏳ Account not ready, retrying... (${retries - 1} attempts left)`);
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        retries--;
                    } else {
                        console.error('❌ Error during Snap interaction:', error);
                        throw error;
                    }
                }
            }

            throw lastError;
        } catch (error: any) {
            console.error('❌ Failed to get AES key from snap:', error.message);

            // RETHROW if it's the specific missing key error so upstream can handle onboarding
            // Also rethrow SNAP_DIALOG_REJECTED so Index.tsx can show the AES Key Missing modal
            if (error.message && (error.message.includes('AES key') || error.message.includes('onboarding') || error.message.includes('SNAP_DIALOG_REJECTED') || error.message.includes('SNAP_CONNECT_FAILED'))) {
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
            console.log('💾 Saving AES key to Snap...');
            await provider.request({
                method: 'wallet_invokeSnap',
                params: {
                    snapId,
                    request: {
                        method: 'set-aes-key',
                        params: { newUserAesKey: key }
                    }
                }
            });
            console.log('✅ AES key saved to Snap successfully');
            globalAESKeyCache[accountAddress.toLowerCase()] = key; // Update Cache
            if (setSnapError) setSnapError(null);
            return true;
        } catch (err: any) {
            console.error('❌ Failed to save AES key to Snap:', err);
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
        console.log('🧹 Clearing global AES key cache');
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

            console.log(`🌍 Syncing Snap Environment to: ${environment} (requested ChainID: ${chainId} → COTI ChainID: ${cotiChainId})`);

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
            console.log('✅ Snap Environment Synced');
        } catch (error) {
            console.warn('⚠️ Failed to sync Snap environment:', error);
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
            console.log("🚀 Starting manual onboarding flow...");
            const key = await onboardUser();

            if (key && key !== "PENDING") {
                console.log("🔑 Key recovered from SDK:", key);
                // Persist to Snap immediately
                await saveAESKeyToSnap(key);

                console.log("✅ Onboarding flow finished.");

                return key;
            }
            return null;
        } catch (e: any) {
            console.error("❌ Manual Onboarding failed:", e);
            alert(`Onboarding Failed: ${e.message}`);
            if (setSnapError) setSnapError(`Onboarding Failed: ${e.message}`);
            return null;
        }
    }, [saveAESKeyToSnap, setSnapError]);

    /**
     * Verifies that the key in the Snap matches the key generated by the SDK (Network).
     * Useful for debugging stale states.
     */
    const handleKeyVerification = useCallback(async (): Promise<void> => {
        try {
            console.log("🔍 STARTING KEY VERIFICATION...");
            console.log("1️⃣  Fetching AES Key from Snap Storage...");
            const snapKey = await getAESKeyFromSnap('');
            console.log("   -> Snap Key length:", snapKey?.length);

            console.log("2️⃣  Computing AES Key from Network (generateOrRecoverAes)...");
            console.log("   (Please sign the message in MetaMask)");

            const netKey = await onboardUser();
            console.log("   -> Network Key length:", (netKey as string)?.length);

            console.log("3️⃣  COMPARISON RESULT:");
            const match = snapKey === netKey;
            console.log(`   MATCH: ${match ? "✅ YES" : "❌ NO"}`);

            if (!match) {
                console.error("CRITICAL MISMATCH DETECTED!");
                console.error("Snap key and Network key do NOT match. You MUST Force Onboard to fix this.");
                alert(`MISMATCH DETECTED!\n\nKeys do NOT match. You must Force Onboard.`);
            } else {
                console.log("✅ Keys match. Issues are likely elsewhere.");
                alert(`✅ MATCH!\n\nBoth Snap and Network agree.`);
            }

        } catch (e: any) {
            console.error("❌ Key Verification Failed:", e);
            alert(`Verification Failed: ${e.message}`);
        }
    }, [getAESKeyFromSnap]);

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
    if (!provider) throw new Error('No wallet found');

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
