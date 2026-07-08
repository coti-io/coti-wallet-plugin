import { useCallback } from 'react';
import { ethers } from 'ethers';
import { decryptCtUint64, decryptCtUint256 } from '../crypto/decryption';
import { withRpcFallback } from '../lib/rpcProvider';
import { getPluginConfig } from '../config/plugin';
import { CotiPluginError, CotiErrorCode } from '../errors';
import { logger } from '../lib/logger';
import type { CtUint256 } from '../types/ciphertext';
import { isZeroCtUint256 } from '../types/ciphertext';

export interface PrivateBalanceDecryptOptions {
    decryptCtUint64?: (value: bigint | string | number, chainId?: number | string, accountAddress?: string) => Promise<bigint | null>;
    decryptCtUint256?: (value: CtUint256, chainId?: number | string, accountAddress?: string) => Promise<bigint | null>;
}

/** Native PoD pTokens (p.ETH, p.AVAX): plain uint256 on-chain. */
const PLAIN_BALANCE_ABI = [
    "function balanceOf(address account) view returns (uint256)",
];

/** PoD and COTI private ERC-20 balances: flat ctUint256 (ciphertextHigh, ciphertextLow). */
const FLAT_BALANCE_ABI = [
    "function balanceOf(address) view returns (tuple(uint256 ciphertextHigh, uint256 ciphertextLow))",
];

/**
 * Fetches and decrypts confidential token balances.
 *
 * Encrypted 256-bit balances always use flat ctUint256. Native PoD pTokens
 * (p.ETH, p.AVAX) expose a plain uint256 via {@link isPlainBalance}.
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
        decryptOptions?: PrivateBalanceDecryptOptions,
    ): Promise<string> => {
        if (!contractAddress) {
            return '0.00';
        }
        const canUseSnapDecrypt = !!decryptOptions?.decryptCtUint64 || !!decryptOptions?.decryptCtUint256;
        if (!isPlainBalance && !aesKey && !canUseSnapDecrypt) {
            return '0.00';
        }
        if (_readChainId == null && !window.ethereum) {
            return '0.00';
        }

        try {
            const useRpcRead = _readChainId != null;

            const readBalance = async (runner: ethers.ContractRunner): Promise<string> => {
                if (isPlainBalance) {
                    const plainContract = new ethers.Contract(contractAddress, PLAIN_BALANCE_ABI, runner);
                    const balance = await plainContract.balanceOf(userAddress);
                    return ethers.formatUnits(balance, decimals);
                }

                if (version === 64) {
                    const contract = new ethers.Contract(contractAddress, [
                        "function balanceOf(address) view returns (uint256)",
                    ], runner);
                    const encryptedBalance = await contract['balanceOf(address)'](userAddress);

                    if (!encryptedBalance || encryptedBalance.toString() === '0') return '0.00';

                    const decryptedVal = aesKey
                        ? decryptCtUint64(encryptedBalance, aesKey, { decimals })
                        : await decryptOptions?.decryptCtUint64?.(encryptedBalance, _readChainId, userAddress) ?? null;
                    if (decryptedVal === null) {
                        throw new CotiPluginError(CotiErrorCode.AES_KEY_MISMATCH, 'AES key mismatch: Error decrypting. Re-onboarding required.');
                    }
                    return ethers.formatUnits(decryptedVal, decimals);
                }

                const flatContract = new ethers.Contract(contractAddress, FLAT_BALANCE_ABI, runner);
                const encryptedBalance = await flatContract.balanceOf(userAddress);
                if (!encryptedBalance) return '0.00';

                const high = encryptedBalance.ciphertextHigh ?? encryptedBalance[0] ?? 0n;
                const low = encryptedBalance.ciphertextLow ?? encryptedBalance[1] ?? 0n;
                const flatBalance = { ciphertextHigh: high, ciphertextLow: low };
                if (isZeroCtUint256(flatBalance)) return '0.00';

                const decryptedVal = aesKey
                    ? decryptCtUint256(flatBalance, aesKey, { decimals })
                    : await decryptOptions?.decryptCtUint256?.(flatBalance, _readChainId, userAddress) ?? null;
                if (decryptedVal === null) {
                    throw new CotiPluginError(CotiErrorCode.AES_KEY_MISMATCH, 'AES key mismatch: Error decrypting. Re-onboarding required.');
                }
                return ethers.formatUnits(decryptedVal, decimals);
            };

            if (useRpcRead) {
                return await withRpcFallback(_readChainId, readBalance);
            }

            const runner = await (async () => {
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

            return await readBalance(runner);
        } catch (error: unknown) {
            if (error instanceof CotiPluginError) {
                throw error;
            }
            logger.error(`❌ Failed to fetch/decrypt for ${contractAddress}`, error);
            return '0.00';
        }
    }, []);

    return { fetchPrivateBalance };
};
