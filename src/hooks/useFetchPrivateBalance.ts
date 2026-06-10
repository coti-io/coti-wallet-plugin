import { useCallback } from 'react';
import { ethers } from 'ethers';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';
import { getPluginConfig } from '../config/plugin';
import { getRpcUrlForChainId } from '../config/chains';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from '../lib/logger';

export const useFetchPrivateBalance = () => {
    const fetchPrivateBalance = useCallback(async (
        userAddress: string,
        aesKey: string,
        currentChainIdOrAddress: number | string,
        isDirectAddress: boolean = false,
        decimals: number = 18,
        readChainId?: number | string
    ): Promise<string> => {
        logger.log(`🔍 fetchPrivateBalance CALLED for ${currentChainIdOrAddress} (Direct: ${isDirectAddress})`);

        if (!window.ethereum || !aesKey) {
            logger.log('❌ Missing ethereum or aesKey');
            return '0.00';
        }

        logger.log(`🔍 fetchPrivateBalance START for ${currentChainIdOrAddress} (isDirect=${isDirectAddress})`);

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            let contractAddress: string | undefined;

            if (isDirectAddress) {
                contractAddress = currentChainIdOrAddress as string;
            } else {
                return '0.00';
            }

            // GUARD: Check against Strict Network Enforcement
            // Skip guard when readChainId is explicitly provided (caller knows the target chain)
            const envDefaultNetwork = getPluginConfig().defaultNetworkId;
            if (envDefaultNetwork && !readChainId) {
                const networkChainId = Number((await provider.getNetwork()).chainId);
                if (networkChainId !== Number(envDefaultNetwork)) {
                    logger.warn(`[FetchPrivate] Skipping: Wrong Network`);
                    return '0.00';
                }
            }

            if (!contractAddress) return '0.00';

            if (isDirectAddress) {
                // Use a dedicated read provider when readChainId is specified,
                // otherwise fall back to the connected wallet's provider.
                const readProvider = readChainId
                    ? new ethers.JsonRpcProvider(getRpcUrlForChainId(Number(readChainId)), Number(readChainId))
                    : provider;
                const userAddr = userAddress;

                // PrivateERC20 (256-bit version) balanceOf(address) returns ctUint256:
                // struct ctUint256 { ctUint128 ciphertextHigh; ctUint128 ciphertextLow; }
                // where ctUint128 is `type ctUint128 is uint256` — so ABI is just two flat uint256s.
                // Also supports nested format: tuple(tuple(uint256,uint256),tuple(uint256,uint256))
                const nestedBalanceAbi = [
                    "function balanceOf(address) view returns (tuple(tuple(uint256 high,uint256 low) high,tuple(uint256 high,uint256 low) low))"
                ];
                const flatBalanceAbi = [
                    "function balanceOf(address) view returns (tuple(uint256 ciphertextHigh, uint256 ciphertextLow))"
                ];

                try {
                    let encryptedBalance: any;
                    try {
                        encryptedBalance = await new ethers.Contract(contractAddress, nestedBalanceAbi, readProvider).balanceOf(userAddr);
                    } catch {
                        encryptedBalance = await new ethers.Contract(contractAddress, flatBalanceAbi, readProvider).balanceOf(userAddr);
                    }

                    // SAFEGUARD: If ciphertext is empty/zero
                    if (!encryptedBalance) {
                        return '0.00';
                    }

                    // Collect all bigint values from the response (handles both nested and flat formats)
                    const collectBigints = (value: unknown): bigint[] => {
                        if (typeof value === 'bigint') return [value];
                        if (!value || typeof value !== 'object') return [];
                        const result: bigint[] = [];
                        const arrayValue = Array.from(value as ArrayLike<unknown>);
                        if (arrayValue.length > 0) {
                            for (const item of arrayValue) {
                                result.push(...collectBigints(item));
                            }
                            return result;
                        }
                        const record = value as Record<string, unknown>;
                        for (const key of ['high', 'low', 'ciphertextHigh', 'ciphertextLow']) {
                            if (key in record) result.push(...collectBigints(record[key]));
                        }
                        return result;
                    };

                    const words = collectBigints(encryptedBalance);

                    // All zeros means no balance
                    if (words.length > 0 && words.every(w => w === 0n)) {
                        logger.log('ℹ️ Encrypted Balance is 0/Uninitialized. Returning 0.00');
                        return '0.00';
                    }

                    let decryptedVal: bigint;

                    if (words.length >= 4) {
                        // Nested format: 4 uint64 segments (ctUint256 with nested ctUint128)
                        const [encHighHigh, encHighLow, encLowHigh, encLowLow] = words;
                        const highHigh = CotiSDK.decryptUint(encHighHigh, aesKey);
                        const highLow = CotiSDK.decryptUint(encHighLow, aesKey);
                        const lowHigh = CotiSDK.decryptUint(encLowHigh, aesKey);
                        const lowLow = CotiSDK.decryptUint(encLowLow, aesKey);
                        const high = (highHigh << 64n) + highLow;
                        const low = (lowHigh << 64n) + lowLow;
                        decryptedVal = (high << 128n) + low;
                    } else if (words.length >= 2) {
                        // Flat format: 2 uint128 segments (ciphertextHigh, ciphertextLow)
                        const [ciphertextHigh, ciphertextLow] = words;
                        if (ciphertextHigh === 0n && ciphertextLow === 0n) {
                            return '0.00';
                        }
                        decryptedVal = CotiSDK.decryptUint256({ ciphertextHigh, ciphertextLow }, aesKey);
                    } else {
                        logger.warn('⚠️ Unexpected ciphertext format');
                        return '0.00';
                    }

                    logger.log('💰 Total Decrypted Value:', decryptedVal);

                    // SAFEGUARD: allow very large real balances (rendered as M/B/T in UI),
                    // but still reject astronomically large values that are almost certainly bad decrypts.
                    const notationThreshold = BigInt("1000000000000") * BigInt(10) ** BigInt(decimals); // 1T tokens
                    const hardMismatchThreshold = BigInt("1000000000000000000000000000000") * BigInt(10) ** BigInt(decimals); // 1e30 tokens

                    if (decryptedVal > notationThreshold) {
                        logger.warn(`⚠️ Large private balance detected (${decryptedVal}). Showing value with notation in UI.`);
                    }

                    if (decryptedVal > hardMismatchThreshold) {
                        logger.warn(`⚠️ Decrypted value astronomically high (${decryptedVal}). Likely decryption garbage due to Key Mismatch.`);
                        throw new CotiPluginError(CotiErrorCode.AES_KEY_MISMATCH, 'AES key mismatch: Error decrypting. Re-onboarding required.');
                    }

                    return ethers.formatUnits(decryptedVal, decimals);
                } catch (e: any) {
                    // Try to get more info about the revert
                    logger.error(`❌ Failed to fetch/decrypt for ${contractAddress}`, {
                        error: e,
                        code: e.code,
                        revert: e.revert,
                        data: e.data,
                        reason: "Likely user not onboarded on-chain or key mismatch"
                    });

                    // RETHROW if it is our custom AES mismatch or non-onboarded error
                    if (e instanceof CotiPluginError) {
                        throw e;
                    }

                    return '0.00';
                }
            } else {
                // p.COTI (Native) - For now return 0 used by token card
                return '0.00';
            }

        } catch (error: any) {
            logger.error("Error fetching private balance:", error);
            if (error instanceof CotiPluginError) {
                throw error;
            }
            return '0.00';
        }
    }, []);

    return { fetchPrivateBalance };
};
