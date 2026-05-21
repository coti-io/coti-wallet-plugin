import { useCallback } from 'react';
import { ethers } from 'ethers';
import { decryptCtUint64, decryptCtUint256 } from '../crypto/decryption';
import { getPluginConfig } from '../config/plugin';

/**
 * Custom hook to fetch and decrypt balances for Confidential Tokens (both 64-bit and 256-bit).
 * 
 * Replaces usePrivateERC20 and useFetchPrivateBalance with a unified interface.
 */
export const usePrivateTokenBalance = () => {
    const fetchPrivateBalance = useCallback(async (
        userAddress: string,
        aesKey: string,
        contractAddress: string,
        version: 64 | 256,
        decimals: number = 18
    ): Promise<string> => {
        if (!window.ethereum || !aesKey || !contractAddress) {
            return '0.00';
        }

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            
            // Optional strict network check
            const envDefaultNetwork = getPluginConfig().defaultNetworkId;
            if (envDefaultNetwork) {
                const network = await provider.getNetwork();
                if (Number(network.chainId) !== Number(envDefaultNetwork)) {
                    console.warn(`[FetchPrivate] Skipping: Wrong Network`);
                    return '0.00';
                }
            }

            // Using signer so proxy contracts (msg.sender) route correctly
            const signer = await provider.getSigner();

            if (version === 64) {
                 // 64-bit Native token legacy ABI return
                 const contract = new ethers.Contract(contractAddress, [
                     "function balanceOf(address) view returns (uint256)"
                 ], signer);

                 const encryptedBalance = await contract['balanceOf(address)'](userAddress);
                 
                 if (!encryptedBalance || encryptedBalance.toString() === '0') return '0.00';

                 const decryptedVal = decryptCtUint64(encryptedBalance, aesKey, { decimals });
                 if (decryptedVal === null) {
                    throw new Error(`AES key mismatch: Error decrypting. Re-onboarding required.`);
                 }
                 return ethers.formatUnits(decryptedVal, decimals);
            } else {
                 // 256-bit ConfErc20 tuple return
                 const contract = new ethers.Contract(contractAddress, [
                    "function balanceOf(address) view returns (tuple(uint256 ciphertextHigh, uint256 ciphertextLow))"
                 ], signer);
                 
                 const encryptedBalance = await contract.balanceOf(userAddress);

                 // Zero ciphertext check
                 if (!encryptedBalance) return '0.00';
                 if (encryptedBalance.ciphertextHigh === 0n && encryptedBalance.ciphertextLow === 0n) return '0.00';

                 // decryptCtUint256 handles the flat {ciphertextHigh, ciphertextLow} structure natively
                 const decryptedVal = decryptCtUint256(encryptedBalance, aesKey, { decimals });
                 if (decryptedVal === null) {
                    throw new Error(`AES key mismatch: Error decrypting. Re-onboarding required.`);
                 }
                 return ethers.formatUnits(decryptedVal, decimals);
            }
        } catch (error: any) {
            // Rethrow specific AES mismatch or Onboarding errors
            if (error.message && (error.message.includes('AES key mismatch') || error.message.includes('ACCOUNT_NOT_ONBOARDED'))) {
                throw error;
            }
            console.error(`❌ Failed to fetch/decrypt for ${contractAddress}`, error);
            return '0.00';
        }
    }, []);

    return { fetchPrivateBalance };
};
