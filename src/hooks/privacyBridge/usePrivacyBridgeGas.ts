import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from '../../contracts/config';
import { estimatePodPortalGasFeeDisplay } from '../../chains/portal/podGasEstimate';
import { estimateCotiBridgeGasFeeDisplay } from '../../chains/cotiBridgeGasEstimate';
import { estimateBridgeFee } from '../useEstimateBridgeFees';
import { getChainConfig, getPublicTokensForChain, getRpcUrlForChain } from '../../chains';
import { resolveConfiguredAddress } from '../../chains/portal/helpers';
import { logger } from '../../lib/logger';
import type { EIP1193Provider } from '../../lib/ethereum';
import type { Token } from './types';

export interface UsePrivacyBridgeGasOptions {
  isConnected: boolean;
  walletAddress?: string;
  chainId?: number;
  publicTokens: Token[];
  selectedTokenIndex: number;
  direction: 'to-private' | 'to-public';
  amount: string;
}

/** Gas display estimates and on-chain portal fee quotes. */
export const usePrivacyBridgeGas = ({
  isConnected,
  walletAddress,
  chainId,
  publicTokens,
  selectedTokenIndex,
  direction,
  amount,
}: UsePrivacyBridgeGasOptions) => {
    const { connector } = useAccount();
    const [estimatedGasFee, setEstimatedGasFee] = useState<string | null>(null);
    const [isGasEstimating, setIsGasEstimating] = useState(false);

    // Gas Estimation Logic
    const updateGasFee = useCallback(async () => {
        const tokenSymbol = publicTokens[selectedTokenIndex]?.symbol || '';
        if (!isConnected || !chainId) {
            setEstimatedGasFee(null);
            return;
        }

        // Use a fixed reference amount for estimation — gas cost is independent of amount
        // for MPC operations, and using the user's typed amount causes re-estimation on
        // every keystroke which fails mid-type and falls back to the inflated 900k fallback.
        const estimationAmount = "1";

        setIsGasEstimating(true);

        try {
            const currentChainId = chainId;
            const rpcUrl = getRpcUrlForChain(currentChainId);
            const readProvider = new ethers.JsonRpcProvider(rpcUrl, currentChainId);
            const addresses = CONTRACT_ADDRESSES[currentChainId];

            if (!addresses) {
                setIsGasEstimating(false);
                return;
            }

            const chainConfig = getChainConfig(currentChainId);
            const symbol = tokenSymbol.replace('p.', '');
            const pubTok = getPublicTokensForChain(currentChainId).find(
                t => t.symbol === symbol && !t.isPrivate
            );

            let bridgeAddress: string | undefined = resolveConfiguredAddress(
                addresses,
                pubTok?.bridgeAddressKey,
            );

            if (!bridgeAddress) {
                const isWeth = symbol === 'WETH';
                const isWbtc = symbol === 'WBTC';
                const isUsdt = symbol === 'USDT';
                const isUsdcE = symbol === 'USDC.e';
                const isWada = symbol === 'WADA';
                const isGCoti = symbol === 'gCOTI';
                if (isWeth) bridgeAddress = addresses.PrivacyBridgeWETH;
                else if (isWbtc) bridgeAddress = addresses.PrivacyBridgeWBTC;
                else if (isUsdt) bridgeAddress = addresses.PrivacyBridgeUSDT;
                else if (isUsdcE) bridgeAddress = addresses.PrivacyBridgeUSDCe;
                else if (isWada) bridgeAddress = addresses.PrivacyBridgeWADA;
                else if (isGCoti) bridgeAddress = addresses.PrivacyBridgegCOTI;
                else bridgeAddress = addresses.PrivacyBridgeCotiNative;
            }

            if (!bridgeAddress) {
                setIsGasEstimating(false);
                return;
            }

            const isWeth = symbol === 'WETH';
            const isWbtc = symbol === 'WBTC';
            const isUsdt = symbol === 'USDT';
            const isUsdcE = symbol === 'USDC.e';
            const isWada = symbol === 'WADA';
            const isGCoti = symbol === 'gCOTI';
            const isErc20Token = isWeth || isWbtc || isUsdt || isUsdcE || isWada || isGCoti;

            let publicDecimals = pubTok?.decimals ?? 18;
            let privateDecimals = pubTok?.decimals ?? 18;
            if (!pubTok) {
                if (isWbtc) { publicDecimals = 8; privateDecimals = 8; }
                else if (isUsdt || isUsdcE || isWada) { publicDecimals = 6; privateDecimals = 6; }
            }

            const decimals = direction === 'to-private' ? publicDecimals : privateDecimals;
            const amountWei = ethers.parseUnits(estimationAmount, decimals);

            // Get current gas price via RPC — avoid window.ethereum (may be hijacked by Rabby).
            let gasPrice = 1000000000n; // 1 Gwei default
            try {
                const gasPriceHex = await readProvider.send("eth_gasPrice", []);
                gasPrice = BigInt(gasPriceHex);
            } catch (err) {
                logger.warn("⚠️ eth_gasPrice failed, using default (1 Gwei).");
            }

            if (chainConfig?.portalStrategy === 'pod-privacy-portal') {
                if (!walletAddress) {
                    setEstimatedGasFee(null);
                    return;
                }
                let podProvider: ethers.BrowserProvider | null = null;
                if (connector?.getProvider) {
                    try {
                        const injected = await connector.getProvider() as EIP1193Provider | undefined;
                        if (injected?.request) {
                            podProvider = new ethers.BrowserProvider(injected);
                        }
                    } catch {
                        /* fall through */
                    }
                }
                if (!podProvider) {
                    setEstimatedGasFee(null);
                    return;
                }
                const podDisplay = await estimatePodPortalGasFeeDisplay({
                    provider: podProvider,
                    currentChainId,
                    addresses,
                    symbol,
                    direction,
                    bridgeAddress,
                    pubTok,
                    estimationAmount,
                });
                setEstimatedGasFee(podDisplay);
                return;
            }

            const cotiDisplay = await estimateCotiBridgeGasFeeDisplay({
                provider: readProvider as unknown as ethers.BrowserProvider,
                currentChainId,
                bridgeAddress,
                symbol,
                direction,
                amountWei,
                gasPrice,
                isErc20Token,
                fromAddress: walletAddress,
            });
            setEstimatedGasFee(cotiDisplay);

        } catch (error) {
            logger.error("Error estimating gas:", error);
            setEstimatedGasFee(null);
        } finally {
            setIsGasEstimating(false);
        }
    }, [direction, isConnected, chainId, walletAddress, selectedTokenIndex, publicTokens, connector]);

    // Debounce estimation on dependency change
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            updateGasFee();
        }, 500);

        return () => clearTimeout(timeoutId);

    }, [updateGasFee]);

    // Portal Fee State — computed fee in COTI for the current amount/token/direction
    const [portalFeeCoti, setPortalFeeCoti] = useState<string | null>(null);
    const [feeDebugInfo, setFeeDebugInfo] = useState<{ cotiLastUpdated: string; tokenLastUpdated: string; blockTimestamp: string } | null>(null);
    const feeRequestId = useRef(0);

    const fetchPortalFee = useCallback(async () => {
        const requestId = ++feeRequestId.current;

        if (!isConnected || !chainId) {
            setPortalFeeCoti(null);
            return;
        }
        try {
            const rpcUrl = getRpcUrlForChain(chainId);
            const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);

            const symbol = publicTokens[selectedTokenIndex]?.symbol?.replace('p.', '') || '';
            const currentAmount = amount && parseFloat(amount) > 0 ? amount : '0';

            // Skip on-chain call for zero amounts — contract reverts with AmountZero
            if (currentAmount === '0') {
                if (requestId === feeRequestId.current) {
                    setPortalFeeCoti(null);
                    setFeeDebugInfo(null);
                }
                return;
            }

            const feeEstimate = await estimateBridgeFee(symbol, currentAmount, rpcProvider);
            const fee = direction === 'to-private' ? feeEstimate.depositFee : feeEstimate.withdrawFee;

            if (fee === 'Error') {
                if (requestId === feeRequestId.current) {
                    setPortalFeeCoti(null);
                    setFeeDebugInfo(null);
                }
                return;
            }

            // Strip trailing zeros
            const display = fee.replace(/\.?0+$/, '') || '0';
            // Only update if this is still the latest request
            if (requestId === feeRequestId.current) {
                setPortalFeeCoti(display === '0' ? null : display);
                setFeeDebugInfo({
                    cotiLastUpdated: feeEstimate.cotiLastUpdated,
                    tokenLastUpdated: feeEstimate.tokenLastUpdated,
                    blockTimestamp: feeEstimate.blockTimestamp,
                });
            }
        } catch (e) {
            logger.warn("Could not fetch portal fee", e);
            if (requestId === feeRequestId.current) {
                setPortalFeeCoti(null);
                setFeeDebugInfo(null);
            }
        }
    }, [isConnected, chainId, publicTokens, selectedTokenIndex, direction, amount]);

    useEffect(() => {
        // Debounce portal fee calculation to avoid race conditions
        // when the user types quickly (prevents showing min fee then correct fee)
        const timeoutId = setTimeout(() => {
            fetchPortalFee();
        }, 400);

        return () => clearTimeout(timeoutId);
    }, [fetchPortalFee]);
  return {
    estimatedGasFee,
    updateGasFee,
    isGasEstimating,
    portalFeeCoti,
    feeDebugInfo,
  };
};
