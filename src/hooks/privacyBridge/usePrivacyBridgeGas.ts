import { useState, useCallback, useEffect, useRef } from 'react';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from '../../contracts/config';
import { estimatePodPortalGasFeeDisplay } from '../../chains/portal/podGasEstimate';
import { estimateCotiBridgeGasFeeDisplay } from '../../chains/cotiBridgeGasEstimate';
import { estimateBridgeFee } from '../useEstimateBridgeFees';
import { getChainConfig, getPublicTokensForChain, getRpcUrlForChain } from '../../chains';
import { resolveConfiguredAddress } from '../../chains/portal/helpers';
import { logger } from '../../lib/logger';
import type { Token } from './types';

export interface UsePrivacyBridgeGasOptions {
  isConnected: boolean;
  publicTokens: Token[];
  selectedTokenIndex: number;
  direction: 'to-private' | 'to-public';
  amount: string;
}

/** Gas display estimates and on-chain portal fee quotes. */
export const usePrivacyBridgeGas = ({
  isConnected,
  publicTokens,
  selectedTokenIndex,
  direction,
  amount,
}: UsePrivacyBridgeGasOptions) => {
    const [estimatedGasFee, setEstimatedGasFee] = useState<string | null>(null);
    const [isGasEstimating, setIsGasEstimating] = useState(false);

    // Gas Estimation Logic
    const updateGasFee = useCallback(async () => {
        const tokenSymbol = publicTokens[selectedTokenIndex]?.symbol || '';
        if (!isConnected || !window.ethereum) {
            setEstimatedGasFee(null);
            return;
        }

        // Use a fixed reference amount for estimation — gas cost is independent of amount
        // for MPC operations, and using the user's typed amount causes re-estimation on
        // every keystroke which fails mid-type and falls back to the inflated 900k fallback.
        const estimationAmount = "1";

        setIsGasEstimating(true);

        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const network = await provider.getNetwork();
            const currentChainId = Number(network.chainId);
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

            // Get current gas price
            let gasPrice = 1000000000n; // 1 Gwei default
            try {
                const gasPriceHex = await provider.send("eth_gasPrice", []);
                gasPrice = BigInt(gasPriceHex);
            } catch (err) {
                logger.warn("⚠️ eth_gasPrice failed, using default (1 Gwei).");
            }

            if (chainConfig?.portalStrategy === 'pod-privacy-portal') {
                const podDisplay = await estimatePodPortalGasFeeDisplay({
                    provider,
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
                provider,
                currentChainId,
                bridgeAddress,
                symbol,
                direction,
                amountWei,
                gasPrice,
                isErc20Token,
            });
            setEstimatedGasFee(cotiDisplay);

        } catch (error) {
            logger.error("Error estimating gas:", error);
            setEstimatedGasFee(null);
        } finally {
            setIsGasEstimating(false);
        }
    }, [direction, isConnected, selectedTokenIndex, publicTokens]);

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

        if (!isConnected || !window.ethereum) {
            setPortalFeeCoti(null);
            return;
        }
        try {
            const provider = new ethers.BrowserProvider(window.ethereum);
            const network = await provider.getNetwork();
            const chainId = Number(network.chainId);

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
    }, [isConnected, publicTokens, selectedTokenIndex, direction, amount]);

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
