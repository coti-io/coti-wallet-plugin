
import { useEffect, useCallback } from 'react';
import { getPluginConfig } from '../config/plugin';



export const useNetworkEnforcer = (chainId: string | null, switchNetwork: (chainId: string) => Promise<boolean>) => {

    const envDefaultNetwork = getPluginConfig().defaultNetworkId;

    const enforceNetwork = useCallback(async () => {
        if (!envDefaultNetwork || !chainId) return;

        // Convert both to lower case strings for comparison
        // chainId from useMetamask is usually decimal string "7082400" or hex "0x..."
        // Let's normalize to BigInt -> Hex to be safe, assuming chainId is numeric string or hex
        let currentChainIdHex = "";
        try {
            currentChainIdHex = "0x" + BigInt(chainId).toString(16);
        } catch (e) {
            // If conversion fails, maybe it's already hex or invalid
            currentChainIdHex = chainId.startsWith("0x") ? chainId : "0x" + Number(chainId).toString(16);
        }

        const allowedChainIdHex = envDefaultNetwork.toLowerCase();

        // Check for mismatch (normalize casing)
        if (currentChainIdHex.toLowerCase() !== allowedChainIdHex) {
            console.warn(`[NetworkEnforcer] Detected wrong network: ${currentChainIdHex}. Enforcing: ${allowedChainIdHex}`);
            try {
                // Force switch
                const success = await switchNetwork(allowedChainIdHex);
                if (!success) {
                    console.error("[NetworkEnforcer] Failed to switch network automatically.");
                }
            } catch (err) {
                console.error("[NetworkEnforcer] Error during forced switch:", err);
            }
        }
    }, [chainId, envDefaultNetwork, switchNetwork]);

    useEffect(() => {
        // Automatic enforcement is disabled in favor of NetworkGuard UI
        // enforceNetwork();
    }, [enforceNetwork]);

    // Optional: Return status if needed for UI, but mostly runs in background
    return {};
};
