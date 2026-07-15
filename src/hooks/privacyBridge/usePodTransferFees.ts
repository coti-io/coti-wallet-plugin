import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import { getChainConfig } from '../../chains';
import { quotePodPrivateTokenTransferFees } from '../../chains/portal/executePodPrivateTokenTransfer';
import { logger } from '../../lib/logger';
import type { EIP1193Provider } from '../../lib/ethereum';

export interface UsePodTransferFeesOptions {
  isConnected: boolean;
  walletAddress?: string;
  chainId?: number;
  symbol?: string;
  recipient?: string;
  amount: string;
  enabled?: boolean;
}

/** PoD pToken Send fee quotes — inbox fee + L1 gas in native token. */
export const usePodTransferFees = ({
  isConnected,
  walletAddress,
  chainId,
  symbol,
  recipient,
  amount,
  enabled = true,
}: UsePodTransferFeesOptions) => {
  const { connector } = useAccount();
  const [podInboxFee, setPodInboxFee] = useState<string | null>(null);
  const [l1GasFee, setL1GasFee] = useState<string | null>(null);
  const [feeSymbol, setFeeSymbol] = useState('ETH');
  const [isGasEstimating, setIsGasEstimating] = useState(false);
  const requestId = useRef(0);

  const refreshFees = useCallback(async () => {
    const id = ++requestId.current;

    if (!enabled || !isConnected || !chainId || !walletAddress || !symbol) {
      setPodInboxFee(null);
      setL1GasFee(null);
      return;
    }

    const chainConfig = getChainConfig(chainId);
    if (chainConfig?.portalStrategy !== 'pod-privacy-portal') {
      setPodInboxFee(null);
      setL1GasFee(null);
      return;
    }

    const currentAmount = amount && parseFloat(amount) > 0 ? amount : '0';
    if (currentAmount === '0') {
      if (id === requestId.current) {
        setPodInboxFee(null);
        setL1GasFee(null);
      }
      return;
    }

    setIsGasEstimating(true);
    try {
      if (!connector?.getProvider) {
        if (id === requestId.current) {
          setPodInboxFee(null);
          setL1GasFee(null);
        }
        return;
      }

      const injected = (await connector.getProvider()) as EIP1193Provider | undefined;
      if (!injected?.request) {
        if (id === requestId.current) {
          setPodInboxFee(null);
          setL1GasFee(null);
        }
        return;
      }

      const quote = await quotePodPrivateTokenTransferFees({
        chainId,
        symbol,
        recipient: recipient && ethers.isAddress(recipient) ? recipient : walletAddress,
        amount: currentAmount,
        walletAddress,
        provider: injected,
      });

      logger.debug('[usePodTransferFees] fees quoted', {
        chainId,
        symbol,
        amount: currentAmount,
        podInboxFee: quote.display.podInboxFee,
        l1Gas: quote.display.l1Gas,
      });

      if (id === requestId.current) {
        setFeeSymbol(quote.display.feeSymbol);
        setPodInboxFee(quote.display.podInboxFee === '0' ? null : quote.display.podInboxFee);
        setL1GasFee(quote.display.l1Gas === '0' ? null : quote.display.l1Gas);
      }
    } catch (error) {
      logger.error('Error estimating PoD transfer fees:', error);
      if (id === requestId.current) {
        setPodInboxFee(null);
        setL1GasFee(null);
      }
    } finally {
      if (id === requestId.current) {
        setIsGasEstimating(false);
      }
    }
  }, [enabled, isConnected, chainId, walletAddress, symbol, recipient, amount, connector]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void refreshFees();
    }, 400);
    return () => clearTimeout(timeoutId);
  }, [refreshFees]);

  return {
    podInboxFee,
    l1GasFee,
    feeSymbol,
    isGasEstimating,
    refreshFees,
    isPodChain: getChainConfig(chainId)?.portalStrategy === 'pod-privacy-portal',
  };
};
