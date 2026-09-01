import { useState, useCallback, useEffect, useRef } from 'react';
import { useAccount } from 'wagmi';
import { ethers } from 'ethers';
import { CONTRACT_ADDRESSES } from '../../contracts/config';
import { getChainConfig, getPublicTokensForChain, getPrivateTokensForChain } from '../../chains';
import { resolvePodPortalAddresses } from '../../chains/portal/helpers';
import { quotePodPortalTransactionFees } from '../../chains/portal/fees';
import { logger } from '../../lib/logger';
import type { EIP1193Provider } from '../../lib/ethereum';
import type { Token } from './types';

export interface UsePodPortalFeesOptions {
  isConnected: boolean;
  walletAddress?: string;
  chainId?: number;
  publicTokens: Token[];
  selectedTokenIndex: number;
  direction: 'to-private' | 'to-public';
  amount: string;
}

/** PoD Privacy Portal fee quotes — portal, inbox, and L1 gas in native token. */
export const usePodPortalFees = ({
  isConnected,
  walletAddress,
  chainId,
  publicTokens,
  selectedTokenIndex,
  direction,
  amount,
}: UsePodPortalFeesOptions) => {
  const { connector } = useAccount();
  const [portalFee, setPortalFee] = useState<string | null>(null);
  const [portalFeeSymbol, setPortalFeeSymbol] = useState('ETH');
  const [podInboxFee, setPodInboxFee] = useState<string | null>(null);
  const [l1GasFee, setL1GasFee] = useState<string | null>(null);
  const [isGasEstimating, setIsGasEstimating] = useState(false);
  const requestId = useRef(0);

  const refreshFees = useCallback(async () => {
    const id = ++requestId.current;

    if (!isConnected || !chainId || !walletAddress) {
      setPortalFee(null);
      setPodInboxFee(null);
      setL1GasFee(null);
      return;
    }

    const chainConfig = getChainConfig(chainId);
    if (chainConfig?.portalStrategy !== 'pod-privacy-portal') {
      return;
    }

    const tokenSymbol = publicTokens[selectedTokenIndex]?.symbol || '';
    const symbol = tokenSymbol.replace('p.', '');
    const currentAmount = amount && parseFloat(amount) > 0 ? amount : '0';

    if (currentAmount === '0') {
      if (id === requestId.current) {
        setPortalFee(null);
        setPodInboxFee(null);
        setL1GasFee(null);
      }
      return;
    }

    setIsGasEstimating(true);
    try {
      if (!connector?.getProvider) {
        if (id === requestId.current) {
          setPortalFee(null);
          setPodInboxFee(null);
          setL1GasFee(null);
        }
        return;
      }

      const injected = await connector.getProvider() as EIP1193Provider | undefined;
      if (!injected?.request) {
        if (id === requestId.current) {
          setPortalFee(null);
          setPodInboxFee(null);
          setL1GasFee(null);
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
        if (id === requestId.current) {
          setPortalFee(null);
          setPodInboxFee(null);
          setL1GasFee(null);
        }
        return;
      }

      const signer = await podProvider.getSigner();
      const quote = await quotePodPortalTransactionFees({
        runner: signer,
        chainId,
        portalAddress: resolved.portalAddress,
        pubTok,
        amount: currentAmount,
        direction,
      });

      logger.debug('[usePodPortalFees] fees quoted', {
        chainId,
        symbol,
        direction,
        amount: currentAmount,
        portalFee: quote.display.portalFee,
        podInboxFee: quote.display.podInboxFee,
        l1Gas: quote.display.l1Gas,
      });

      if (id === requestId.current) {
        setPortalFeeSymbol(quote.display.portalFeeSymbol);
        setPortalFee(quote.display.portalFee === '0' ? null : quote.display.portalFee);
        setPodInboxFee(quote.display.podInboxFee === '0' ? null : quote.display.podInboxFee);
        setL1GasFee(quote.display.l1Gas === '0' ? null : quote.display.l1Gas);
      }
    } catch (error) {
      logger.error('Error estimating PoD portal fees:', error);
      if (id === requestId.current) {
        setPortalFee(null);
        setPodInboxFee(null);
        setL1GasFee(null);
      }
    } finally {
      if (id === requestId.current) {
        setIsGasEstimating(false);
      }
    }
  }, [direction, isConnected, chainId, walletAddress, selectedTokenIndex, publicTokens, connector, amount]);

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      void refreshFees();
    }, 400);
    return () => clearTimeout(timeoutId);
  }, [refreshFees]);

  return {
    portalFee,
    portalFeeSymbol,
    podInboxFee,
    l1GasFee,
    isGasEstimating,
    refreshFees,
    portalFeeCoti: null,
    estimatedGasFee: l1GasFee,
    updateGasFee: refreshFees,
    feeDebugInfo: null,
    isPodChain: true,
  };
};
