import { useState, useCallback, useEffect } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, ERC20_ABI } from '../../contracts/config';
import type { PodWithdrawPermit } from '../../chains/portal/executePodPortalTransaction';
import { signPodWithdrawPermit } from '../../chains/portal/executePodPortalTransaction';
import { getPrivateTokensForChain, getPublicTokensForChain } from '../../chains';
import { logger } from '../../lib/logger';
import { encryptValue256 } from './encryptValue256';
import { shortHash } from './utils';
import type { Token, ToastState } from './types';

export interface UsePrivacyBridgeAllowanceOptions {
  isConnected: boolean;
  walletAddress: string;
  publicTokens: Token[];
  amount: string;
  direction: 'to-private' | 'to-public';
  selectedTokenIndex: number;
  hasSnap: boolean;
  getAESKeyFromSnap: (accountAddress: string) => Promise<string | null>;
  setToastState: React.Dispatch<React.SetStateAction<ToastState>>;
}

/** ERC20 / encrypted private token allowance checks and approvals. */
export const usePrivacyBridgeAllowance = ({
  isConnected,
  walletAddress,
  publicTokens,
  amount,
  direction,
  selectedTokenIndex,
  hasSnap,
  getAESKeyFromSnap,
  setToastState,
}: UsePrivacyBridgeAllowanceOptions) => {
  const [allowance, setAllowance] = useState<string>('0');
  const [isApproving, setIsApproving] = useState(false);
  const [podWithdrawPermit, setPodWithdrawPermit] = useState<PodWithdrawPermit | null>(null);

    const checkAllowance = useCallback(async () => {
        if (!isConnected || !window.ethereum || !walletAddress) return;

        const token = publicTokens[selectedTokenIndex];

        // Native COTI doesn't need allowance for deposit (to-private).
        // For withdrawal (to-public), PrivateCoti still requires an encrypted approval.
        if (token?.symbol === 'COTI' && direction === 'to-private') {
            setAllowance('999999999999999999');
            return;
        }
        if (token?.symbol === 'MTT' && direction === 'to-public') {
            setAllowance('999999999999999999');
            return;
        }

        // Reset to 0 to prevent stale state from previous token
        setAllowance('0');

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const network = await provider.getNetwork();
            const currentChainId = Number(network.chainId);
            const addresses = CONTRACT_ADDRESSES[currentChainId];

            let tokenAddress: string | undefined;
            let bridgeAddress: string | undefined;
            let decimals = 18;

            const pubCfg = getPublicTokensForChain(currentChainId).find(
                t => t.symbol === token.symbol && !t.isPrivate
            );
            if (pubCfg?.bridgeAddressKey && addresses) {
                bridgeAddress = addresses[pubCfg.bridgeAddressKey as keyof typeof addresses];
            }
            if (pubCfg?.addressKey && addresses) {
                tokenAddress = addresses[pubCfg.addressKey as keyof typeof addresses];
            }
            if (pubCfg) {
                decimals = pubCfg.decimals;
            }

            if (!bridgeAddress) {
            if (token.symbol === 'WETH') {
                tokenAddress = addresses?.WETH;
                bridgeAddress = addresses?.PrivacyBridgeWETH;
                decimals = 18;
            } else if (token.symbol === 'WBTC') {
                tokenAddress = addresses?.WBTC;
                bridgeAddress = addresses?.PrivacyBridgeWBTC;
                decimals = 8;
            } else if (token.symbol === 'USDT') {
                tokenAddress = addresses?.USDT;
                bridgeAddress = addresses?.PrivacyBridgeUSDT;
                decimals = 6;
            } else if (token.symbol === 'USDC.e') {
                tokenAddress = addresses?.USDC_E;
                bridgeAddress = addresses?.PrivacyBridgeUSDCe;
                decimals = 6;
            } else if (token.symbol === 'WADA') {
                tokenAddress = addresses?.WADA;
                bridgeAddress = addresses?.PrivacyBridgeWADA;
                decimals = 18;
            } else if (token.symbol === 'gCOTI') {
                tokenAddress = addresses?.gCOTI;
                bridgeAddress = addresses?.PrivacyBridgegCOTI;
                decimals = 18;
            } else if (token.symbol === 'COTI') {
                // Native COTI: no public tokenAddress, but bridge address is needed for to-public allowance check
                bridgeAddress = addresses?.PrivacyBridgeCotiNative;
            }
            }

            // For to-public (withdraw), only bridgeAddress is required — tokenAddress is the private token
            // resolved below. For to-private (deposit), both are needed.
            if (direction === 'to-private' && (!tokenAddress || !bridgeAddress)) return;
            if (!bridgeAddress) return;

            let currentAllowance = 0n;

            // Check direction to decide which token to check
            if (direction === 'to-public') {
                // For Portal Out, we need to check the allowance of the Private Token.
                // Resolving private token address and decimals
                let privateTokenKey = "";
                let privateDecimals = 18;
                if (token.symbol === 'COTI') {
                    privateTokenKey = 'PrivateCoti';
                    privateDecimals = 18;
                } else {
                    privateTokenKey = 'p.' + token.symbol;
                    if (token.symbol === 'WETH' || token.symbol === 'gCOTI') privateDecimals = 18;
                    else if (token.symbol === 'WBTC') privateDecimals = 8;
                    else privateDecimals = 6; // USDT, USDC.e, WADA
                }
                if (token.symbol === 'USDC.e') privateTokenKey = 'p.USDC_E';

                const privateTokenAddress = addresses[privateTokenKey];
                if (!privateTokenAddress) {
                    setAllowance('0');
                    return;
                }

                const privTokCfg = getPrivateTokensForChain(currentChainId).find(
                    pt =>
                        !!pt.addressKey &&
                        addresses[pt.addressKey as keyof typeof addresses] === privateTokenAddress
                );
                if (privTokCfg) privateDecimals = privTokCfg.decimals;

                try {
                    const tokenContract = new ethers.Contract(privateTokenAddress, [
                        "function allowance(address owner, address spender) view returns (tuple(tuple(uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, tuple(uint256 ciphertextHigh, uint256 ciphertextLow) ownerCiphertext, tuple(uint256 ciphertextHigh, uint256 ciphertextLow) spenderCiphertext))"
                    ], provider);
                    
                    const currentAllowance = await tokenContract.allowance(walletAddress, bridgeAddress);

                    // If the allowance is clearly uninitialized or 0, return early:
                    if (currentAllowance.ownerCiphertext.ciphertextHigh === 0n &&
                        currentAllowance.ownerCiphertext.ciphertextLow === 0n) {
                        setAllowance('0');
                        return;
                    }

                    // Attempt dynamic decryption if we have a snap connection to avoid prompting the user unexpectedly
                    if (hasSnap) {
                        try {
                            const aesKey = await getAESKeyFromSnap(walletAddress);
                            if (aesKey) {
                                // Dynamically import CotiSDK
                                const CotiSDK = await import('@coti-io/coti-sdk-typescript');
                                const decryptedVal = CotiSDK.decryptUint256({
                                    ciphertextHigh: currentAllowance.ownerCiphertext.ciphertextHigh,
                                    ciphertextLow: currentAllowance.ownerCiphertext.ciphertextLow
                                }, aesKey);

                                // Sanity check to avoid rendering garbage
                                const insaneThreshold = BigInt("1000000000000") * BigInt(10) ** BigInt(privateDecimals);
                                if (decryptedVal > insaneThreshold) {
                                    setAllowance('0');
                                } else {
                                    setAllowance(ethers.formatUnits(decryptedVal, privateDecimals));
                                }
                                return;
                            }
                        } catch (decryptErr) {
                            logger.warn("Could not decrypt private allowance, defaulting to 0", decryptErr);
                        }
                    }
                    
                    // If no AES key or user rejected, fall back to 0 so they can re-approve
                    setAllowance('0');
                } catch (e) {
                    logger.warn("Could not check private allowance, defaulting to 0", e);
                    setAllowance('0');
                }
                return;
            } else {
                // Public Token Allowance Check
                /* v8 ignore next 3 -- unreachable: to-private without tokenAddress returns above */
                if (!tokenAddress) {
                    setAllowance('0');
                    return;
                }
                const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
                currentAllowance = await tokenContract.allowance(walletAddress, bridgeAddress);
            }

            setAllowance(ethers.formatUnits(currentAllowance, decimals));
        } catch (err) {
            logger.error("Failed to check allowance", err);
            setAllowance('0');
        }
    }, [isConnected, walletAddress, selectedTokenIndex, publicTokens, hasSnap, getAESKeyFromSnap, direction]);

    // Auto-check allowance on dependencies change
    useEffect(() => {
        checkAllowance();
    }, [checkAllowance]);

    /**
     * Initiates the token approval transaction.
     * Sets `isApproving` to true during the process and shows toast notifications.
     */
    const handleApprove = async () => {
        if (!isConnected || !window.ethereum) return;

        const token = publicTokens[selectedTokenIndex];
        // Only approve ERC20 tokens (Everything except Native COTI - actually, Private COTI needs approval too for withdraw!)
        // If direction is to-public (Withdraw), even COTI (PrivateCoti) needs approval.
        if (direction === 'to-private' && token?.symbol === 'COTI') return;

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();
            const network = await provider.getNetwork();
            const currentChainId = Number(network.chainId);
            const addresses = CONTRACT_ADDRESSES[currentChainId];

            let tokenAddress: string | undefined;
            let bridgeAddress: string | undefined;
            let decimals = 18;

            const pubCfgApprove = getPublicTokensForChain(currentChainId).find(
                t => t.symbol === token.symbol && !t.isPrivate
            );
            if (pubCfgApprove?.bridgeAddressKey && addresses) {
                bridgeAddress = addresses[pubCfgApprove.bridgeAddressKey as keyof typeof addresses];
            }
            if (pubCfgApprove?.addressKey && addresses) {
                tokenAddress = addresses[pubCfgApprove.addressKey as keyof typeof addresses];
            }
            if (pubCfgApprove) {
                decimals = pubCfgApprove.decimals;
            }

            if (!bridgeAddress) {
            // Resolve Addresses based on Token
            if (token.symbol === 'WETH') {
                tokenAddress = addresses?.WETH;
                bridgeAddress = addresses?.PrivacyBridgeWETH;
                decimals = 18;
            } else if (token.symbol === 'WBTC') {
                tokenAddress = addresses?.WBTC;
                bridgeAddress = addresses?.PrivacyBridgeWBTC;
                decimals = 8;
            } else if (token.symbol === 'USDT') {
                tokenAddress = addresses?.USDT;
                bridgeAddress = addresses?.PrivacyBridgeUSDT;
                decimals = 6;
            } else if (token.symbol === 'USDC.e') {
                tokenAddress = addresses?.USDC_E;
                bridgeAddress = addresses?.PrivacyBridgeUSDCe;
                decimals = 6;
            } else if (token.symbol === 'WADA') {
                tokenAddress = addresses?.WADA;
                bridgeAddress = addresses?.PrivacyBridgeWADA;
                decimals = 18;
            } else if (token.symbol === 'gCOTI') {
                tokenAddress = addresses?.gCOTI;
                bridgeAddress = addresses?.PrivacyBridgegCOTI;
                decimals = 18;
            } else if (token.symbol === 'COTI') {
                // Native COTI doesn't need approval for Deposit
                /* v8 ignore next -- unreachable: native COTI deposit returns above at line 439 */
                if (direction === 'to-private') return;
                
                bridgeAddress = addresses?.PrivacyBridgeCotiNative;
            }
            }

            // For to-public (withdraw), only bridgeAddress is required — tokenAddress is the private token
            if (direction === 'to-private' && (!tokenAddress || !bridgeAddress)) return;
            if (!bridgeAddress) return;

            if (direction === 'to-public' && token.symbol === 'MTT') {
                const privTokCfgApprove = getPrivateTokensForChain(currentChainId).find(
                    pt => pt.symbol === 'p.MTT'
                );
                const pTokenAddress = privTokCfgApprove?.addressKey
                    ? addresses[privTokCfgApprove.addressKey as keyof typeof addresses]
                    : undefined;
                if (!pTokenAddress) throw new Error("p.MTT address not found");

                const amountWei = ethers.parseUnits(amount || '0', pubCfgApprove?.decimals ?? 18); /* v8 ignore branch */
                setIsApproving(true);
                setToastState({
                    visible: true,
                    title: 'Approve PoD Withdraw',
                    message: 'Please sign the permit to allow the PoD portal to withdraw your private MTT.',
                });

                const permit = await signPodWithdrawPermit({
                    signer,
                    pTokenAddress,
                    portalAddress: bridgeAddress,
                    amountWei,
                });
                setPodWithdrawPermit(permit);
                setIsApproving(false);
                setToastState(prev => ({ ...prev, visible: false }));
                return;
            }

            const amountToApprove = amount ? ethers.parseUnits(amount, decimals) : ethers.MaxUint256;

            setIsApproving(true);
            setToastState({
                visible: true,
                title: 'Approve Allowance',
                message: `Please approve the bridge to access your ${direction === 'to-public' ? 'Private ' : ''}${token.symbol}.`
            });

            let tx;

            if (direction === 'to-public') {
                // Private Token Approval (Encrypted)
                
                // 1. Resolve private token address and decimals
                let privateTokenKey = "";
                let privateDecimals = 18;
                if (token.symbol === 'COTI') {
                    privateTokenKey = 'PrivateCoti';
                    privateDecimals = 18;
                } else {
                    privateTokenKey = 'p.' + token.symbol;
                    if (token.symbol === 'WETH' || token.symbol === 'gCOTI') privateDecimals = 18;
                    else if (token.symbol === 'WBTC') privateDecimals = 8;
                    else privateDecimals = 6; // USDT, USDC.e, WADA
                }
                if (token.symbol === 'USDC.e') privateTokenKey = 'p.USDC_E';

                const privateTokenAddress = addresses[privateTokenKey];
                if (!privateTokenAddress) throw new Error("Private token address not found");

                const privTokCfgApprove = getPrivateTokensForChain(currentChainId).find(
                    pt =>
                        !!pt.addressKey &&
                        addresses[pt.addressKey as keyof typeof addresses] === privateTokenAddress
                );
                if (privTokCfgApprove) privateDecimals = privTokCfgApprove.decimals;

                // 2. Get AES key for encrypted approval
                const aesKey = await getAESKeyFromSnap(walletAddress);
                if (!aesKey) throw new Error("AES key required for private token approval. Please connect your Snap.");

                // 3. Create itValue with 256-bit encryption
                setIsApproving(true);
                setToastState({
                    visible: true,
                    title: 'Approve Private Token',
                    message: `Please approve the bridge to access your Private ${token.symbol} tokens.`
                });

                const amountToApprove = amount ? ethers.parseUnits(amount, privateDecimals) : ethers.MaxUint256;

                // approve(address,itUint256) — Encrypted approval using manual 256-bit encryption.
                const approveSig = ethers.id('approve(address,((uint256,uint256),bytes))').slice(0, 10);
                const itValue = await encryptValue256(
                    amountToApprove,
                    aesKey,
                    privateTokenAddress,
                    approveSig,
                    walletAddress,
                    signer
                );

                logger.log("🔄 Approving private token for bridge (256-bit)...");

                // Manually encode the calldata
                const approveInterface = new ethers.Interface([
                    "function approve(address spender, tuple(tuple(uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) value) returns (bool)"
                ]);
                const calldata = approveInterface.encodeFunctionData("approve", [
                    bridgeAddress,
                    [[itValue.ciphertext.ciphertextHigh, itValue.ciphertext.ciphertextLow], itValue.signature]
                ]);

                // Bypassing Coti provider
                const rawTxHash = await (window.ethereum as any).request({
                    method: 'eth_sendTransaction',
                    params: [{
                        from: walletAddress,
                        to: privateTokenAddress,
                        data: calldata,
                        gas: '0xB71B00'  // 12,000,000 in hex
                    }]
                });

                logger.log('Waiting for approve tx', { txHash: shortHash(rawTxHash) });
                await provider.waitForTransaction(rawTxHash);
                
                setIsApproving(false);
                setToastState(prev => ({ ...prev, visible: false }));
                await checkAllowance();
                return;

            } else {
                // Public Token Approval (Standard)
                /* v8 ignore next -- unreachable: to-private without tokenAddress returns above at line 500 */
                if (!tokenAddress) throw new Error("Token address not found");
                const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
                tx = await tokenContract.approve(bridgeAddress, amountToApprove);
            }

            setToastState({
                visible: true,
                title: 'Approving...',
                message: 'Waiting for allowance confirmation...'
            });

            await tx.wait();

            // Refresh allowance
            await checkAllowance();

            setIsApproving(false);
            setToastState(prev => ({ ...prev, visible: false }));

        } catch (err) {
            logger.error("Approval failed", err);
            setIsApproving(false);
            setToastState(prev => ({ ...prev, visible: false }));
            throw err; // Rethrow to allow UI to handle error (e.g. show message, reset state)
        }
    };

    /**
     * Determines if an approval is required for the current transaction.
     * @returns `true` if approval is needed, `false` otherwise.
     */
    const isApprovalNeeded = (() => {
        const token = publicTokens[selectedTokenIndex];
        // For Native COTI in to-private (Deposit), no approval needed.
        if (direction === 'to-private' && token?.symbol === 'COTI') return false;
        if (direction === 'to-public' && token?.symbol === 'MTT') {
            if (!podWithdrawPermit || !walletAddress || !window.ethereum) return true;
            try {
                const amountWei = ethers.parseUnits(amount || '0', 18).toString();
                return (
                    podWithdrawPermit.wallet.toLowerCase() !== walletAddress.toLowerCase() ||
                    podWithdrawPermit.amountWei !== amountWei
                );
            } catch {
                return true;
            }
        }

        const amountNum = parseFloat(amount || '0');
        const allowanceNum = parseFloat(allowance);
        return amountNum > allowanceNum;
    })();
  return {
    allowance,
    isApproving,
    handleApprove,
    checkAllowance,
    isApprovalNeeded,
    podWithdrawPermit,
    setPodWithdrawPermit,
  };
};
