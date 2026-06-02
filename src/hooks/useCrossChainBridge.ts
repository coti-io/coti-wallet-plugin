import { useState, useCallback } from 'react';
import { useAccount, useSendTransaction, useWriteContract, usePublicClient } from 'wagmi';
import { erc20Abi, parseEther } from 'viem';
import { getCrossChainTokenConfig } from '../config/crossChainTokens';

/**
 * Typed error codes for cross-chain bridge operations.
 */
export interface BridgeError {
  code:
    | 'DAILY_LIMIT_EXCEEDED'
    | 'BELOW_MINIMUM'
    | 'INSUFFICIENT_BALANCE'
    | 'GAS_ESTIMATION_FAILED'
    | 'TRANSACTION_FAILED'
    | 'UNSUPPORTED_TOKEN';
  message: string;
  details?: {
    remainingAllowance?: string;
    requiredMinimum?: string;
    currentBalance?: string;
  };
}

/**
 * Result interface for the `useCrossChainBridge` hook.
 */
export interface UseCrossChainBridgeResult {
  /** Bridges native token (e.g., COTI) to the configured recipient address. */
  bridgeNative: (amount: bigint, tokenId: string) => Promise<void>;
  /** Bridges an ERC20 token to the configured recipient address via transfer(). */
  bridgeERC20: (amount: bigint, tokenId: string, tokenAddress: `0x${string}`) => Promise<void>;
  /** Whether a bridge transaction is currently in progress. */
  isLoading: boolean;
  /** The last bridge error, or null if no error. */
  error: BridgeError | null;
  /** The transaction hash of the last submitted bridge transaction, or null. */
  txHash: string | null;
}

/** Cap Meter API base URL */
const CAP_METER_API_BASE = 'https://bridge-api.coti.io';

/** Minimum amount in wei (0.001 tokens = 10^15 wei for 18-decimal tokens) */
const MINIMUM_AMOUNT_WEI = BigInt('1000000000000000'); // 0.001 * 10^18

/** Gas estimation buffer multiplier (120%) */
const GAS_BUFFER_NUMERATOR = 12n;
const GAS_BUFFER_DENOMINATOR = 10n;

/** Fallback gas limit when estimation fails */
const FALLBACK_GAS_LIMIT = BigInt(12_000_000);

/**
 * Fetches the user's remaining daily limit from the Cap Meter API.
 * Returns the remaining limit as a bigint in wei, or null on failure.
 */
async function fetchUserDailyLimit(
  walletAddress: string,
  tokenId: string,
): Promise<bigint | null> {
  try {
    const response = await fetch(
      `${CAP_METER_API_BASE}/api/v1/limits/user/${walletAddress}/${tokenId}`,
    );
    if (!response.ok) return null;

    const data = await response.json();
    const remaining = data.remainingLimit ?? data.limit ?? '0';
    // The API returns human-readable token amounts; convert to wei
    return parseEther(String(remaining));
  } catch {
    // On failure, return null (graceful degradation — skip limit check)
    return null;
  }
}

/**
 * Hook for executing cross-chain bridge transactions (native and ERC20).
 *
 * Provides `bridgeNative` and `bridgeERC20` functions with pre-validation:
 * - Checks if the token is supported via `getCrossChainTokenConfig`
 * - Checks daily limit via Cap Meter API
 * - Checks minimum amount
 * - Checks wallet balance vs amount + gas
 *
 * Gas estimation uses a 1.2x buffer; falls back to 12,000,000 on failure.
 *
 * @example
 * ```tsx
 * const { bridgeNative, bridgeERC20, isLoading, error, txHash } = useCrossChainBridge();
 *
 * // Bridge native COTI
 * await bridgeNative(parseEther('10'), 'COTI');
 *
 * // Bridge ERC20 gCOTI
 * await bridgeERC20(parseEther('5'), 'gCOTI', '0x...');
 * ```
 */
export function useCrossChainBridge(): UseCrossChainBridgeResult {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<BridgeError | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  /**
   * Validates pre-conditions before submitting a bridge transaction.
   * Returns a BridgeError if validation fails, or null if all checks pass.
   */
  const preValidate = useCallback(
    async (
      amount: bigint,
      tokenId: string,
      isNative: boolean,
      estimatedGasCost: bigint,
    ): Promise<BridgeError | null> => {
      if (!chainId || !address) {
        return {
          code: 'TRANSACTION_FAILED',
          message: 'Wallet is not connected',
        };
      }

      // 1. Check if token is supported
      const tokenConfig = getCrossChainTokenConfig(tokenId, chainId);
      if (!tokenConfig) {
        return {
          code: 'UNSUPPORTED_TOKEN',
          message: `Token "${tokenId}" is not supported for cross-chain bridge on chain ${chainId}`,
        };
      }

      // 2. Check minimum amount (0.001 tokens for 18-decimal tokens, scaled for others)
      const minAmount =
        tokenConfig.decimals === 18
          ? MINIMUM_AMOUNT_WEI
          : BigInt(10) ** BigInt(Math.max(0, tokenConfig.decimals - 3));

      if (amount < minAmount) {
        const minReadable = `0.001`;
        return {
          code: 'BELOW_MINIMUM',
          message: `Amount is below the minimum of ${minReadable} ${tokenConfig.symbol}`,
          details: {
            requiredMinimum: minAmount.toString(),
          },
        };
      }

      // 3. Check daily limit via Cap Meter API
      const remainingLimit = await fetchUserDailyLimit(address, tokenId);
      if (remainingLimit !== null && amount > remainingLimit) {
        return {
          code: 'DAILY_LIMIT_EXCEEDED',
          message: `Transfer amount exceeds your daily limit. Remaining: ${remainingLimit.toString()}`,
          details: {
            remainingAllowance: remainingLimit.toString(),
          },
        };
      }

      // 4. Check wallet balance vs amount + gas
      if (publicClient) {
        try {
          if (isNative) {
            // For native transfers, balance must cover amount + gas
            const balance = await publicClient.getBalance({ address });
            const totalRequired = amount + estimatedGasCost;
            if (balance < totalRequired) {
              return {
                code: 'INSUFFICIENT_BALANCE',
                message:
                  'Insufficient balance for this transfer including gas fees',
                details: {
                  currentBalance: balance.toString(),
                },
              };
            }
          } else {
            // For ERC20 transfers, need native balance for gas + ERC20 balance for amount
            const nativeBalance = await publicClient.getBalance({ address });
            if (nativeBalance < estimatedGasCost) {
              return {
                code: 'INSUFFICIENT_BALANCE',
                message:
                  'Insufficient balance for this transfer including gas fees',
                details: {
                  currentBalance: nativeBalance.toString(),
                },
              };
            }
          }
        } catch {
          // If balance check fails, proceed anyway (graceful degradation)
        }
      }

      return null;
    },
    [chainId, address, publicClient],
  );

  /**
   * Estimates gas for a native transfer with 1.2x buffer.
   * Falls back to 12,000,000 on estimation failure.
   */
  const estimateNativeGas = useCallback(
    async (to: `0x${string}`, value: bigint): Promise<bigint> => {
      if (!publicClient || !address) return FALLBACK_GAS_LIMIT;

      try {
        const estimated = await publicClient.estimateGas({
          account: address,
          to,
          value,
        });
        return (estimated * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;
      } catch {
        return FALLBACK_GAS_LIMIT;
      }
    },
    [publicClient, address],
  );

  /**
   * Estimates gas for an ERC20 transfer call with 1.2x buffer.
   * Falls back to 12,000,000 on estimation failure.
   */
  const estimateERC20Gas = useCallback(
    async (
      tokenAddress: `0x${string}`,
      to: `0x${string}`,
      value: bigint,
    ): Promise<bigint> => {
      if (!publicClient || !address) return FALLBACK_GAS_LIMIT;

      try {
        const estimated = await publicClient.estimateGas({
          account: address,
          to: tokenAddress,
          data: '0xa9059cbb' as `0x${string}`, // transfer(address,uint256) selector
        });
        return (estimated * GAS_BUFFER_NUMERATOR) / GAS_BUFFER_DENOMINATOR;
      } catch {
        return FALLBACK_GAS_LIMIT;
      }
    },
    [publicClient, address],
  );

  /**
   * Bridges native token to the configured recipient address.
   */
  const bridgeNative = useCallback(
    async (amount: bigint, tokenId: string): Promise<void> => {
      setError(null);
      setTxHash(null);
      setIsLoading(true);

      try {
        if (!chainId || !address) {
          setError({
            code: 'TRANSACTION_FAILED',
            message: 'Wallet is not connected',
          });
          return;
        }

        // Get token config for recipient address
        const tokenConfig = getCrossChainTokenConfig(tokenId, chainId);
        if (!tokenConfig) {
          setError({
            code: 'UNSUPPORTED_TOKEN',
            message: `Token "${tokenId}" is not supported for cross-chain bridge on chain ${chainId}`,
          });
          return;
        }

        const recipientAddress = tokenConfig.recipientAddress;

        // Estimate gas
        const gasLimit = await estimateNativeGas(recipientAddress, amount);

        // Get gas price for cost estimation
        let gasCost = gasLimit; // fallback: just use gas limit as cost proxy
        if (publicClient) {
          try {
            const gasPrice = await publicClient.getGasPrice();
            gasCost = gasLimit * gasPrice;
          } catch {
            // Use gasLimit as rough cost proxy
          }
        }

        // Pre-validate
        const validationError = await preValidate(amount, tokenId, true, gasCost);
        if (validationError) {
          setError(validationError);
          return;
        }

        // Execute native transfer
        const hash = await sendTransactionAsync({
          to: recipientAddress,
          value: amount,
          gas: gasLimit,
        });

        setTxHash(hash);
      } catch (err: any) {
        setError({
          code: 'TRANSACTION_FAILED',
          message: err?.shortMessage || err?.message || 'Transaction failed',
        });
      } finally {
        setIsLoading(false);
      }
    },
    [chainId, address, publicClient, estimateNativeGas, preValidate, sendTransactionAsync],
  );

  /**
   * Bridges an ERC20 token to the configured recipient address via transfer().
   */
  const bridgeERC20 = useCallback(
    async (
      amount: bigint,
      tokenId: string,
      tokenAddress: `0x${string}`,
    ): Promise<void> => {
      setError(null);
      setTxHash(null);
      setIsLoading(true);

      try {
        if (!chainId || !address) {
          setError({
            code: 'TRANSACTION_FAILED',
            message: 'Wallet is not connected',
          });
          return;
        }

        // Get token config for recipient address
        const tokenConfig = getCrossChainTokenConfig(tokenId, chainId);
        if (!tokenConfig) {
          setError({
            code: 'UNSUPPORTED_TOKEN',
            message: `Token "${tokenId}" is not supported for cross-chain bridge on chain ${chainId}`,
          });
          return;
        }

        const recipientAddress = tokenConfig.recipientAddress;

        // Estimate gas
        const gasLimit = await estimateERC20Gas(tokenAddress, recipientAddress, amount);

        // Get gas price for cost estimation
        let gasCost = gasLimit;
        if (publicClient) {
          try {
            const gasPrice = await publicClient.getGasPrice();
            gasCost = gasLimit * gasPrice;
          } catch {
            // Use gasLimit as rough cost proxy
          }
        }

        // Pre-validate
        const validationError = await preValidate(amount, tokenId, false, gasCost);
        if (validationError) {
          setError(validationError);
          return;
        }

        // Execute ERC20 transfer
        const hash = await writeContractAsync({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [recipientAddress, amount],
          gas: gasLimit,
        });

        setTxHash(hash);
      } catch (err: any) {
        setError({
          code: 'TRANSACTION_FAILED',
          message: err?.shortMessage || err?.message || 'Transaction failed',
        });
      } finally {
        setIsLoading(false);
      }
    },
    [chainId, address, publicClient, estimateERC20Gas, preValidate, writeContractAsync],
  );

  return {
    bridgeNative,
    bridgeERC20,
    isLoading,
    error,
    txHash,
  };
}
