import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Represents an in-progress cross-chain bridge transaction being monitored.
 */
export interface OngoingTransaction {
  tokenId: string;
  sourceChainId: number;
  destinationChainId: number;
  txHash: string;
  currentStep: number;
  destinationHash: string | null;
  failureReason: string | null;
  isLoading: boolean;
  initiatedAt: number;
}

/**
 * Result returned by the `useOngoingTransactions` hook.
 */
export interface UseOngoingTransactionsResult {
  transactions: OngoingTransaction[];
}

/**
 * Input for registering a new transaction in the ongoing registry.
 */
export interface RegisterTransactionInput {
  tokenId: string;
  sourceChainId: number;
  destinationChainId: number;
  txHash: string;
}

/** Terminal statuses that trigger removal from the registry */
const TERMINAL_STATES: ReadonlySet<string> = new Set(['done', 'failed', 'refunded']);

/** Base URL for the tracking service */
const TRACKING_API_BASE = 'https://bridge-api.coti.io';

/** Default polling interval in milliseconds */
const DEFAULT_POLLING_INTERVAL_MS = 10_000;

/** Minimum allowed polling interval in milliseconds */
const MIN_POLLING_INTERVAL_MS = 5_000;

/**
 * Module-level registry that persists across hook mount/unmount cycles.
 * This allows ongoing transactions to survive component remounts within the same session.
 */
const ongoingRegistry: Map<string, OngoingTransaction> = new Map();

/**
 * Registers a new transaction in the ongoing transactions registry.
 * The transaction will be tracked until it reaches a terminal state (done, failed, refunded).
 *
 * @param tx - Transaction details to register
 */
export function registerTransaction(tx: RegisterTransactionInput): void {
  const entry: OngoingTransaction = {
    tokenId: tx.tokenId,
    sourceChainId: tx.sourceChainId,
    destinationChainId: tx.destinationChainId,
    txHash: tx.txHash,
    currentStep: 0,
    destinationHash: null,
    failureReason: null,
    isLoading: true,
    initiatedAt: Date.now(),
  };

  ongoingRegistry.set(tx.txHash, entry);
}

/**
 * Polls the bridge tracking API for all registered ongoing transactions and
 * removes them from the registry when they reach a terminal state.
 *
 * - On mount, restores previously registered transactions from the module-level registry
 * - Polls tracking endpoint for each registered transaction at configurable interval
 * - Removes transactions when status is 'done', 'failed', or 'refunded'
 * - On tracking error, retains last known status (does not remove from registry)
 * - Cleans up interval on unmount but does NOT clear the registry (persistence mechanism)
 *
 * @param pollingIntervalMs - Polling interval in milliseconds (default: 10000, minimum: 5000)
 * @returns UseOngoingTransactionsResult with array of current ongoing transactions
 */
export function useOngoingTransactions(
  pollingIntervalMs: number = DEFAULT_POLLING_INTERVAL_MS,
): UseOngoingTransactionsResult {
  // Enforce minimum polling interval
  const effectiveInterval = Math.max(pollingIntervalMs, MIN_POLLING_INTERVAL_MS);

  const [transactions, setTransactions] = useState<OngoingTransaction[]>(
    () => Array.from(ongoingRegistry.values()),
  );

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const pollAllTransactions = useCallback(async () => {
    const entries = Array.from(ongoingRegistry.entries());

    if (entries.length === 0) {
      setTransactions([]);
      return;
    }

    const pollPromises = entries.map(async ([txHash, tx]) => {
      try {
        const response = await fetch(
          `${TRACKING_API_BASE}/api/v1/tracking/${txHash}`,
        );

        if (!response.ok) {
          // Retain last known status on error
          return;
        }

        const data = await response.json();

        // Check for terminal state
        if (TERMINAL_STATES.has(data.status)) {
          // Update with final data before removal
          const updated: OngoingTransaction = {
            ...tx,
            currentStep: data.step ?? tx.currentStep,
            destinationHash: data.destinationHash ?? tx.destinationHash,
            failureReason: data.failureReason ?? tx.failureReason,
            isLoading: false,
          };
          ongoingRegistry.set(txHash, updated);
          // Remove from registry after updating
          ongoingRegistry.delete(txHash);
        } else {
          // Update with latest data
          const updated: OngoingTransaction = {
            ...tx,
            currentStep: data.step ?? tx.currentStep,
            destinationHash: data.destinationHash ?? tx.destinationHash,
            failureReason: data.failureReason ?? tx.failureReason,
            isLoading: true,
          };
          ongoingRegistry.set(txHash, updated);
        }
      } catch {
        // On network error, retain last known status — do nothing
      }
    });

    await Promise.all(pollPromises);

    // Update React state from registry
    setTransactions(Array.from(ongoingRegistry.values()));
  }, []);

  useEffect(() => {
    // Restore previously registered transactions on mount
    setTransactions(Array.from(ongoingRegistry.values()));

    // Initial poll
    pollAllTransactions();

    // Set up polling interval
    intervalRef.current = setInterval(pollAllTransactions, effectiveInterval);

    // Clean up interval on unmount (but do NOT clear registry)
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [effectiveInterval, pollAllTransactions]);

  return { transactions };
}
