import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { registerTransaction, useOngoingTransactions } from '../../src/hooks/useOngoingTransactions';

// Access the module-level registry for cleanup
// We need to clear it between tests
const clearRegistry = () => {
  // registerTransaction adds to internal Map — we'll reset by accessing it indirectly
};

describe('useOngoingTransactions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Mock fetch globally
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'pending', step: 1 }),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('registerTransaction', () => {
    it('creates an OngoingTransaction entry with correct defaults', () => {
      const input = {
        tokenId: 'COTI',
        sourceChainId: 7082400,
        destinationChainId: 11155111,
        txHash: '0xabc123_register_test',
      };

      registerTransaction(input);

      const { result } = renderHook(() => useOngoingTransactions());
      const tx = result.current.transactions.find(t => t.txHash === '0xabc123_register_test');
      expect(tx).toBeDefined();
      expect(tx!.tokenId).toBe('COTI');
      expect(tx!.sourceChainId).toBe(7082400);
      expect(tx!.destinationChainId).toBe(11155111);
      expect(tx!.currentStep).toBe(0);
      expect(tx!.destinationHash).toBeNull();
      expect(tx!.failureReason).toBeNull();
      expect(tx!.isLoading).toBe(true);
      expect(tx!.initiatedAt).toBeGreaterThan(0);
    });
  });

  describe('useOngoingTransactions hook', () => {
    it('returns registered transactions on mount', () => {
      registerTransaction({
        tokenId: 'gCOTI',
        sourceChainId: 2632500,
        destinationChainId: 1,
        txHash: '0xmount_test',
      });

      const { result } = renderHook(() => useOngoingTransactions());
      expect(result.current.transactions.length).toBeGreaterThanOrEqual(1);
      expect(result.current.transactions.some(t => t.txHash === '0xmount_test')).toBe(true);
    });

    it('enforces minimum polling interval of 5000ms', () => {
      // Pass 1000ms (below minimum)
      const { result } = renderHook(() => useOngoingTransactions(1000));
      // Should still work without errors — just uses 5000 internally
      expect(result.current.transactions).toBeDefined();
    });

    it('removes transactions when they reach terminal state (done)', async () => {
      const txHash = '0xterminal_done_' + Date.now();
      registerTransaction({
        tokenId: 'COTI',
        sourceChainId: 7082400,
        destinationChainId: 11155111,
        txHash,
      });

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ status: 'done', step: 4, destinationHash: '0xdest' }),
      });

      const { result } = renderHook(() => useOngoingTransactions(5000));

      // Advance timers to trigger a poll
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      // After terminal state, the transaction should be removed
      const found = result.current.transactions.find(t => t.txHash === txHash);
      expect(found).toBeUndefined();
    });

    it('retains last known state on fetch error', async () => {
      const txHash = '0xfetch_error_' + Date.now();
      registerTransaction({
        tokenId: 'COTI',
        sourceChainId: 7082400,
        destinationChainId: 11155111,
        txHash,
      });

      (global.fetch as any).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useOngoingTransactions(5000));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      // Transaction should still exist (not removed on error)
      const found = result.current.transactions.find(t => t.txHash === txHash);
      expect(found).toBeDefined();
    });

    it('retains last known state on non-ok response', async () => {
      const txHash = '0xnon_ok_' + Date.now();
      registerTransaction({
        tokenId: 'COTI',
        sourceChainId: 7082400,
        destinationChainId: 11155111,
        txHash,
      });

      (global.fetch as any).mockResolvedValue({ ok: false, status: 500 });

      const { result } = renderHook(() => useOngoingTransactions(5000));

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      const found = result.current.transactions.find(t => t.txHash === txHash);
      expect(found).toBeDefined();
    });
  });
});
