import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from '../../contracts/config';
import { estimateCotiBridgeGasFeeDisplay } from '../../chains/cotiBridgeGasEstimate';
import { estimateBridgeFee } from '../useEstimateBridgeFees';
import { getChainConfig, getPublicTokensForChain, getPrivateTokensForChain, getRpcUrlForChain } from '../../chains';
import { resolveConfiguredAddress, resolvePodPortalAddresses } from '../../chains/portal/helpers';
import {
  estimatePodPortalFees,
  formatPortalFeeDisplay,
  quotePortalFeeOnly,
} from '../../chains/portal/podPortalFees';
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

    const updateGasFee = useCallback(async () => {
        const tokenSymbol = publicTokens[selectedTokenIndex]?.symbol || '';
        if (!isConnected || !chainId) {
            setEstimatedGasFee(null);
            return;
        }

        const currentChainId = chainId;
        const chainConfig = getChainConfig(currentChainId);

        if (chainConfig?.portalStrategy === 'pod-privacy-portal') {
            if (!walletAddress) {
                setEstimatedGasFee(null);
                return;
            }

            const currentAmount = amount && parseFloat(amount) > 0 ? amount : '0';
            if (currentAmount === '0') {
                setEstimatedGasFee(null);
                return;
            }

            setIsGasEstimating(true);
            try {
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

                const addresses = CONTRACT_ADDRESSES[currentChainId];
                const symbol = tokenSymbol.replace('p.', '');
                const pubTok = getPublicTokensForChain(currentChainId).find(
                    t => t.symbol === symbol && !t.isPrivate,
                );
                const privTok = getPrivateTokensForChain(currentChainId).find(
                    t => t.symbol === `p.${symbol}`,
                );
                const resolved = pubTok && addresses
                    ? resolvePodPortalAddresses({ addresses, pubCfg: pubTok, privCfg: privTok })
                    : null;
                if (!resolved) {
                    setEstimatedGasFee(null);
                    return;
                }

                const signer = await podProvider.getSigner();
                const estimate = await estimatePodPortalFees({
                    runner: signer,
                    chainId: currentChainId,
                    portalAddress: resolved.portalAddress,
                    pubTok,
                    amount: currentAmount,
                    direction,
                });
                logger.debug("[usePrivacyBridgeGas] PoD fee estimated", {
                    chainId: currentChainId,
                    symbol,
                    direction,
                    amount: currentAmount,
                    portalFeeDisplay: estimate.portalFeeDisplay,
                    podFeeDisplay: estimate.podFeeDisplay,
                    portalAddress: resolved.portalAddress,
                });
                setEstimatedGasFee(estimate.podFeeDisplay);
            } catch (error) {
                logger.error("Error estimating PoD fee:", error);
                setEstimatedGasFee(null);
            } finally {
                setIsGasEstimating(false);
            }
            return;
        }

        const estimationAmount = "1";
        setIsGasEstimating(true);

        try {
            const rpcUrl = getRpcUrlForChain(currentChainId);
            const readProvider = new ethers.JsonRpcProvider(rpcUrl, currentChainId);
            const addresses = CONTRACT_ADDRESSES[currentChainId];

            if (!addresses) {
                setIsGasEstimating(false);
                return;
            }

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
            const isNight = symbol === 'NIGHT';
            const isErc20Token = isWeth || isWbtc || isUsdt || isUsdcE || isWada || isGCoti || isNight;

            let publicDecimals = pubTok?.decimals ?? 18;
            let privateDecimals = pubTok?.decimals ?? 18;
            if (!pubTok) {
                if (isWbtc) { publicDecimals = 8; privateDecimals = 8; }
                else if (isUsdt || isUsdcE || isWada) { publicDecimals = 6; privateDecimals = 6; }
            }

            const decimals = direction === 'to-private' ? publicDecimals : privateDecimals;
            const amountWei = ethers.parseUnits(estimationAmount, decimals);

            let gasPrice = 1000000000n;
            try {
                const gasPriceHex = await readProvider.send("eth_gasPrice", []);
                gasPrice = BigInt(gasPriceHex);
            } catch (err) {
                logger.warn("⚠️ eth_gasPrice failed, using default (1 Gwei).");
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
    }, [direction, isConnected, chainId, walletAddress, selectedTokenIndex, publicTokens, connector, amount]);

    useEffect(() => {
        const timeoutId = setTimeout(() => {
            updateGasFee();
        }, 500);

        return () => clearTimeout(timeoutId);

    }, [updateGasFee]);

    const [portalFeeCoti, setPortalFeeCoti] = useState<string | null>(null);
    const [feeDebugInfo, setFeeDebugInfo] = useState<{ cotiLastUpdated: string; tokenLastUpdated: string; blockTimestamp: string } | null>(null);
    const feeRequestId = useRef(0);

    const fetchPortalFee = useCallback(async () => {
        const requestId = ++feeRequestId.current;

        if (!isConnected || !chainId) {
            setPortalFeeCoti(null);
            return;
        }

        const symbol = publicTokens[selectedTokenIndex]?.symbol?.replace('p.', '') || '';
        const currentAmount = amount && parseFloat(amount) > 0 ? amount : '0';

        if (currentAmount === '0') {
            if (requestId === feeRequestId.current) {
                setPortalFeeCoti(null);
                setFeeDebugInfo(null);
            }
            return;
        }

        const chainConfig = getChainConfig(chainId);

        try {
            if (chainConfig?.portalStrategy === 'pod-privacy-portal') {
                if (!connector?.getProvider) {
                    if (requestId === feeRequestId.current) {
                        setPortalFeeCoti(null);
                        setFeeDebugInfo(null);
                    }
                    return;
                }

                const injected = await connector.getProvider() as EIP1193Provider | undefined;
                if (!injected?.request) {
                    if (requestId === feeRequestId.current) {
                        setPortalFeeCoti(null);
                        setFeeDebugInfo(null);
                    }
                    return;
                }

                const podProvider = new ethers.BrowserProvider(injected);
                const addresses = CONTRACT_ADDRESSES[chainId];
                const pubTok = getPublicTokensForChain(chainId).find(
                    t => t.symbol === symbol && !t.isPrivate,
                );
                const privTok = getPrivateTokensForChain(chainId).find(
                    t => t.symbol === `p.${symbol}`,
                );
                const resolved = pubTok && addresses
                    ? resolvePodPortalAddresses({ addresses, pubCfg: pubTok, privCfg: privTok })
                    : null;

                if (!resolved) {
                    if (requestId === feeRequestId.current) {
                        setPortalFeeCoti(null);
                        setFeeDebugInfo(null);
                    }
                    return;
                }

                const signer = await podProvider.getSigner();
                const dec = pubTok?.decimals ?? 18;
                const amountWei = ethers.parseUnits(currentAmount, dec);
                const quote = await quotePortalFeeOnly(
                    signer,
                    resolved.portalAddress,
                    amountWei,
                    direction,
                );
                const display = formatPortalFeeDisplay(quote.portalFee, quote.usedDynamicPricing);
                logger.debug("[usePrivacyBridgeGas] portal fee quoted", {
                    chainId,
                    symbol,
                    direction,
                    amount: currentAmount,
                    portalAddress: resolved.portalAddress,
                    portalFeeWei: quote.portalFee.toString(),
                    display,
                    usedDynamicPricing: quote.usedDynamicPricing,
                });

                if (requestId === feeRequestId.current) {
                    setPortalFeeCoti(display === '0' ? null : display);
                    setFeeDebugInfo(null);
                }
                return;
            }

            const rpcUrl = getRpcUrlForChain(chainId);
            const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);

            const feeEstimate = await estimateBridgeFee(symbol, currentAmount, rpcProvider);
            const fee = direction === 'to-private' ? feeEstimate.depositFee : feeEstimate.withdrawFee;

            if (fee === 'Error') {
                if (requestId === feeRequestId.current) {
                    setPortalFeeCoti(null);
                    setFeeDebugInfo(null);
                }
                return;
            }

            const display = fee.replace(/\.?0+$/, '') || '0';
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
    }, [isConnected, chainId, publicTokens, selectedTokenIndex, direction, amount, connector]);

    useEffect(() => {
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
