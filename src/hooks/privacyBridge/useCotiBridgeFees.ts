import { useState, useCallback, useEffect, useRef } from 'react';
import { getChainConfig } from '../../chains';
import { quoteCotiBridgeFees } from '../../chains/coti-bridge/fees';
import { logger } from '../../lib/logger';
import type { Token } from './types';

export interface UseCotiBridgeFeesOptions {
  isConnected: boolean;
  walletAddress?: string;
  chainId?: number;
  publicTokens: Token[];
  selectedTokenIndex: number;
  direction: 'to-private' | 'to-public';
  amount: string;
}

/** COTI bridge portal + gas fee quotes (isolated from PoD). */
export const useCotiBridgeFees = ({
  isConnected,
  walletAddress,
  chainId,
  publicTokens,
  selectedTokenIndex,
  direction,
  amount,
}: UseCotiBridgeFeesOptions) => {
  const [portalFeeCoti, setPortalFeeCoti] = useState<string | null>(null);
  const [estimatedGasFee, setEstimatedGasFee] = useState<string | null>(null);
  const [feeDebugInfo, setFeeDebugInfo] = useState<{
    cotiLastUpdated: string;
    tokenLastUpdated: string;
    blockTimestamp: string;
  } | null>(null);
  const [isGasEstimating, setIsGasEstimating] = useState(false);
  const requestId = useRef(0);

  const refreshFees = useCallback(async () => {
    const id = ++requestId.current;

    if (!isConnected || !chainId) {
      setPortalFeeCoti(null);
      setEstimatedGasFee(null);
      setFeeDebugInfo(null);
      return;
    }

    const chainConfig = getChainConfig(chainId);
    if (chainConfig?.portalStrategy !== 'coti-bridge') {
      return;
    }

    const symbol = publicTokens[selectedTokenIndex]?.symbol?.replace('p.', '') || '';
    const currentAmount = amount && parseFloat(amount) > 0 ? amount : '0';

    if (currentAmount === '0') {
      if (id === requestId.current) {
        setPortalFeeCoti(null);
        setEstimatedGasFee(null);
        setFeeDebugInfo(null);
      }
      return;
    }

    setIsGasEstimating(true);
    try {
      const quote = await quoteCotiBridgeFees({
        chainId,
        symbol,
        direction,
        amount: currentAmount,
        walletAddress,
      });

      if (id === requestId.current) {
        setPortalFeeCoti(quote.portalFeeCoti);
        setEstimatedGasFee(quote.estimatedGasFee);
        setFeeDebugInfo(quote.feeDebugInfo);
      }
    } catch (error) {
      logger.error('Error estimating COTI bridge fees:', error);
      if (id === requestId.current) {
        setPortalFeeCoti(null);
        setEstimatedGasFee(null);
        setFeeDebugInfo(null);
      }
    } finally {
      if (id === requestId.current) {
        setIsGasEstimating(false);
      }
    }
  }, [direction, isConnected, chainId, walletAddress, selectedTokenIndex, publicTokens, amount]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void refreshFees();
    }, 400);
    return () => clearTimeout(timeoutId);
  }, [refreshFees]);

  return {
    portalFeeCoti,
    estimatedGasFee,
    feeDebugInfo,
    isGasEstimating,
    updateGasFee: refreshFees,
    portalFee: null,
    portalFeeSymbol: 'COTI',
    podInboxFee: null,
    l1GasFee: null,
    isPodChain: false,
  };
};
