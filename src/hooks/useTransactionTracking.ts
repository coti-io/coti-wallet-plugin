import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Response shape from the tracking API endpoint.
 */
export interface TrackingApiResponse {
  status: 'pending' | 'done' | 'failed' | 'refunded';
  step: number;
  destinationHash?: string;
  failureReason?: string;
  fee?: string;
}

/**
 * Result returned by the `useTransactionTracking` hook.
 */
export interface UseTransactionTrackingResult {
  currentStep: number | null;
  destinationHash: string | null;
  failureReason: string | null;
  failedStep: number | null;
  fee: string | null;
  isLoading: boolean;
  error: string | null;
}

/** Terminal statuses that stop the polling cycle */
const TERMINAL_STATES: ReadonlySet<string> = new Set(['done', 'failed', 'refunded']);

/** Base URL for the tracking service */
const TRACKING_API_BASE = 'https://bridge-api.coti.io';

/** Default polling interval in milliseconds */
const DEFAULT_POLLING_INTERVAL_MS = 10_000;

/**
 * Polls the bridge tracking API for a given transaction hash and returns
 * real-time progress updates.
 *
 * - COTI-source transactions progress through 4 steps (Detect, Cap, Build, Dispatch)
 * - Ethereum-source transactions progress through 3 steps (Detect, Build, Dispatch)
 *
 * Polling stops when the transaction reaches a terminal state (done, failed, refunded).
 * Network errors are propagated but do NOT stop the polling cycle.
 *
 * @param txHash - The source chain transaction hash to track
 * @param sourceNetworkId - The source chain's network/chain ID
 * @param destinationNetworkId - The destination chain's network/chain ID
 * @param pollingIntervalMs - Polling interval in milliseconds (default: 10000)
 * @returns UseTransactionTrackingResult with step progress, destination hash, errors, and loading state
 */
export function useTransactionTracking(
  txHash: string | undefined,
  sourceNetworkId: number | undefined,
  destinationNetworkId: number | undefined,
  pollingIntervalMs: number = DEFAULT_POLLING_INTERVAL_MS,
): UseTransactionTrackingResult {
  const [currentStep, setCurrentStep] = useState<number | null>(null);
  const [destinationHash, setDestinationHash] = useState<string | null>(null);
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [failedStep, setFailedStep] = useState<number | null>(null);
  const [fee, setFee] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether we've reached a terminal state to stop polling
  const isTerminalRef = useRef<boolean>(false);
  // Track the interval for cleanup
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchTrackingStatus = useCallback(async () => {
    if (!txHash || !sourceNetworkId || !destinationNetworkId) {
      return;
    }

    // Don't poll if already in a terminal state
    if (isTerminalRef.current) {
      return;
    }

    try {
      const response = await fetch(
        `${TRACKING_API_BASE}/api/v1/tracking/${txHash}`,
      );

      if (!response.ok) {
        throw new Error(
          `Tracking API returned status ${response.status}`,
        );
      }

      const data: TrackingApiResponse = await response.json();

      // Update current step
      setCurrentStep(data.step);

      // Update fee if present
      if (data.fee !== undefined) {
        setFee(data.fee);
      }

      // Clear any previous network error on successful poll
      setError(null);

      // Handle terminal states
      if (TERMINAL_STATES.has(data.status)) {
        isTerminalRef.current = true;

        if (data.status === 'done') {
          setDestinationHash(data.destinationHash ?? null);
        } else if (data.status === 'failed' || data.status === 'refunded') {
          setFailureReason(data.failureReason ?? null);
          setFailedStep(data.step);
        }

        setIsLoading(false);

        // Stop polling by clearing interval
        if (intervalRef.current !== null) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    } catch (err) {
      // Propagate network errors without stopping the polling cycle
      setError(
        err instanceof Error
          ? err.message
          : 'Failed to fetch tracking status',
      );
    }
  }, [txHash, sourceNetworkId, destinationNetworkId]);

  useEffect(() => {
    // Reset state when inputs change
    setCurrentStep(null);
    setDestinationHash(null);
    setFailureReason(null);
    setFailedStep(null);
    setFee(null);
    setError(null);
    isTerminalRef.current = false;

    // Don't start polling if txHash is empty/undefined
    if (!txHash || !sourceNetworkId || !destinationNetworkId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // Initial fetch
    fetchTrackingStatus();

    // Set up polling interval
    intervalRef.current = setInterval(fetchTrackingStatus, pollingIntervalMs);

    // Clean up on unmount or when inputs change
    return () => {
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [txHash, sourceNetworkId, destinationNetworkId, pollingIntervalMs, fetchTrackingStatus]);

  return {
    currentStep,
    destinationHash,
    failureReason,
    failedStep,
    fee,
    isLoading,
    error,
  };
}
