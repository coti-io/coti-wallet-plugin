import { useState, useCallback } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES, BRIDGE_ABI, BRIDGE_ERC20_ABI, ERC20_ABI } from '../../contracts/config';
import type { PodPortalRequest } from '../../contracts/pod';
import type { PodWithdrawPermit } from '../../chains/portal/executePodPortalTransaction';
import { executePodPortalTransaction } from '../../chains/portal/executePodPortalTransaction';
import { formatTokenBalanceDisplay } from '../../lib/utils';
import { estimateBridgeFee } from '../useEstimateBridgeFees';
import { getChainConfig, getPrivateTokensForChain, getPublicTokensForChain, getRpcUrlForChain } from '../../chains';
import { logger } from '../../lib/logger';
import { truncateAddress } from '../../lib/format';
import { shortHash } from './utils';
import type { SwapProgressStage, Token, ToastState } from './types';

export interface UsePrivacyBridgeExecutorOptions {
  walletAddress: string;
  publicTokens: Token[];
  setPublicTokens: React.Dispatch<React.SetStateAction<Token[]>>;
  setPrivateTokens: React.Dispatch<React.SetStateAction<Token[]>>;
  setToastState: React.Dispatch<React.SetStateAction<ToastState>>;
  refreshPrivateBalances?: () => Promise<boolean>;
  upsertPodRequest?: (request: PodPortalRequest) => void;
  podWithdrawPermit: PodWithdrawPermit | null;
  setPodWithdrawPermit: React.Dispatch<React.SetStateAction<PodWithdrawPermit | null>>;
}

/** Deposit/withdraw and PoD portal transaction execution. */
export const usePrivacyBridgeExecutor = ({
  walletAddress,
  publicTokens,
  setPublicTokens,
  setPrivateTokens,
  setToastState,
  refreshPrivateBalances,
  upsertPodRequest,
  podWithdrawPermit,
  setPodWithdrawPermit,
}: UsePrivacyBridgeExecutorOptions) => {
  const [isBridgingLoading, setIsBridgingLoading] = useState(false);

    const calculateGasMargin = async (
        contract: ethers.Contract,
        methodName: string,
        args: any[],
        fallbackGasLimit: bigint,
        overrides: any = {}
    ): Promise<bigint> => {
        try {
            logger.log(`Estimating gas for ${methodName}...`);
            const estimatedGas = await contract[methodName].estimateGas(...args, overrides);
            // removing 20% buffer as requested
            // const safeGas = (estimatedGas * 120n) / 100n;
            const safeGas = estimatedGas;
            logger.log(`Gas estimation successful: ${estimatedGas.toString()} -> Safe limit: ${safeGas.toString()}`);
            return safeGas;
        } catch (error: any) {
            logger.warn(`Gas estimation failed for ${methodName}`, error);
            // Log specific error reason if available
            if (error.reason) logger.warn(`   Reason: ${error.reason}`);
            if (error.data) logger.warn(`   Data: ${error.data}`);

            return fallbackGasLimit;
        }
    };

    const executeTransaction = useCallback(async (
        txAmount: string,
        txDirection: 'to-private' | 'to-public',
        txTokenIndex: number,
        onProgress?: (stage: SwapProgressStage, txHash?: string) => void
    ) => {
        logger.log(`🚀 Initiating swap transaction: ${txAmount} (Direction: ${txDirection}, Token Index: ${txTokenIndex})`);
        setIsBridgingLoading(true);
        try {
            if (!window.ethereum) throw new Error("No wallet found");

            // Initialize Ethers
            const provider = new ethers.BrowserProvider(window.ethereum);
            const signer = await provider.getSigner();

            const network = await provider.getNetwork();
            const currentChainId = Number(network.chainId);
            const addresses = CONTRACT_ADDRESSES[currentChainId];

            if (!addresses) throw new Error("Unsupported network");

            const txPublicToken = publicTokens[txTokenIndex];
            const chainCfgExec = getChainConfig(currentChainId);

            const pubTokExec = getPublicTokensForChain(currentChainId).find(
                t => t.symbol === txPublicToken.symbol && !t.isPrivate
            );
            const privTokExec = getPrivateTokensForChain(currentChainId).find(
                t => t.symbol === `p.${txPublicToken.symbol.replace(/^p\./, '')}`
            );

            let bridgeAddress: string | undefined =
                pubTokExec?.bridgeAddressKey != null
                    ? addresses[pubTokExec.bridgeAddressKey as keyof typeof addresses]
                    : undefined;
            let tokenAddress: string | undefined =
                pubTokExec?.addressKey != null
                    ? addresses[pubTokExec.addressKey as keyof typeof addresses]
                    : undefined;
            let publicDecimals = pubTokExec?.decimals ?? 18;
            let privateDecimals = privTokExec?.decimals ?? pubTokExec?.decimals ?? 18;

            const isWeth = txPublicToken.symbol === 'WETH';
            const isWbtc = txPublicToken.symbol === 'WBTC';
            const isUsdt = txPublicToken.symbol === 'USDT';
            const isUsdcE = txPublicToken.symbol === 'USDC.e';
            const isWada = txPublicToken.symbol === 'WADA';
            const isGCoti = txPublicToken.symbol === 'gCOTI';

            if (!bridgeAddress) {
                if (isWeth) {
                    bridgeAddress = addresses.PrivacyBridgeWETH;
                    tokenAddress = addresses.WETH;
                    publicDecimals = 18;
                    privateDecimals = 18;
                } else if (isWbtc) {
                    bridgeAddress = addresses.PrivacyBridgeWBTC;
                    tokenAddress = addresses.WBTC;
                    publicDecimals = 8;
                    privateDecimals = 8;
                } else if (isUsdt) {
                    bridgeAddress = addresses.PrivacyBridgeUSDT;
                    tokenAddress = addresses.USDT;
                    publicDecimals = 6;
                    privateDecimals = 6;
                } else if (isUsdcE) {
                    bridgeAddress = addresses.PrivacyBridgeUSDCe;
                    tokenAddress = addresses.USDC_E;
                    publicDecimals = 6;
                    privateDecimals = 6;
                } else if (isWada) {
                    bridgeAddress = addresses.PrivacyBridgeWADA;
                    tokenAddress = addresses.WADA;
                    publicDecimals = 6;
                    privateDecimals = 6;
                } else if (isGCoti) {
                    bridgeAddress = addresses.PrivacyBridgegCOTI;
                    tokenAddress = addresses.gCOTI;
                    publicDecimals = 18;
                    privateDecimals = 18;
                } else {
                    bridgeAddress = addresses.PrivacyBridgeCotiNative;
                    publicDecimals = 18;
                    privateDecimals = 18;
                }
            }

            if (!bridgeAddress) throw new Error("Bridge address not found for this token");

            const isErc20 = !!tokenAddress;

            const bridgeAbi = isErc20 ? BRIDGE_ERC20_ABI : BRIDGE_ABI;

            const bridge = new ethers.Contract(bridgeAddress, bridgeAbi, signer);

            // Use correct decimals based on direction
            const decimals = txDirection === 'to-private' ? publicDecimals : privateDecimals;
            const amountWei = ethers.parseUnits(txAmount, decimals);

            if (chainCfgExec?.portalStrategy === 'pod-privacy-portal') {
                if (txPublicToken?.symbol !== 'MTT') {
                    throw new Error("Sepolia PoD portal supports MTT only");
                }

                const pTokenAddress = privTokExec?.addressKey
                    ? addresses[privTokExec.addressKey as keyof typeof addresses]
                    : undefined;

                if (!bridgeAddress || !tokenAddress || !pTokenAddress) {
                    logger.error('PoD portal config check failed', {
                        token: privTokExec?.symbol,
                        chainId: currentChainId,
                        hasBridge: !!bridgeAddress,
                        hasToken: !!tokenAddress,
                        hasPToken: !!pTokenAddress,
                    });
                    throw new Error("Sepolia PoD portal is not configured");
                }

                setToastState({
                    visible: true,
                    title: txDirection === 'to-private' ? 'Submit PoD Deposit' : 'Submit PoD Withdraw',
                    message: 'Please confirm the Sepolia transaction in your wallet.',
                });

                const result = await executePodPortalTransaction({
                    txAmount,
                    txDirection,
                    signer,
                    provider,
                    portalAddress: bridgeAddress,
                    underlyingAddress: tokenAddress,
                    pTokenAddress,
                    tokenSymbol: txPublicToken.symbol,
                    decimals,
                    withdrawPermit: txDirection === 'to-public' ? podWithdrawPermit ?? undefined : undefined,
                    onProgress,
                });

                upsertPodRequest?.(result.request);
                if (txDirection === 'to-public') setPodWithdrawPermit(null);
                onProgress?.('transfer-complete', result.txHash);

                setToastState({
                    visible: true,
                    title: 'PoD Request Submitted',
                    message: txDirection === 'to-private'
                        ? 'Deposit submitted on Sepolia. Private balance will update after the PoD callback succeeds.'
                        : 'Withdraw submitted on Sepolia. Funds are released after the PoD callback succeeds.',
                });
                logger.log('Sepolia PoD request submitted', { txHash: shortHash(result.txHash) });
                return;
            }

            let tx;

            if (txDirection === 'to-private') {
                // Deposit
                logger.log('Depositing to bridge', {
                    token: txPublicToken.symbol,
                    bridge: truncateAddress(bridgeAddress),
                });

                setToastState({
                    visible: true,
                    title: 'Confirm Transaction',
                    message: 'Please confirm the transaction in your wallet to deposit to your private balance.'
                });

                try {
                    if (isErc20 && tokenAddress) {
                        // ERC20 Deposit: requires allowance
                        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
                        const userBalance = await tokenContract.balanceOf(walletAddress);

                        const amountWeiPublic = ethers.parseUnits(txAmount, publicDecimals); // Allowance/Balance always unchecked against public amount

                        // Re-check allowance using Public Decimals
                        const userAllowance = await tokenContract.allowance(walletAddress, bridgeAddress);

                        if (userBalance < amountWeiPublic) {
                            logger.log('Insufficient balance for deposit', {
                                token: txPublicToken.symbol,
                                decimals: publicDecimals,
                            });
                            throw new Error(`Insufficient ${txPublicToken.symbol} balance. You have ${ethers.formatUnits(userBalance, publicDecimals)} ${txPublicToken.symbol}, trying to bridge ${txAmount}.`);
                        }
                        if (userAllowance < amountWeiPublic) {
                            throw new Error(`Insufficient Allowance. Approved: ${ethers.formatUnits(userAllowance, publicDecimals)}, Required: ${txAmount}. Please Approve again.`);
                        }

                        logger.log("🔄 Executing ERC20 Deposit...");

                        // Get fee from on-chain estimateDepositFee
                        let nativeFee = 0n;
                        let cotiOracleTimestamp = 0n;
                        let tokenOracleTimestamp = 0n;
                        try {
                            const rpcUrl = getRpcUrlForChain(Number((await provider.getNetwork()).chainId));
                            const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
                            const feeEstimate = await estimateBridgeFee(txPublicToken.symbol, txAmount, rpcProvider);
                            if (feeEstimate.depositFee !== 'Error') {
                                const feeWei = ethers.parseEther(feeEstimate.depositFee);
                                // Add 1% slippage buffer
                                nativeFee = (feeWei * 101n) / 100n;
                            }
                            cotiOracleTimestamp = BigInt(feeEstimate.cotiLastUpdated || '0');
                            tokenOracleTimestamp = BigInt(feeEstimate.tokenLastUpdated || '0');
                            logger.log('Computed COTI fee for ERC20 deposit');
                            logger.log('Oracle timestamps loaded for ERC20 deposit', {
                                coti: cotiOracleTimestamp.toString(),
                                token: tokenOracleTimestamp.toString(),
                            });
                        } catch (e) {
                            logger.warn("⚠️ Could not compute dynamic fee, defaulting to 0:", e);
                        }


                        logger.log('ERC20 deposit prepared', { token: txPublicToken.symbol });

                        onProgress?.('transfer-start');

                        // CRITICAL: Bypass the Coti provider — it strips the data field from
                        // non-encrypted transactions, causing msg.data to land as "" and revert.
                        const depositBridge = new ethers.Contract(bridgeAddress, BRIDGE_ERC20_ABI, signer);
                        const depositCalldata = depositBridge.interface.encodeFunctionData('deposit(uint256,uint256,uint256)', [amountWeiPublic, cotiOracleTimestamp, tokenOracleTimestamp]);

                        let depositGasLimit = 12000000n;
                        try {
                            const depositGasHex = await (window.ethereum as any).request({
                                method: 'eth_estimateGas',
                                params: [{
                                    from: walletAddress,
                                    to: bridgeAddress,
                                    data: depositCalldata,
                                    value: '0x' + nativeFee.toString(16),
                                }]
                            });
                            depositGasLimit = (BigInt(depositGasHex) * 130n) / 100n;
                            logger.log(`🔍 ERC20 deposit gas: estimated=${BigInt(depositGasHex)}, buffered=${depositGasLimit}`);
                        } catch (estErr: any) {
                            logger.warn("⚠️ ERC20 deposit gas estimation failed, falling back to 12M:", estErr?.message);
                        }

                        const rawDepositTxHash = await (window.ethereum as any).request({
                            method: 'eth_sendTransaction',
                            params: [{
                                from: walletAddress,
                                to: bridgeAddress,
                                data: depositCalldata,
                                value: '0x' + nativeFee.toString(16),
                                gas: '0x' + depositGasLimit.toString(16),
                            }]
                        });

                        logger.log('ERC20 deposit tx sent', { txHash: shortHash(rawDepositTxHash) });
                        tx = {
                            hash: rawDepositTxHash,
                            wait: async () => await provider.waitForTransaction(rawDepositTxHash)
                        } as any;

                    } else {
                        // Native COTI Deposit
                        logger.log("🔄 Executing Native COTI Deposit...");

                        // Get dual oracle timestamps from fee estimation
                        let cotiOracleTimestamp = 0n;
                        let tokenOracleTimestamp = 0n;
                        try {
                            const rpcUrl = getRpcUrlForChain(Number((await provider.getNetwork()).chainId));
                            const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
                            const feeEstimate = await estimateBridgeFee('COTI', txAmount, rpcProvider);
                            cotiOracleTimestamp = BigInt(feeEstimate.cotiLastUpdated || '0');
                            tokenOracleTimestamp = cotiOracleTimestamp;
                            logger.log('Oracle timestamps loaded for native COTI deposit', {
                                coti: cotiOracleTimestamp.toString(),
                                token: tokenOracleTimestamp.toString(),
                            });
                        } catch (e) {
                            logger.warn("⚠️ Could not fetch oracle timestamp:", e);
                        }

                        // Default fallback 12M — native COTI bridge.deposit() triggers MPC operations.
                        let safeGasLimit = 12000000n;

                        logger.log('Native COTI deposit prepared', { token: txPublicToken.symbol, gasLimit: safeGasLimit.toString() });

                        try {
                            logger.log("🔍 Attempting calculateGasMargin for native COTI deposit...");
                            const estimatedGas = await calculateGasMargin(
                                bridge,
                                'deposit(uint256,uint256)',
                                [cotiOracleTimestamp, tokenOracleTimestamp],
                                12000000n,
                                { value: amountWei }
                            );
                            const buffered = (estimatedGas * 130n) / 100n;
                            safeGasLimit = buffered > 900000n ? buffered : 900000n;
                            logger.log(`🔍 Native COTI deposit gas: estimated=${estimatedGas}, buffered=${buffered}, final=${safeGasLimit}`);
                        /* v8 ignore start -- calculateGasMargin never throws; it returns fallbackGasLimit internally */
                        } catch (e) {
                            logger.warn("⚠️ Native COTI deposit gas estimation failed, falling back to 12M:", e);
                        }
                        /* v8 ignore stop */

                        onProgress?.('transfer-start');
                        tx = await bridge['deposit(uint256,uint256)'](cotiOracleTimestamp, tokenOracleTimestamp, { value: amountWei, gasLimit: safeGasLimit });
                    }
                } catch (e) {
                    setIsBridgingLoading(false);
                    setToastState(prev => ({ ...prev, visible: false }));
                    throw e;
                }
            } else {
                // Withdraw (Portal Out) — Uses bridge.withdraw()
                logger.log(`Withdrawing ${txAmount} p.${txPublicToken.symbol}`);

                try {
                    // Check Allowance first (similar to Deposit)
                    const parsedAmount = ethers.parseUnits(txAmount, privateDecimals);
                    
                    // We don't have an easy way to check encrypted allowance here, 
                    // but we rely on the component gating the transition to Withdraw.
                    // However, let's at least ensure we have the correct signer.

                    const walletAddress = await signer.getAddress();
                    
                    // 5. Call bridge.withdraw(amount)
                    setToastState({
                        visible: true,
                        title: 'Confirm Withdrawal',
                        message: 'Please confirm the withdrawal transaction in your wallet.'
                    });

                    const bridgeAbi = isErc20 ? BRIDGE_ERC20_ABI : BRIDGE_ABI;
                    const bridgeContract = new ethers.Contract(bridgeAddress, bridgeAbi, signer);

                    // Fetch the native COTI fee for the bridge withdrawal
                    // Compute the dynamic fee from on-chain estimateWithdrawFee
                    // and add 1% slippage buffer
                    let nativeFee = 0n;
                    let cotiOracleTimestamp = 0n;
                    let tokenOracleTimestamp = 0n;
                    if (isErc20) {
                        try {
                            const rpcUrl = getRpcUrlForChain(Number((await provider.getNetwork()).chainId));
                            const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
                            const feeEstimate = await estimateBridgeFee(txPublicToken.symbol, txAmount, rpcProvider);
                            if (feeEstimate.withdrawFee !== 'Error') {
                                const feeWei = ethers.parseEther(feeEstimate.withdrawFee);
                                nativeFee = (feeWei * 101n) / 100n;
                            }
                            cotiOracleTimestamp = BigInt(feeEstimate.cotiLastUpdated || '0');
                            tokenOracleTimestamp = BigInt(feeEstimate.tokenLastUpdated || '0');
                            logger.log('Computed COTI fee for withdraw');
                            logger.log('Oracle timestamps loaded for withdraw', {
                                coti: cotiOracleTimestamp.toString(),
                                token: tokenOracleTimestamp.toString(),
                            });
                        } catch (e) {
                            logger.warn("⚠️ Could not compute dynamic fee for withdraw, defaulting to 0:", e);
                        }
                    } else {
                        // Native COTI withdrawal — get dual oracle timestamps
                        try {
                            const rpcUrl = getRpcUrlForChain(Number((await provider.getNetwork()).chainId));
                            const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
                            const feeEstimate = await estimateBridgeFee('COTI', txAmount, rpcProvider);
                            cotiOracleTimestamp = BigInt(feeEstimate.cotiLastUpdated || '0');
                            tokenOracleTimestamp = cotiOracleTimestamp;
                            logger.log('Oracle timestamps loaded for native withdraw', {
                                coti: cotiOracleTimestamp.toString(),
                                token: tokenOracleTimestamp.toString(),
                            });
                        } catch (e) {
                            logger.warn("⚠️ Could not fetch oracle timestamps for withdraw:", e);
                        }
                    }

                    logger.log("🔄 Executing Withdraw via bridge.withdraw()...");
                    // Default fallback gas limit for MPC operations.
                    // COTI node's estimateGas can under-count, but we will try to calculate dynamically.
                    let safeGasLimit = 12000000n;

                    logger.log('Withdraw prepared', { token: txPublicToken.symbol, gasLimit: safeGasLimit.toString() });

                    // CRITICAL: We also bypass the Coti provider here because it strips the data field
                    // from normal (non-encrypted) transactions. Without this, msg.data lands as "" and reverts.
                    const withdrawCalldata = bridgeContract.interface.encodeFunctionData('withdraw(uint256,uint256,uint256)', [amountWei, cotiOracleTimestamp, tokenOracleTimestamp]);

                    try {
                        logger.log("🔍 Attempting eth_estimateGas for withdraw...");
                        const gasEstimateHex = await (window.ethereum as any).request({
                            method: 'eth_estimateGas',
                            params: [{
                                from: walletAddress,
                                to: bridgeAddress,
                                data: withdrawCalldata,
                                value: '0x' + nativeFee.toString(16),
                            }]
                        });
                        // Add 30% buffer — MPC operations have significant gas variance between
                        // estimation and execution, 10% is not enough and causes silent reverts.
                        safeGasLimit = (BigInt(gasEstimateHex) * 130n) / 100n;
                        logger.log(`🔍 Withdraw gas estimation successful: ${BigInt(gasEstimateHex).toString()} → with 30% buffer: ${safeGasLimit.toString()}`);
                    } catch (estimateErr: any) {
                        logger.warn("⚠️ Withdraw gas estimation failed, falling back to 12M:", estimateErr);
                        if (estimateErr.message) logger.warn("   Reason:", estimateErr.message);
                    }

                    const rawWithdrawTxHash = await (window.ethereum as any).request({
                        method: 'eth_sendTransaction',
                        params: [{
                            from: walletAddress,
                            to: bridgeAddress,
                            data: withdrawCalldata,
                            value: '0x' + nativeFee.toString(16),
                            gas: '0x' + safeGasLimit.toString(16)
                        }]
                    });

                    logger.log('Withdraw tx sent', { txHash: shortHash(rawWithdrawTxHash) });
                    onProgress?.('transfer-start');

                    // We mock a transaction response shape for the shared logic below
                    tx = {
                        hash: rawWithdrawTxHash,
                        wait: async () => await provider.waitForTransaction(rawWithdrawTxHash)
                    } as any;

                } catch (e) {
                    setIsBridgingLoading(false);
                    setToastState(prev => ({ ...prev, visible: false }));
                    throw e;
                }
            }

            // ... (Rest of function)

            // Gas Estimation Logic (Updated also)
            // ... (Wait, I need to update Gas Estimation separately below)


            logger.log('Transaction sent', { txHash: shortHash(tx.hash) });

            // Show processing toast now that we have the tx
            setToastState({
                visible: true,
                title: 'Processing Transaction',
                message: 'Transaction sent to network. Waiting for confirmation...'
            });

            const receipt = await tx.wait();
            logger.log('Transaction confirmed', {
                status: receipt.status,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed?.toString(),
                gasLimit: receipt.gasLimit?.toString() ?? 'n/a',
            });

            // Validate transaction succeeded on-chain
            if (receipt.status !== 1) {
                const gasUsed = receipt.gasUsed ? Number(receipt.gasUsed) : 0;
                const txHashStr = tx.hash || receipt.hash || '';
                logger.warn('Transaction reverted on-chain', {
                    gasUsed,
                    txHash: shortHash(txHashStr),
                });

                // Try to extract revert reason by replaying the tx via eth_call
                let revertReason = '';
                try {
                    const provider = new ethers.BrowserProvider(window.ethereum);
                    // Replay the failed tx to get the revert data
                    await provider.call({
                        to: receipt.to,
                        from: receipt.from,
                        data: receipt.data || undefined,
                        value: receipt.value || undefined,
                        blockTag: receipt.blockNumber,
                    });
                } catch (replayErr: any) {
                    // The replay should fail with the revert reason
                    const errorName = replayErr.errorName || replayErr.revert?.name;
                    const revertData = replayErr.data || replayErr.error?.data;

                    // Check known error names
                    const knownErrors: Record<string, string> = {
                        'InsufficientCotiFee': 'Not enough COTI to pay the portal fee.',
                        'InsufficientEthBalance': 'Not enough COTI balance to pay gas fees.',
                        'DepositBelowMinimum': 'Deposit amount is below the minimum allowed.',
                        'DepositExceedsMaximum': 'Deposit amount exceeds the maximum allowed.',
                        'WithdrawBelowMinimum': 'Withdrawal amount is below the minimum allowed.',
                        'WithdrawExceedsMaximum': 'Withdrawal amount exceeds the maximum allowed.',
                        'DepositDisabled': 'Deposits are currently disabled for this bridge.',
                        'BridgePaused': 'Bridge is currently paused.',
                        'AmountZero': 'Amount cannot be zero.',
                        'InsufficientBridgeLiquidity': 'Insufficient bridge liquidity.',
                        'TokenTransferFailed': 'Token transfer failed. Check balance and approval.',
                    };

                    if (errorName && knownErrors[errorName]) {
                        revertReason = knownErrors[errorName];
                    } else if (replayErr.reason) {
                        revertReason = replayErr.reason;
                    } else if (replayErr.shortMessage) {
                        revertReason = replayErr.shortMessage;
                    } else if (revertData && typeof revertData === 'string' && revertData.length >= 10) {
                        revertReason = `Revert data: ${revertData.slice(0, 10)}`;
                    }
                }

                const baseMsg = 'Transaction failed on-chain.';
                const detail = revertReason ? ` Reason: ${revertReason}` : '';
                const txLink = txHashStr ? ` TX: ${txHashStr}` : '';
                throw new Error(`${baseMsg}${detail}${txLink}`);
            }

            onProgress?.('transfer-complete', tx.hash);

            // Update balances (simple mock update for UI responsiveness, real fetch should happen too)
            if (txPublicToken && txAmount) {
                const amountNum = parseFloat(txAmount);

                if (txDirection === 'to-private') {
                    setPublicTokens(prev => prev.map(t =>
                        t.symbol === txPublicToken.symbol
                            ? { ...t, balance: formatTokenBalanceDisplay(t.symbol, parseFloat(t.balance) - amountNum) }
                            : t
                    ));
                    setPrivateTokens(prev => prev.map(t =>
                        t.symbol === 'p.' + txPublicToken.symbol
                            ? { ...t, balance: formatTokenBalanceDisplay(t.symbol, parseFloat(t.balance) + amountNum) }
                            : t
                    ));
                } else {
                    setPublicTokens(prev => prev.map(t =>
                        t.symbol === txPublicToken.symbol
                            ? { ...t, balance: formatTokenBalanceDisplay(t.symbol, parseFloat(t.balance) + amountNum) }
                            : t
                    ));
                    setPrivateTokens(prev => prev.map(t =>
                        t.symbol === 'p.' + txPublicToken.symbol
                            ? { ...t, balance: formatTokenBalanceDisplay(t.symbol, parseFloat(t.balance) - amountNum) }
                            : t
                    ));
                }
            }

            if (refreshPrivateBalances) {
                logger.log("🔄 Triggering immediate balance refresh...");
                refreshPrivateBalances().catch(err =>
                    logger.error('Immediate balance refresh failed', err),
                );
            }

            setToastState({
                visible: true,
                title: 'Transaction Successful',
                message: txDirection === 'to-private'
                    ? `Successfully deposited ${txAmount} ${txPublicToken.symbol} to your private balance.`
                    : `Successfully withdrew ${txAmount} ${txPublicToken.symbol} to your public balance.`
            });

        } catch (error: any) {
            logger.error("Transaction failed:", error);

            // In ethers v6, tx.wait() throws CALL_EXCEPTION with receipt attached when tx reverts.
            // Try to decode the custom revert error from the contract ABI.
            if (error.code === 'CALL_EXCEPTION') {
                const revertData = error.data || error.error?.data;
                const errorName = error.errorName || error.revert?.name;
                const gasUsed = error.receipt?.gasUsed ? Number(error.receipt.gasUsed) : 0;
                logger.warn(`⚠️ CALL_EXCEPTION on-chain revert. Error: ${errorName || 'unknown'}, Gas used: ${gasUsed}`);

                // Map known contract custom errors to user-friendly messages
                const knownErrors: Record<string, string> = {
                    'InsufficientCotiFee': 'Not enough COTI to pay the portal fee. Please add COTI to your wallet.',
                    'InsufficientEthBalance': 'Not enough COTI balance to pay gas fees. Please add COTI to your wallet.',
                    'DepositBelowMinimum': 'Deposit amount is below the minimum allowed.',
                    'DepositExceedsMaximum': 'Deposit amount exceeds the maximum allowed.',
                    'WithdrawBelowMinimum': 'Withdrawal amount is below the minimum allowed.',
                    'WithdrawExceedsMaximum': 'Withdrawal amount exceeds the maximum allowed.',
                    'DepositDisabled': 'Deposits are currently disabled for this bridge.',
                    'AmountZero': 'Amount cannot be zero.',
                    'InsufficientBridgeLiquidity': 'Insufficient bridge liquidity. Please try a smaller amount.',
                    'TokenTransferFailed': 'Token transfer failed. Please check your token balance and approval.',
                    'InsufficientAccumulatedFees': 'Insufficient accumulated fees.',
                };

                if (errorName && knownErrors[errorName]) {
                    throw new Error(knownErrors[errorName]);
                }

                // Try to match revert data against known error selectors if errorName wasn't decoded
                if (revertData && typeof revertData === 'string' && revertData.length >= 10) {
                    const selector = revertData.slice(0, 10);
                    const selectorMap: Record<string, string> = {
                        '0x83b5f08b': 'Not enough COTI to pay the portal fee. Please add COTI to your wallet.',
                        '0xb6d6e7d6': 'Not enough COTI balance to pay gas fees. Please add COTI to your wallet.',
                        '0xc24b1b61': 'Deposit amount is below the minimum allowed.',
                        '0xd630062d': 'Deposit amount exceeds the maximum allowed.',
                        '0x0fdbcf37': 'Withdrawal amount is below the minimum allowed.',
                        '0x9aae5367': 'Withdrawal amount exceeds the maximum allowed.',
                        '0xfb291504': 'Deposits are currently disabled for this bridge.',
                        '0xcbca5aa2': 'Amount cannot be zero.',
                        '0xaae25839': 'Insufficient bridge liquidity. Please try a smaller amount.',
                        '0x045c4b02': 'Token transfer failed. Please check your token balance and approval.',
                    };
                    if (selectorMap[selector]) {
                        throw new Error(selectorMap[selector]);
                    }
                }

                // Generic revert — show the raw reason if available
                const reason = error.reason || error.shortMessage || 'Transaction reverted on-chain.';
                throw new Error(reason);
            }

            let errorMessage = error.reason || error.message || "Unknown error occurred";

            if (errorMessage.includes("user rejected")) {
                errorMessage = "Transaction rejected by user.";
            }

            setToastState({
                visible: true,
                title: 'Transaction Failed',
                message: errorMessage
            });
            // Re-throw so the caller (handleSwap) knows it failed
            throw error;
        } finally {
            setIsBridgingLoading(false);
        }
    }, [
        publicTokens,
        walletAddress,
        setPublicTokens,
        setPrivateTokens,
        setToastState,
        refreshPrivateBalances,
        upsertPodRequest,
        podWithdrawPermit,
        setPodWithdrawPermit,
    ]);
  return { executeTransaction, isBridgingLoading };
};
