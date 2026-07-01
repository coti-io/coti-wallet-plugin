import { useCallback } from 'react';
import { ethers } from 'ethers';
import { decryptCtUint64, decryptCtUint256 } from '../crypto/decryption';
import { getRpcUrlForChainId } from '../config/chains';
import { getPluginConfig } from '../config/plugin';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from '../lib/logger';
import { isZeroCtUint256 } from '../types/ciphertext';

/**
 * ABI for native PoD pTokens (p.ETH, p.AVAX): balance is a plain uint256 on-chain.
 */
const PLAIN_BALANCE_ABI = [
    "function balanceOf(address account) view returns (uint256)",
];

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
        decimals: number = 18,
        _readChainId?: number,
        isPlainBalance: boolean = false,
    ): Promise<string> => {
        if (!contractAddress) {
            return '0.00';
        }
        if (!isPlainBalance && !aesKey) {
            return '0.00';
        }
        if (_readChainId == null && !window.ethereum) {
            return '0.00';
        }

        try {
            const useRpcRead = _readChainId != null;
            const runner = useRpcRead
                ? new ethers.JsonRpcProvider(getRpcUrlForChainId(_readChainId), _readChainId)
                : await (async () => {
                    const browserProvider = new ethers.BrowserProvider(window.ethereum!);
                    const envDefaultNetwork = getPluginConfig().defaultNetworkId;
                    if (envDefaultNetwork) {
                        const network = await browserProvider.getNetwork();
                        if (Number(network.chainId) !== Number(envDefaultNetwork)) {
                            logger.warn(`[FetchPrivate] Skipping: Wrong Network`);
                            return null;
                        }
                    }
                    return browserProvider.getSigner();
                })();

            if (!runner) {
                return '0.00';
            }

            if (isPlainBalance) {
                const plainContract = new ethers.Contract(contractAddress, PLAIN_BALANCE_ABI, runner);
                const balance = await plainContract.balanceOf(userAddress);
                return ethers.formatUnits(balance, decimals);
            }

            if (version === 64) {
                 // 64-bit Native token legacy ABI return
                 const contract = new ethers.Contract(contractAddress, [
                     "function balanceOf(address) view returns (uint256)"
                 ], runner);

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
                     const nestedContract = new ethers.Contract(contractAddress, NESTED_BALANCE_ABI, runner);
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
                     const flatContract = new ethers.Contract(contractAddress, FLAT_BALANCE_ABI, runner);
                     encryptedBalance = await flatContract.balanceOf(userAddress);
                     isNested = false;
                 }

                 if (!encryptedBalance) return '0.00';

                 if (isNested) {
                     if (isZeroCtUint256(encryptedBalance)) return '0.00';

                     const decryptedVal = decryptCtUint256(encryptedBalance, aesKey, { decimals });
                     if (decryptedVal === null) {
                         throw new CotiPluginError(CotiErrorCode.AES_KEY_MISMATCH, 'AES key mismatch: Error decrypting. Re-onboarding required.');
                     }
                     return ethers.formatUnits(decryptedVal, decimals);
                 } else {
                     const high = encryptedBalance.ciphertextHigh ?? encryptedBalance[0] ?? 0n;
                     const low = encryptedBalance.ciphertextLow ?? encryptedBalance[1] ?? 0n;
                     const flatBalance = { ciphertextHigh: high, ciphertextLow: low };
                     if (isZeroCtUint256(flatBalance)) return '0.00';

                     const decryptedVal = decryptCtUint256(flatBalance, aesKey, { decimals });
                     if (decryptedVal === null) {
                         throw new CotiPluginError(CotiErrorCode.AES_KEY_MISMATCH, 'AES key mismatch: Error decrypting. Re-onboarding required.');
                     }
                     return ethers.formatUnits(decryptedVal, decimals);
                 }
            }
        } catch (error: any) {
            // Rethrow specific AES mismatch or Onboarding errors
            if (error instanceof CotiPluginError) {
                throw error;
            }
            logger.error(`❌ Failed to fetch/decrypt for ${contractAddress}`, error);
            return '0.00';
        }
    }, []);

    return { fetchPrivateBalance };
};
