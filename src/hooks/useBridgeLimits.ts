import { useState, useEffect, useCallback, useRef } from 'react';
import { getCrossChainTokenConfig } from '../config/crossChainTokens';
import { COTI_TESTNET_CHAIN_ID } from '../config/chains';

/**
 * Result returned by the `useBridgeLimits` hook.
 */
export interface UseBridgeLimitsResult {
  userDailyLimit: string;
  globalDailyLimit: string;
  isLoading: boolean;
  error: string | null;
}

/** Base URL for the Cap Meter API */
const CAP_METER_API_BASE = 'https://bridge-api.coti.io';

/** Default polling interval in milliseconds */
const DEFAULT_POLLING_INTERVAL_MS = 30_000;

/**
 * Fetches bridge limits (user daily limit and global daily limit) from
 * the Cap Meter API, with auto-refresh polling and error resilience.
 *
 * @param walletAddress - The user's wallet address
 * @param tokenId - The token identifier (e.g., 'COTI', 'gCOTI')
 * @param pollingIntervalMs - Polling interval in milliseconds (default: 30000)
 * @returns UseBridgeLimitsResult with limit values, loading state, and error state
 */
export function useBridgeLimits(
  walletAddress: string,
  tokenId: string,
  pollingIntervalMs: number = DEFAULT_POLLING_INTERVAL_MS,
): UseBridgeLimitsResult {
  const [userDailyLimit, setUserDailyLimit] = useState<string>('0');
  const [globalDailyLimit, setGlobalDailyLimit] = useState<string>('0');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Refs to retain last successful values across fetch failures
  const lastUserLimitRef = useRef<string>('0');
  const lastGlobalLimitRef = useRef<string>('0');

  const fetchLimits = useCallback(async () => {
    // Check if the token is supported — use a default chain ID for config lookup
    const tokenConfig = getCrossChainTokenConfig(tokenId, COTI_TESTNET_CHAIN_ID);
    if (!tokenConfig) {
      setUserDailyLimit('0');
      setGlobalDailyLimit('0');
      setIsLoading(false);
      setError(`Token "${tokenId}" is not supported for cross-chain bridge`);
      return;
    }

    if (!walletAddress) {
      setUserDailyLimit('0');
      setGlobalDailyLimit('0');
      setIsLoading(false);
      setError('Wallet address is required');
      return;
    }

    try {
      const [userResponse, globalResponse] = await Promise.all([
        fetch(`${CAP_METER_API_BASE}/api/v1/limits/user/${walletAddress}/${tokenId}`),
        fetch(`${CAP_METER_API_BASE}/api/v1/limits/global/${tokenId}`),
      ]);

      if (!userResponse.ok || !globalResponse.ok) {
        throw new Error(
          `Cap Meter API returned non-success status: user=${userResponse.status}, global=${globalResponse.status}`,
        );
      }

      const userData = await userResponse.json();
      const globalData = await globalResponse.json();

      const newUserLimit = userData.remainingLimit ?? userData.limit ?? '0';
      const newGlobalLimit = globalData.remainingLimit ?? globalData.limit ?? '0';

      lastUserLimitRef.current = String(newUserLimit);
      lastGlobalLimitRef.current = String(newGlobalLimit);

      setUserDailyLimit(String(newUserLimit));
      setGlobalDailyLimit(String(newGlobalLimit));
      setError(null);
    } catch (err) {
      // On failure, retain last successful values and set error
      setUserDailyLimit(lastUserLimitRef.current);
      setGlobalDailyLimit(lastGlobalLimitRef.current);
      setError(
        err instanceof Error
          ? `Failed to fetch bridge limits: ${err.message}`
          : 'Failed to fetch bridge limits: unknown error',
      );
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress, tokenId]);

  useEffect(() => {
    // Reset loading state on param change
    setIsLoading(true);

    // Initial fetch
    fetchLimits();

    // Set up polling interval
    const intervalId = setInterval(fetchLimits, pollingIntervalMs);

    // Clean up on unmount or param change
    return () => {
      clearInterval(intervalId);
    };
  }, [fetchLimits, pollingIntervalMs]);

  return {
    userDailyLimit,
    globalDailyLimit,
    isLoading,
    error,
  };
}
