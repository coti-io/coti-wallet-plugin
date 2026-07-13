import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, ERC20_ABI } from '../../contracts/config';
import type { PodWithdrawPermit } from '../../chains/portal/executePodPortalTransaction';
import { signPodWithdrawPermit } from '../../chains/portal/executePodPortalTransaction';
import { getPrivateTokensForChain, getPublicTokensForChain } from '../../chains';
import {
  findPublicTokenConfig,
  isPodPortalPublicToken,
  podPortalNotConfiguredError,
  resolveConfiguredAddress,
  resolvePodPortalAddresses,
  skipsPublicDepositApproval,
} from '../../chains/portal/helpers';
import { logger } from '../../lib/logger';
import { decryptCtUint256 } from '../../crypto/decryption';
import { encryptValue256 } from './encryptValue256';
import { shortHash } from './utils';
import type { Token, ToastState } from './types';
import { getMetaMaskProvider } from '../../lib/ethereum';
import { useSnap } from '../useSnap';

export interface UsePrivacyBridgeAllowanceOptions {
  isConnected: boolean;
  walletAddress: string;
  publicTokens: Token[];
  amount: string;
  direction: 'to-private' | 'to-public';
  selectedTokenIndex: number;
  hasSnap: boolean;
  setToastState: React.Dispatch<React.SetStateAction<ToastState>>;
  /** In-memory session AES key — avoids Snap/provider calls when available. */
  sessionAesKey?: string | null;
  chainId?: number;
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
  setToastState,
  sessionAesKey,
  chainId,
}: UsePrivacyBridgeAllowanceOptions) => {
  const [allowance, setAllowance] = useState<string>('0');
  const [isApproving, setIsApproving] = useState(false);
  const [podWithdrawPermit, setPodWithdrawPermit] = useState<PodWithdrawPermit | null>(null);
  /** Synchronous store so transfer can run in the same tick as approve (before React re-renders). */
  const podWithdrawPermitRef = useRef<PodWithdrawPermit | null>(null);
  const { decryptCtUint256ViaSnap, buildItUint256ViaSnap } = useSnap();

  const clearPodWithdrawPermit = useCallback(() => {
    podWithdrawPermitRef.current = null;
    setPodWithdrawPermit(null);
  }, []);

  useEffect(() => {
    clearPodWithdrawPermit();
  }, [walletAddress, clearPodWithdrawPermit]);

  const getPodWithdrawPermit = useCallback(
    (): PodWithdrawPermit | null => podWithdrawPermitRef.current ?? podWithdrawPermit,
    [podWithdrawPermit],
  );

  const isPodWithdrawPermitStale = useCallback((
    permit: PodWithdrawPermit | null,
    token: Token | undefined,
    activeChainId?: number,
  ): boolean => {
    if (!permit || !walletAddress || !token) return true;
    try {
      const decimals = token.decimals ?? 18;
      const amountWei = ethers.parseUnits(amount || '0', decimals).toString();
      if (permit.wallet.toLowerCase() !== walletAddress.toLowerCase()) return true;
      if (permit.amountWei !== amountWei) return true;

      const resolvedChainId = activeChainId ?? chainId;
      if (!resolvedChainId) return false;

      const addresses = CONTRACT_ADDRESSES[resolvedChainId];
      const pubCfg = getPublicTokensForChain(resolvedChainId).find(
        t => t.symbol === token.symbol && !t.isPrivate,
      );
      const privCfg = getPrivateTokensForChain(resolvedChainId).find(
        t => t.symbol === `p.${token.symbol.replace(/^p\./, '')}`,
      );
      const resolved = pubCfg && addresses
        ? resolvePodPortalAddresses({ addresses, pubCfg, privCfg })
        : null;
      if (!resolved) return true;

      return (
        permit.portalAddress.toLowerCase() !== resolved.portalAddress.toLowerCase()
        || permit.pTokenAddress.toLowerCase() !== resolved.pTokenAddress.toLowerCase()
      );
    } catch {
      return true;
    }
  }, [amount, chainId, walletAddress]);

  // The wagmi connector for the wallet the user actually selected (Rabby, MetaMask, etc.).
  // We resolve the EIP-1193 provider from this connector instead of reading window.ethereum,
  // which is unreliable when multiple wallet extensions compete for the global.
  const { connector } = useAccount();

  /**
   * Resolves the EIP-1193 provider for the connected wallet.
   * Prefers the wagmi connector's provider (the exact wallet the user chose),
   * falling back to window.ethereum only if the connector can't supply one.
   */
  const resolveInjectedProvider = useCallback(async (): Promise<any> => {
    if (connector?.getProvider) {
      try {
        const connectorProvider = await connector.getProvider();
        if (connectorProvider) return connectorProvider;
      } catch (e) {
        logger.warn('[Approve] connector.getProvider() failed, falling back to window.ethereum', e);
      }
    }
    return getMetaMaskProvider() ?? window.ethereum;
  }, [connector]);

    const checkAllowance = useCallback(async () => {
        if (!isConnected || !walletAddress) return;

        const token = publicTokens[selectedTokenIndex];
        const injectedProvider = await resolveInjectedProvider();
        if (!injectedProvider) return;
        const provider = new ethers.BrowserProvider(injectedProvider);
        const network = await provider.getNetwork();
        const currentChainId = Number(network.chainId);
        const pubCfgEarly = findPublicTokenConfig(currentChainId, token?.symbol ?? "");

        // Native deposits skip ERC-20 approve; PoD withdraw uses a typed permit instead of allowance.
        if (skipsPublicDepositApproval(pubCfgEarly, direction)) {
            setAllowance('999999999999999999');
            return;
        }
        if (direction === 'to-public' && isPodPortalPublicToken(currentChainId, pubCfgEarly)) {
            setAllowance('999999999999999999');
            return;
        }

        // Reset to 0 to prevent stale state from previous token
        setAllowance('0');

        try {
            const addresses = CONTRACT_ADDRESSES[currentChainId];

            let tokenAddress: string | undefined;
            let bridgeAddress: string | undefined;
            let decimals = 18;

            const pubCfg = getPublicTokensForChain(currentChainId).find(
                t => t.symbol === token.symbol && !t.isPrivate
            );
            if (pubCfg?.bridgeAddressKey && addresses) {
                bridgeAddress = resolveConfiguredAddress(addresses, pubCfg.bridgeAddressKey);
            }
            if (pubCfg?.addressKey && addresses) {
                tokenAddress = resolveConfiguredAddress(addresses, pubCfg.addressKey);
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

            // For to-private (deposit), ERC-20 needs token + bridge; native portal tokens only need bridge.
            const isNativeDeposit = !!pubCfg?.isNative;
            if (direction === 'to-private' && !isNativeDeposit && (!tokenAddress || !bridgeAddress)) return;
            if (direction === 'to-private' && isNativeDeposit && !bridgeAddress) return;
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

                    // Attempt dynamic decryption without exposing AES to the dApp.
                    // Snap wallets decrypt inside Snap; non-Snap wallets use the plugin session key.
                    if (hasSnap || sessionAesKey) {
                        try {
                            const ciphertext = {
                                ciphertextHigh: currentAllowance.ownerCiphertext.ciphertextHigh,
                                ciphertextLow: currentAllowance.ownerCiphertext.ciphertextLow
                            };
                            const decryptedVal = sessionAesKey
                                ? decryptCtUint256(ciphertext, sessionAesKey, { decimals: privateDecimals })
                                : await decryptCtUint256ViaSnap(ciphertext, currentChainId, walletAddress);

                            if (decryptedVal === null) {
                                setAllowance('0');
                            } else {
                                setAllowance(ethers.formatUnits(decryptedVal, privateDecimals));
                            }
                            return;
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
    }, [isConnected, walletAddress, selectedTokenIndex, publicTokens, hasSnap, direction, sessionAesKey, resolveInjectedProvider, decryptCtUint256ViaSnap]);

    // Auto-check allowance on dependencies change
    useEffect(() => {
        checkAllowance();
    }, [checkAllowance]);

    /**
     * Initiates the token approval transaction.
     * Sets `isApproving` to true during the process and shows toast notifications.
     */
    const handleApprove = async () => {
        if (!isConnected || !walletAddress) return;

        const token = publicTokens[selectedTokenIndex];
        if (direction === 'to-private' && (token?.isNative || (token?.symbol === 'COTI' && !token.addressKey))) return;

        try {
            // Resolve the provider from the connected wallet's wagmi connector,
            // NOT window.ethereum, which is unreliable with multiple wallets installed.
            const injectedProvider = await resolveInjectedProvider();
            const provider = new ethers.BrowserProvider(injectedProvider);

            // Guardrail: request only the connected account from the provider.
            // Using getSigner() without an address argument can trigger popups from
            // other installed wallets (MetaMask, Rabby, Trust, etc.) when they compete
            // for window.ethereum. By passing the known walletAddress, ethers will call
            // eth_requestAccounts only if needed and validate the returned address,
            // preventing a different wallet from hijacking the signing request.
            logger.log('[Approve] Requesting signer for connected address', { walletAddress, connectorId: connector?.id });
            const signer = await provider.getSigner(walletAddress);
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
                bridgeAddress = resolveConfiguredAddress(addresses, pubCfgApprove.bridgeAddressKey);
            }
            if (pubCfgApprove?.addressKey && addresses) {
                tokenAddress = resolveConfiguredAddress(addresses, pubCfgApprove.addressKey);
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

            if (isPodPortalPublicToken(currentChainId, pubCfgApprove)) {
                const privTokCfgApprove = getPrivateTokensForChain(currentChainId).find(
                    pt => pt.symbol === `p.${token.symbol.replace(/^p\./, '')}`
                );
                const resolved = pubCfgApprove
                    ? resolvePodPortalAddresses({ addresses, pubCfg: pubCfgApprove, privCfg: privTokCfgApprove })
                    : null;
                if (!resolved) {
                    throw new Error(podPortalNotConfiguredError(currentChainId, token.symbol));
                }

                if (direction === 'to-public') {
                    const amountWei = ethers.parseUnits(amount || '0', pubCfgApprove?.decimals ?? 18); /* v8 ignore branch */
                    setIsApproving(true);
                    setToastState({
                        visible: true,
                        title: 'Approve PoD Withdraw',
                        message: `Please sign the permit to allow the PoD portal to withdraw your private ${token.symbol}.`,
                    });

                    const permit = await signPodWithdrawPermit({
                        signer,
                        pTokenAddress: resolved.pTokenAddress,
                        portalAddress: resolved.portalAddress,
                        amountWei,
                        chainId: currentChainId,
                        tokenSymbol: token.symbol,
                    });
                    podWithdrawPermitRef.current = permit;
                    setPodWithdrawPermit(permit);
                    setIsApproving(false);
                    setToastState(prev => ({ ...prev, visible: false }));
                    return;
                }

                bridgeAddress = resolved.portalAddress;
                tokenAddress = resolved.underlyingAddress;
            } else if (direction === 'to-private' && (!tokenAddress || !bridgeAddress)) {
                return;
            }

            if (!bridgeAddress) return;

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

                setIsApproving(true);

                // Sends one encrypted approve(address,itUint256) call and waits for it to actually
                // land on-chain. waitForTransaction resolves on revert too, so callers must check
                // status explicitly — otherwise a reverted approve (e.g. PrivateERC20's
                // ERC20UnsafeApprove guard rejecting a non-zero-over-non-zero approve) is silently
                // treated as success and the withdraw that follows fails on insufficient allowance.
                const sendEncryptedApprove = async (valueToApprove: bigint): Promise<void> => {
                    const approveSig = ethers.id('approve(address,((uint256,uint256),bytes))').slice(0, 10);
                    const itValue = sessionAesKey
                        ? await encryptValue256(
                            valueToApprove,
                            sessionAesKey,
                            privateTokenAddress,
                            approveSig,
                            walletAddress,
                            signer
                        )
                        : hasSnap
                            ? await buildItUint256ViaSnap({
                                value: valueToApprove,
                                tokenAddress: privateTokenAddress,
                                functionSelector: approveSig,
                                chainId: currentChainId,
                                accountAddress: walletAddress,
                            })
                            : null;
                    if (!itValue) {
                        throw new Error("Private approval requires unlock/onboarding first.");
                    }
                    logger.log('🔐 [Approve] Encrypted approval payload ready, encoding calldata...');

                    // Manually encode the calldata
                    const approveInterface = new ethers.Interface([
                        "function approve(address spender, tuple(tuple(uint256 ciphertextHigh, uint256 ciphertextLow) ciphertext, bytes signature) value) returns (bool)"
                    ]);
                    const calldata = approveInterface.encodeFunctionData("approve", [
                        bridgeAddress,
                        [[itValue.ciphertext.ciphertextHigh, itValue.ciphertext.ciphertextLow], itValue.signature]
                    ]);

                    logger.log('🔐 [Approve] Sending approve tx (wallet confirmation expected)...');
                    // Bypassing Coti provider — use the connected wallet's provider directly.
                    const rawTxHash = await (injectedProvider as any).request({
                        method: 'eth_sendTransaction',
                        params: [{
                            from: walletAddress,
                            to: privateTokenAddress,
                            data: calldata,
                            gas: '0xB71B00'  // 12,000,000 in hex
                        }]
                    });

                    logger.log('🔐 [Approve] Tx submitted, waiting for confirmation', { txHash: shortHash(rawTxHash) });
                    const receipt = await provider.waitForTransaction(rawTxHash);
                    if (!receipt || receipt.status !== 1) {
                        throw new Error(
                            `Approval for ${token.symbol} reverted on-chain. This can happen when a previous non-zero allowance is still set — please try again.`
                        );
                    }
                    logger.log('🔐 [Approve] Tx confirmed');
                };

                // PrivateERC20.approve reverts with ERC20UnsafeApprove() if both the current and the
                // new allowance are non-zero (mitigation for the classic ERC-20 approve race). Clear
                // a stale non-zero allowance first so the real approve below doesn't get rejected.
                if (parseFloat(allowance || '0') > 0) {
                    logger.log('🔐 [Approve] Non-zero allowance detected — resetting to 0 first', { currentAllowance: allowance });
                    setToastState({
                        visible: true,
                        title: 'Resetting Allowance',
                        message: `Clearing previous allowance before approving ${token.symbol}...`
                    });
                    await sendEncryptedApprove(0n);
                }

                setToastState({
                    visible: true,
                    title: 'Approve Private Token',
                    message: `Please approve the bridge to access your Private ${token.symbol} tokens.`
                });

                const amountToApprove = amount ? ethers.parseUnits(amount, privateDecimals) : ethers.MaxUint256;
                await sendEncryptedApprove(amountToApprove);

                logger.log('🔐 [Approve] Refreshing allowance...');
                setIsApproving(false);
                setToastState(prev => ({ ...prev, visible: false }));
                await checkAllowance();
                logger.log('✅ [Approve] Complete');
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

        if (direction === 'to-private' && (token?.isNative || (token?.symbol === 'COTI' && !token.addressKey))) {
            return false;
        }

        if (direction === 'to-public' && token?.bridgeAddressKey?.startsWith('PrivacyPortal')) {
            return isPodWithdrawPermitStale(podWithdrawPermit, token, chainId);
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
    getPodWithdrawPermit,
    clearPodWithdrawPermit,
  };
};
