import { useCallback } from 'react';
import { ethers } from 'ethers';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';
import { getPluginConfig } from '../config/plugin';

export const useFetchPrivateBalance = () => {
    const fetchPrivateBalance = useCallback(async (
        userAddress: string,
        aesKey: string,
        currentChainIdOrAddress: number | string,
        isDirectAddress: boolean = false,
        decimals: number = 18
    ): Promise<string> => {
        console.log(`🔍 fetchPrivateBalance CALLED for ${currentChainIdOrAddress} (Direct: ${isDirectAddress})`);

        if (!window.ethereum || !aesKey) {
            console.log('❌ Missing ethereum or aesKey');
            return '0.00';
        }

        console.log(`🔍 fetchPrivateBalance START for ${currentChainIdOrAddress} (isDirect=${isDirectAddress})`);

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            let contractAddress: string | undefined;

            if (isDirectAddress) {
                contractAddress = currentChainIdOrAddress as string;
            } else {
                return '0.00';
            }

            // GUARD: Check against Strict Network Enforcement
            const envDefaultNetwork = getPluginConfig().defaultNetworkId;
            if (envDefaultNetwork) {
                // We need to check the current chain ID from the provider
                // Note: The hook takes currentChainIdOrAddress but that might be passed from stale state.
                // Best to check strict equality with provider or env.
                const network = await provider.getNetwork();
                if (Number(network.chainId) !== Number(envDefaultNetwork)) {
                    console.warn(`[FetchPrivate] Skipping: Wrong Network`);
                    return '0.00';
                }
            }

            if (!contractAddress) return '0.00';

            if (isDirectAddress) {
                // It's a token contract (p.WETH, p.USDT, etc.)
                // Use signer to ensure msg.sender is set correctly for getMyBalance
                const signer = await provider.getSigner();
                const userAddr = await signer.getAddress();

                // PrivateERC20 (256-bit version) balanceOf(address) returns ctUint256:
                // struct ctUint256 { ctUint128 ciphertextHigh; ctUint128 ciphertextLow; }
                // where ctUint128 is `type ctUint128 is uint256` — so ABI is just two flat uint256s.
                const contract = new ethers.Contract(contractAddress, [
                    "function balanceOf(address) view returns (tuple(uint256 ciphertextHigh, uint256 ciphertextLow))"
                ], signer);

                try {
                    const encryptedBalance = await contract.balanceOf(userAddr);

                    // SAFEGUARD: If ciphertext is empty/zero
                    if (!encryptedBalance) {
                        return '0.00';
                    }

                    const ciphertextHigh: bigint = encryptedBalance.ciphertextHigh;
                    const ciphertextLow: bigint = encryptedBalance.ciphertextLow;

                    // Zero ciphertext means the user simply has no balance on this token.
                    // This is normal for newly deployed contracts or tokens the user hasn't used yet.
                    if (ciphertextHigh === 0n && ciphertextLow === 0n) {
                        console.log('ℹ️ Encrypted Balance is 0/Uninitialized. Returning 0.00');
                        return '0.00';
                    }

                    console.log('🔐 Ciphertext found:', { ciphertextHigh, ciphertextLow });

                    // Use SDK's decryptUint256 which handles the two-half 256-bit AES ciphertext
                    const decryptedVal = CotiSDK.decryptUint256({ ciphertextHigh, ciphertextLow }, aesKey);
                    console.log('💰 Total Decrypted Value:', decryptedVal);

                    // SAFEGUARD: allow very large real balances (rendered as M/B/T in UI),
                    // but still reject astronomically large values that are almost certainly bad decrypts.
                    const notationThreshold = BigInt("1000000000000") * BigInt(10) ** BigInt(decimals); // 1T tokens
                    const hardMismatchThreshold = BigInt("1000000000000000000000000000000") * BigInt(10) ** BigInt(decimals); // 1e30 tokens

                    if (decryptedVal > notationThreshold) {
                        console.warn(`⚠️ Large private balance detected (${decryptedVal}). Showing value with notation in UI.`);
                    }

                    if (decryptedVal > hardMismatchThreshold) {
                        console.warn(`⚠️ Decrypted value astronomically high (${decryptedVal}). Likely decryption garbage due to Key Mismatch.`);
                        throw new Error(`AES key mismatch: Error decrypting. Re-onboarding required.`);
                    }

                    return ethers.formatUnits(decryptedVal, decimals);
                } catch (e: any) {
                    // Try to get more info about the revert
                    console.error(`❌ Failed to fetch/decrypt for ${contractAddress}`, {
                        error: e,
                        code: e.code,
                        revert: e.revert,
                        data: e.data,
                        reason: "Likely user not onboarded on-chain or key mismatch"
                    });

                    // RETHROW if it is our custom AES mismatch or non-onboarded error
                    if (e.message && (e.message.includes('AES key mismatch') || e.message.includes('ACCOUNT_NOT_ONBOARDED'))) {
                        throw e;
                    }

                    return '0.00';
                }
            } else {
                // p.COTI (Native) - For now return 0 used by token card
                return '0.00';
            }

        } catch (error: any) {
            console.error("Error fetching private balance:", error);
            if (error.message && (error.message.includes('AES key mismatch') || error.message.includes('onboarding') || error.message.includes('ACCOUNT_NOT_ONBOARDED'))) {
                throw error;
            }
            return '0.00';
        }
    }, []);

    return { fetchPrivateBalance };
};
