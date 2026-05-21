import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { decryptUint } from '@coti-io/coti-sdk-typescript';
import { CONTRACT_ADDRESSES, TOKEN_ABI } from '../contracts/config';

/**
 * Custom hook to interact with Private ERC20 tokens (fetch and decrypt balances).
 * 
 * Manages the decryption logic and handles errors related to AES key mismatches.
 * 
 * @returns {Object} An object containing:
 * - `fetchBalance`: Async function to retrieve and decrypt balance.
 * - `decryptionError`: Current error string if decryption failed (mismatch), or null.
 * - `setDecryptionError`: State setter for the error.
 */
export const usePrivateERC20 = () => {
    const [decryptionError, setDecryptionError] = useState<string | null>(null);

    /**
     * Fetches and decrypts the private balance for a given user and token.
     * 
     * @param userAddress - The user's wallet address.
     * @param aesKey - The AES key retrieved from the Snap.
     * @param currentChainIdOrAddress - The chain ID (to look up contract) or the direct token contract address.
     * @param isDirectAddress - Whether the third argument is a direct address (default: false).
     * @param decimals - The number of decimals for formatting (default: 18).
     * @returns The decrypted balance as a formatted string, or '0' on failure.
     */
    const fetchBalance = useCallback(async (
        userAddress: string,
        aesKey: string,
        currentChainIdOrAddress: number | string,
        isDirectAddress = false,
        decimals = 18
    ): Promise<string> => {
        if (!window.ethereum) {
            console.log('❌ No window.ethereum for balance fetch');
            return '0';
        }

        let tokenAddress = '';

        if (isDirectAddress) {
            tokenAddress = currentChainIdOrAddress as string;
        } else {
            const addresses = CONTRACT_ADDRESSES[currentChainIdOrAddress as number];
            if (!addresses) {
                console.warn('⚠️ No contract addresses for chain ID:', currentChainIdOrAddress);
                return '0';
            }
            tokenAddress = addresses.PrivateCoti;
        }

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const privateContract = new ethers.Contract(
                tokenAddress,
                TOKEN_ABI,
                provider
            );

            // Get encrypted balance using balanceOf(address) method
            const encryptedBalance = await privateContract['balanceOf(address)'](userAddress);

            if (encryptedBalance.toString() === '0') {
                setDecryptionError(null);
                return '0';
            }

            // Decrypt using AES key
            const decryptedBalance = decryptUint(encryptedBalance, aesKey);

            // Safety check: specific to COTI V2, encrypted values are uint64.
            // If decryption yields a value larger than uint64, it means decryption failed (wrong key).
            const MAX_UINT64 = BigInt("18446744073709551615");
            if (decryptedBalance > MAX_UINT64) {
                console.warn(`⚠️ Decrypted balance exceeds uint64 max. Defaulting to 0.`);
                setDecryptionError('Decryption Failed: Your wallet key does not match the on-chain data. Did you reset your wallet?');
                return '0';
            }

            setDecryptionError(null);

            // Convert to string with specified decimals
            return ethers.formatUnits(decryptedBalance, decimals);

        } catch (err) {
            console.error('❌ Error fetching/decrypting private balance:', err);
            // Don't set decryption error for generic network/contract errors, only for explicit mismatch logic above
            return '0';
        }
    }, []);

    return {
        fetchBalance,
        decryptionError,
        setDecryptionError
    };
};
