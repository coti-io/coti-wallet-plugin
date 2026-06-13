import { useCallback } from 'react';
import { logger } from '../lib/logger';
import { usePrivacyBridgeAllowance } from './privacyBridge/usePrivacyBridgeAllowance';
import { usePrivacyBridgeExecutor } from './privacyBridge/usePrivacyBridgeExecutor';
import { usePrivacyBridgeGas } from './privacyBridge/usePrivacyBridgeGas';
import type { SwapProgressStage, UsePrivacyBridgeProps } from './privacyBridge/types';

export type { Token } from './privacyBridge/tokens';
export type { SwapProgressStage } from './privacyBridge/types';
export { getInitialPublicTokens, getInitialPrivateTokens } from './privacyBridge/tokens';

/**
 * Coordinates allowance, execution, gas estimation, and swap entry flow.
 * Sub-hooks mirror the {@link PrivacyBridgeProvider} facade pattern.
 */
export const usePrivacyBridge = ({
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
  getAESKeyFromSnap,
  handleOnboard,
  refreshPrivateBalances,
  upsertPodRequest,
}: UsePrivacyBridgeProps) => {
  const allowance = usePrivacyBridgeAllowance({
    isConnected,
    walletAddress,
    publicTokens,
    amount,
    direction,
    selectedTokenIndex,
    hasSnap,
    getAESKeyFromSnap,
    setToastState,
  });

  const { executeTransaction, isBridgingLoading } = usePrivacyBridgeExecutor({
    walletAddress,
    publicTokens,
    setPublicTokens,
    setPrivateTokens,
    setToastState,
    refreshPrivateBalances,
    upsertPodRequest,
    podWithdrawPermit: allowance.podWithdrawPermit,
    setPodWithdrawPermit: allowance.setPodWithdrawPermit,
  });

  const gas = usePrivacyBridgeGas({
    isConnected,
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
      const snapRequired = !isPodPortalToken && (currentDirection === 'to-public' || !isErc20Token);

      if (snapRequired && !hasSnap) {
        try {
          const aesKey = await getAESKeyFromSnap(walletAddress);
          if (aesKey) {
            setHasSnap(true);
          } else {
            logger.log('Snap connection failed or rejected in handleSwap');
            throw new Error('Snap connection failed or rejected');
          }
        } catch (snapErr: any) {
          if (
            snapErr.message &&
            (snapErr.message.includes('AES key not found') || snapErr.message.includes('onboarding'))
          ) {
            logger.log('Missing AES Key detected. Triggering onboarding...');
            setToastState({
              visible: true,
              title: 'Missing AES Key',
              message: 'For your security, you need to generate an AES key. Triggering onboarding...',
            });

            await handleOnboard();
            const retryKey = await getAESKeyFromSnap(walletAddress);
            if (retryKey) {
              setHasSnap(true);
            } else {
              throw new Error('Onboarding incomplete or key retrieval failed after onboarding.');
            }
          } else {
            throw snapErr;
          }
        }
      }

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
      getAESKeyFromSnap,
      executeTransaction,
      handleOnboard,
      walletAddress,
      publicTokens,
      setToastState,
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
    feeDebugInfo: gas.feeDebugInfo,
  };
};
