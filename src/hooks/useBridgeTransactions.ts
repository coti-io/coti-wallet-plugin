import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Represents an enriched bridge transaction record.
 */
export interface BridgeTransaction {
  txHash: string;
  tokenId: string;
  amount: string;
  sourceChainId: number;
  destinationChainId: number;
  timestamp: number;
  currentStep: number;
  isCompleted: boolean;
  destinationHash: string | null;
}

/**
 * Result returned by the `useBridgeTransactions` hook.
 */
export interface UseBridgeTransactionsResult {
  transactions: BridgeTransaction[];
  totalCount: number;
  isLoading: boolean;
  error: string | null;
}

/**
 * Shape of individual transaction records from the tracking API.
 */
interface TransactionHistoryApiItem {
  txHash: string;
  tokenId: string;
  amount: string;
  sourceNetworkId: number;
  destinationNetworkId: number;
  timestamp: number;
  status: string;
  step: number;
  destinationHash?: string;
}

/**
 * Shape of the transaction history API response.
 */
interface TransactionHistoryApiResponse {
  transactions: TransactionHistoryApiItem[];
  total: number;
}

/** Cached data entry with timestamp */
interface CacheEntry {
  data: {
    transactions: BridgeTransaction[];
    totalCount: number;
  };
  timestamp: number;
}

/** Cache duration in milliseconds (30 seconds) */
const CACHE_DURATION_MS = 30_000;

/** Base URL for the bridge tracking API */
const BRIDGE_API_BASE = 'https://bridge-api.coti.io';

/**
 * Clamps page size to the valid range of 1-50.
 */
function clampPageSize(pageSize: number): number {
  return Math.max(1, Math.min(50, pageSize));
}

/**
 * Maps a raw API transaction item to an enriched BridgeTransaction.
 */
function mapTransaction(item: TransactionHistoryApiItem): BridgeTransaction {
  return {
    txHash: item.txHash,
    tokenId: item.tokenId,
    amount: item.amount,
    sourceChainId: item.sourceNetworkId,
    destinationChainId: item.destinationNetworkId,
    timestamp: item.timestamp,
    currentStep: item.step,
    isCompleted: item.status === 'done',
    destinationHash: item.destinationHash ?? null,
  };
}

/**
 * Fetches paginated bridge transaction history for a wallet address.
 *
 * Features:
 * - Returns empty list without network request when wallet address is empty/undefined
 * - Clamps page size to 1-50 range
 * - Enriches each transaction with current step, completion status, and destination hash
 * - Caches results for 30 seconds; returns cached data if fresh
 * - Preserves cached data on API failure
 *
 * @param walletAddress - The wallet address to fetch transactions for
 * @param pageSize - Number of transactions per page (clamped to 1-50)
 * @param pageNumber - Page number to fetch
 * @returns UseBridgeTransactionsResult with transactions, totalCount, loading, and error states
 */
export function useBridgeTransactions(
  walletAddress: string | undefined,
  pageSize: number,
  pageNumber: number,
): UseBridgeTransactionsResult {
  const [transactions, setTransactions] = useState<BridgeTransaction[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Cache keyed by "walletAddress:pageSize:pageNumber"
  const cacheRef = useRef<Map<string, CacheEntry>>(new Map());

  const fetchTransactions = useCallback(async () => {
    // Return empty list for empty/undefined wallet address without making a request
    if (!walletAddress || walletAddress.trim() === '') {
      setTransactions([]);
      setTotalCount(0);
      setIsLoading(false);
      setError(null);
      return;
    }

    const clampedPageSize = clampPageSize(pageSize);
    const cacheKey = `${walletAddress}:${clampedPageSize}:${pageNumber}`;

    // Check cache freshness
    const cached = cacheRef.current.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION_MS) {
      setTransactions(cached.data.transactions);
      setTotalCount(cached.data.totalCount);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);

    try {
      const url = `${BRIDGE_API_BASE}/api/v1/transactions/${walletAddress}?page=${pageNumber}&pageSize=${clampedPageSize}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(
          `Bridge API returned status ${response.status}: ${response.statusText}`,
        );
      }

      const data: TransactionHistoryApiResponse = await response.json();

      const enrichedTransactions = data.transactions.map(mapTransaction);

      // Update cache
      const cacheData = {
        transactions: enrichedTransactions,
        totalCount: data.total,
      };
      cacheRef.current.set(cacheKey, {
        data: cacheData,
        timestamp: Date.now(),
      });

      setTransactions(enrichedTransactions);
      setTotalCount(data.total);
      setError(null);
    } catch (err) {
      // On failure: set error, preserve cached data (don't clear transactions)
      setError(
        err instanceof Error
          ? `Failed to fetch transaction history: ${err.message}`
          : 'Failed to fetch transaction history: unknown error',
      );
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress, pageSize, pageNumber]);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  return {
    transactions,
    totalCount,
    isLoading,
    error,
  };
}
