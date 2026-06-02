import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useBridgeTransactions } from '../../src/hooks/useBridgeTransactions';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('useBridgeTransactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockApiResponse = {
    transactions: [
      {
        txHash: '0xabc123',
        tokenId: 'COTI',
        amount: '100',
        sourceNetworkId: 7082400,
        destinationNetworkId: 11155111,
        timestamp: 1700000000,
        status: 'done',
        step: 4,
        destinationHash: '0xdef456',
      },
      {
        txHash: '0x789ghi',
        tokenId: 'gCOTI',
        amount: '50',
        sourceNetworkId: 11155111,
        destinationNetworkId: 7082400,
        timestamp: 1700001000,
        status: 'pending',
        step: 2,
      },
    ],
    total: 15,
  };

  it('returns empty list for empty wallet address without making a request', async () => {
    const { result } = renderHook(() => useBridgeTransactions('', 10, 1));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.transactions).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns empty list for undefined wallet address without making a request', async () => {
    const { result } = renderHook(() => useBridgeTransactions(undefined, 10, 1));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.transactions).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(result.current.error).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches paginated transaction history and enriches results', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const { result } = renderHook(() =>
      useBridgeTransactions('0xWallet123', 10, 1),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.transactions).toHaveLength(2);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://bridge-api.coti.io/api/v1/transactions/0xWallet123?page=1&pageSize=10',
    );

    expect(result.current.totalCount).toBe(15);
    expect(result.current.error).toBeNull();

    // Check enrichment of first transaction
    const tx1 = result.current.transactions[0];
    expect(tx1.txHash).toBe('0xabc123');
    expect(tx1.currentStep).toBe(4);
    expect(tx1.isCompleted).toBe(true);
    expect(tx1.destinationHash).toBe('0xdef456');
    expect(tx1.sourceChainId).toBe(7082400);
    expect(tx1.destinationChainId).toBe(11155111);

    // Check enrichment of second transaction (pending, no destinationHash)
    const tx2 = result.current.transactions[1];
    expect(tx2.txHash).toBe('0x789ghi');
    expect(tx2.currentStep).toBe(2);
    expect(tx2.isCompleted).toBe(false);
    expect(tx2.destinationHash).toBeNull();
  });

  it('clamps page size to maximum 50', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ transactions: [], total: 0 }),
    });

    const { result } = renderHook(() =>
      useBridgeTransactions('0xWallet123', 100, 1),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://bridge-api.coti.io/api/v1/transactions/0xWallet123?page=1&pageSize=50',
    );
  });

  it('clamps page size minimum to 1', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ transactions: [], total: 0 }),
    });

    const { result } = renderHook(() =>
      useBridgeTransactions('0xWallet123', 0, 1),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(mockFetch).toHaveBeenCalledWith(
      'https://bridge-api.coti.io/api/v1/transactions/0xWallet123?page=1&pageSize=1',
    );
  });

  it('returns cached data if less than 30 seconds old', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    // First render - fetches data
    const { result, rerender } = renderHook(
      ({ wallet, pageSize, page }) =>
        useBridgeTransactions(wallet, pageSize, page),
      { initialProps: { wallet: '0xWallet123', pageSize: 10, page: 1 } },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.transactions).toHaveLength(2);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Rerender with same params — should use cache (< 30 seconds)
    rerender({ wallet: '0xWallet123', pageSize: 10, page: 1 });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    // Should still only have 1 fetch call (used cache)
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.current.transactions).toHaveLength(2);
    expect(result.current.totalCount).toBe(15);
  });

  it('preserves cached data on API failure', async () => {
    // First fetch succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockApiResponse,
    });

    const { result, rerender } = renderHook(
      ({ wallet, pageSize, page }) =>
        useBridgeTransactions(wallet, pageSize, page),
      { initialProps: { wallet: '0xWallet123', pageSize: 10, page: 1 } },
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.transactions).toHaveLength(2);
    });

    // Second fetch fails — use different params to avoid cache hit
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    rerender({ wallet: '0xWallet123', pageSize: 10, page: 2 });

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).not.toBeNull();
    });

    // Previous transactions from page 1 should still be in state
    // (hook preserves cached data — doesn't clear transactions on failure)
    expect(result.current.transactions).toHaveLength(2);
    expect(result.current.error).toContain('Network error');
  });

  it('sets error for non-success HTTP status', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const { result } = renderHook(() =>
      useBridgeTransactions('0xWallet123', 10, 1),
    );

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).not.toBeNull();
    });

    expect(result.current.error).toContain('500');
  });

  it('returns whitespace-only wallet address as empty without fetching', async () => {
    const { result } = renderHook(() => useBridgeTransactions('   ', 10, 1));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.transactions).toEqual([]);
    expect(result.current.totalCount).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
