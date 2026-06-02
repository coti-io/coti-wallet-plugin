import { useCallback } from 'react';
import { ethers } from 'ethers';
import { decryptCtUint64, decryptCtUint256 } from '../crypto/decryption';
import { getPluginConfig } from '../config/plugin';
import { CotiPluginError, CotiErrorCode } from '../errors';

/**
 * ABI for the nested 4-part ciphertext format used by PoD pTokens (e.g., Sepolia p.MTT).
 * Returns: tuple(tuple(uint256 high, uint256 low) high, tuple(uint256 high, uint256 low) low)
 */
const NESTED_BALANCE_ABI = [
    "function balanceOf(address account) view returns (tuple(tuple(uint256 high, uint256 low) high, tuple(uint256 high, uint256 low) low))"
];

/**
 * ABI for the flat 2-part ciphertext format used by COTI native privacy tokens.
 * Returns: tuple(uint256 ciphertextHigh, uint256 ciphertextLow)
 */
const FLAT_BALANCE_ABI = [
    "function balanceOf(address) view returns (tuple(uint256 ciphertextHigh, uint256 ciphertextLow))"
];

/**
 * Checks if a nested ciphertext result is all zeros.
 */
function isZeroNestedCiphertext(result: any): boolean {
    if (!result) return true;
    const hh = result.high?.high ?? result[0]?.[0];
    const hl = result.high?.low ?? result[0]?.[1];
    const lh = result.low?.high ?? result[1]?.[0];
    const ll = result.low?.low ?? result[1]?.[1];
    return (
        (hh === 0n || hh === undefined) &&
        (hl === 0n || hl === undefined) &&
        (lh === 0n || lh === undefined) &&
        (ll === 0n || ll === undefined)
    );
}

/**
 * Normalizes a nested ciphertext result into the structure expected by decryptCtUint256.
 */
function normalizeNestedCiphertext(result: any): { high: { high: bigint; low: bigint }; low: { high: bigint; low: bigint } } {
    return {
        high: {
            high: BigInt(result.high?.high ?? result[0]?.[0] ?? 0n),
            low: BigInt(result.high?.low ?? result[0]?.[1] ?? 0n),
        },
        low: {
            high: BigInt(result.low?.high ?? result[1]?.[0] ?? 0n),
            low: BigInt(result.low?.low ?? result[1]?.[1] ?? 0n),
        },
    };
}

/**
 * Custom hook to fetch and decrypt balances for Confidential Tokens (both 64-bit and 256-bit).
 * 
 * Supports two on-chain ciphertext formats for 256-bit tokens:
 * - Nested 4-part (PoD pTokens): tuple(tuple(uint256 high, uint256 low) high, tuple(uint256 high, uint256 low) low)
 * - Flat 2-part (COTI native): tuple(uint256 ciphertextHigh, uint256 ciphertextLow)
 * 
 * The hook tries the nested format first, falling back to flat if the call reverts.
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
                    throw new CotiPluginError(CotiErrorCode.AES_KEY_MISMATCH, 'AES key mismatch: Error decrypting. Re-onboarding required.');
                 }
                 return ethers.formatUnits(decryptedVal, decimals);
            } else {
                 // 256-bit: Try nested 4-part ABI first (PoD pTokens), fall back to flat 2-part
                 let encryptedBalance: any;
                 let isNested = false;

                 try {
                     const nestedContract = new ethers.Contract(contractAddress, NESTED_BALANCE_ABI, signer);
                     encryptedBalance = await nestedContract.balanceOf(userAddress);

                     // Validate that we got a nested structure (has .high.high or [0][0])
                     const hasNestedShape = (
                         (encryptedBalance?.high?.high !== undefined && encryptedBalance?.high?.low !== undefined) ||
                         (encryptedBalance?.[0]?.[0] !== undefined && encryptedBalance?.[0]?.[1] !== undefined)
                     );

                     if (hasNestedShape) {
                         isNested = true;
                     } else {
                         // Response doesn't match nested shape — try flat ABI
                         throw new Error('Not nested format');
                     }
                 } catch {
                     // Nested ABI failed or didn't match — try flat 2-part ABI
                     const flatContract = new ethers.Contract(contractAddress, FLAT_BALANCE_ABI, signer);
                     encryptedBalance = await flatContract.balanceOf(userAddress);
                     isNested = false;
                 }

                 if (!encryptedBalance) return '0.00';

                 if (isNested) {
                     // Nested 4-part format: { high: { high, low }, low: { high, low } }
                     if (isZeroNestedCiphertext(encryptedBalance)) return '0.00';

                     const normalized = normalizeNestedCiphertext(encryptedBalance);
                     const decryptedVal = decryptCtUint256(normalized, aesKey, { decimals });
                     if (decryptedVal === null) {
                         throw new CotiPluginError(CotiErrorCode.AES_KEY_MISMATCH, 'AES key mismatch: Error decrypting. Re-onboarding required.');
                     }
                     return ethers.formatUnits(decryptedVal, decimals);
                 } else {
                     // Flat 2-part format: { ciphertextHigh, ciphertextLow }
                     if (encryptedBalance.ciphertextHigh === 0n && encryptedBalance.ciphertextLow === 0n) return '0.00';

                     const decryptedVal = decryptCtUint256(encryptedBalance, aesKey, { decimals });
                     if (decryptedVal === null) {
                         throw new CotiPluginError(CotiErrorCode.AES_KEY_MISMATCH, 'AES key mismatch: Error decrypting. Re-onboarding required.');
                     }
                     return ethers.formatUnits(decryptedVal, decimals);
                 }
            }
        } catch (error: any) {
            // Rethrow specific AES mismatch or Onboarding errors
            if (error instanceof CotiPluginError || (error.message && (error.message.includes('AES key mismatch') || error.message.includes('ACCOUNT_NOT_ONBOARDED')))) {
                throw error;
            }
            console.error(`❌ Failed to fetch/decrypt for ${contractAddress}`, error);
            return '0.00';
        }
    }, []);

    return { fetchPrivateBalance };
};
