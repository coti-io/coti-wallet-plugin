import { useCallback } from 'react';
import { logger } from '../lib/logger';
import { usePluginBridgeAllowance } from './bridge/usePluginBridgeAllowance';
import { usePluginBridgeExecutor } from './bridge/usePluginBridgeExecutor';
import { usePluginBridgeGas } from './bridge/usePluginBridgeGas';
import type { SwapProgressStage, UsePluginBridgeProps } from './bridge/types';

export type { Token } from './bridge/tokens';
export type { SwapProgressStage } from './bridge/types';
export { getInitialPublicTokens, getInitialPrivateTokens } from './bridge/tokens';

/**
 * Coordinates allowance, execution, gas estimation, and swap entry flow.
 * Sub-hooks mirror the {@link CotiPluginProvider} facade pattern.
 */
export const usePluginBridge = ({
  isConnected,
  walletAddress,
  publicTokens,
  setPublicTokens,
  setPrivateTokens,
  setToastState,
  amount,
  setAmount,
  direction,
  setDirection,
  selectedTokenIndex,
  setSelectedTokenIndex,
  error,
  hasSnap,
  setHasSnap,
  handleOnboard,
  refreshPrivateBalances,
  refreshPublicBalances,
  upsertPodRequest,
  sessionAesKey,
  chainId,
}: UsePluginBridgeProps) => {
  const allowance = usePluginBridgeAllowance({
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
  });

  const { executeTransaction, isBridgingLoading } = usePluginBridgeExecutor({
    walletAddress,
    publicTokens,
    setPublicTokens,
    setPrivateTokens,
    setToastState,
    refreshPrivateBalances,
    refreshPublicBalances,
    upsertPodRequest,
    getPodWithdrawPermit: allowance.getPodWithdrawPermit,
    clearPodWithdrawPermit: allowance.clearPodWithdrawPermit,
  });

  const gas = usePluginBridgeGas({
    isConnected,
    walletAddress,
    chainId,
    publicTokens,
    selectedTokenIndex,
    direction,
    amount,
  });

  const handleSwap = useCallback(
    async (
      overrideAmount?: string,
      overrideDirection?: 'to-private' | 'to-public',
      overrideTokenIndex?: number,
      onProgress?: (stage: SwapProgressStage, txHash?: string) => void,
    ) => {
      const currentAmount = overrideAmount !== undefined ? overrideAmount : amount;
      const currentDirection = overrideDirection !== undefined ? overrideDirection : direction;
      const currentIndex = overrideTokenIndex !== undefined ? overrideTokenIndex : selectedTokenIndex;

      const currentAmountNum = parseFloat(currentAmount);

      logger.log('🚀 [handleSwap] Entry:', {
        currentAmount,
        currentDirection,
        currentIndex,
        hasSnap,
        sessionAesKeyAvailable: !!sessionAesKey,
        isBridgingLoading,
        error: !!error,
      });

      if (!currentAmount || !!error || currentAmountNum <= 0) return;

      if (isBridgingLoading) {
        logger.warn('Transaction already in progress, ignoring duplicate submission.');
        return;
      }

      const currentPub = publicTokens[currentIndex];
      const isErc20Token =
        ['WETH', 'WBTC', 'USDT', 'USDC.e', 'WADA', 'gCOTI'].includes(currentPub?.symbol ?? '') ||
        !!currentPub?.addressKey;
      const isPodPortalToken = currentPub?.symbol === 'MTT';
      const aesKeyRequired = !isPodPortalToken && (currentDirection === 'to-public' || !isErc20Token);

      logger.log('🔑 [handleSwap] AES key gate check:', {
        tokenSymbol: currentPub?.symbol,
        isErc20Token,
        isPodPortalToken,
        aesKeyRequired,
        hasSnap,
        sessionAesKeyAvailable: !!sessionAesKey,
      });

      if (aesKeyRequired && !hasSnap) {
        // If session AES key is already available (manual entry or contract onboarding),
        // bypass any interactive flow entirely.
        if (sessionAesKey) {
          logger.log('🔑 [handleSwap] Session AES key available — bypassing key gate');
          setHasSnap(true);
        } else {
          // No session key available. The user must unlock via the appropriate modal.
          // Do NOT call getAESKeyFromSnap here — it only works for MetaMask wallets
          // and will fail with "COTI Snap is not installed" for Rabby/Phantom/Trust.
          logger.log('⚠️ [handleSwap] No AES key in session — requesting unlock');
          throw new Error('AES key not available. Please unlock your private tokens first.');
        }
      }

      logger.log('✅ [handleSwap] Gate passed, executing transaction...');

      if (overrideAmount !== undefined) setAmount(overrideAmount);
      if (overrideDirection !== undefined) setDirection(overrideDirection);
      if (overrideTokenIndex !== undefined) setSelectedTokenIndex(overrideTokenIndex);

      await executeTransaction(currentAmount, currentDirection, currentIndex, onProgress);
    },
    [
      amount,
      direction,
      selectedTokenIndex,
      error,
      hasSnap,
      isBridgingLoading,
      setAmount,
      setDirection,
      setSelectedTokenIndex,
      setHasSnap,
      executeTransaction,
      publicTokens,
      sessionAesKey,
    ],
  );

  return {
    executeTransaction,
    handleSwap,
    isBridgingLoading,
    allowance: allowance.allowance,
    isApproving: allowance.isApproving,
    handleApprove: allowance.handleApprove,
    checkAllowance: allowance.checkAllowance,
    isApprovalNeeded: allowance.isApprovalNeeded,
    estimatedGasFee: gas.estimatedGasFee,
    updateGasFee: gas.updateGasFee,
    isGasEstimating: gas.isGasEstimating,
    portalFeeCoti: gas.portalFeeCoti,
    portalFee: gas.portalFee,
    portalFeeSymbol: gas.portalFeeSymbol,
    podInboxFee: gas.podInboxFee,
    l1GasFee: gas.l1GasFee,
    isPodChain: gas.isPodChain,
    feeDebugInfo: gas.feeDebugInfo,
  };
};
