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

/** Native PoD pTokens whose balanceOf returns a plain uint256 (legacy deployments). */
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
 * (p.ETH, p.AVAX) are requested via {@link isPlainBalance}, but the actual
 * on-chain shape is detected from the return data: current deployments store
 * encrypted ctUint256 (64 bytes) while legacy ones stored plain uint256 (32 bytes).
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
                const decryptFlatCt256 = async (high: bigint, low: bigint): Promise<string> => {
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

                if (isPlainBalance) {
                    // Native pTokens are configured as plain, but current PoD deployments
                    // actually store encrypted ctUint256. Read the raw return data and pick
                    // the decode path from its shape: 32 bytes = plain uint256, 64 bytes =
                    // ctUint256 (ciphertextHigh, ciphertextLow).
                    const iface = new ethers.Interface(PLAIN_BALANCE_ABI);
                    const rawReturn = await runner.provider!.call({
                        to: contractAddress,
                        data: iface.encodeFunctionData('balanceOf', [userAddress]),
                    });
                    const returnByteLength = (rawReturn.length - 2) / 2;

                    if (returnByteLength > 32) {
                        logger.log('[fetchPrivateBalance] plain-configured token returned ctUint256 — decrypting', { contractAddress, returnByteLength });
                        if (!aesKey && !decryptOptions?.decryptCtUint256) return '0.00';
                        const [high, low] = ethers.AbiCoder.defaultAbiCoder().decode(['uint256', 'uint256'], rawReturn);
                        return decryptFlatCt256(high, low);
                    }

                    const [balance] = iface.decodeFunctionResult('balanceOf', rawReturn);
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
                return decryptFlatCt256(high, low);
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
                // Balance reads are view calls only — use the provider directly.
                // getSigner() would invoke eth_accounts/eth_requestAccounts, which
                // pops up unconnected wallet extensions when several are installed.
                return browserProvider;
            })();

            if (!runner) {
                return '0.00';
            }

            return await readBalance(runner);
        } catch (error: unknown) {
            if (error instanceof CotiPluginError) {
                throw error;
            }

            const message = error instanceof Error
                ? error.message
                : String((error as { message?: unknown } | null)?.message ?? error ?? '');
            const code = (error as { code?: number | string } | null)?.code;
            // Snap untyped decrypt throws this when the payload/key is missing or malformed.
            // Returning "0.00" would falsely mark unlock as successful with zero balances.
            const isDecryptPayloadFailure =
                message.includes('Invalid encrypted payload')
                || (code === -32603 && /encrypt|decrypt|ciphertext/i.test(message));

            if (isDecryptPayloadFailure || canUseSnapDecrypt) {
                logger.error(`❌ Failed to decrypt private balance for ${contractAddress}`, error);
                throw new CotiPluginError(
                    CotiErrorCode.AES_KEY_MISMATCH,
                    isDecryptPayloadFailure
                        ? 'Could not decrypt private balances. The Snap AES key may be missing or invalid — re-onboarding is required.'
                        : 'Could not decrypt private balances via Snap. Re-onboarding may be required.',
                    message,
                );
            }

            logger.error(`❌ Failed to fetch/decrypt for ${contractAddress}`, error);
            return '0.00';
        }
    }, []);

    return { fetchPrivateBalance };
};
