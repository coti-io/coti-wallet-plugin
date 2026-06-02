import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useBridgeLimits } from '../../src/hooks/useBridgeLimits';

describe('useBridgeLimits', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns error for unsupported token', async () => {
    const { result } = renderHook(() =>
      useBridgeLimits('0xabc', 'UNSUPPORTED_TOKEN')
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.error).toContain('not supported');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.userDailyLimit).toBe('0');
    expect(result.current.globalDailyLimit).toBe('0');
  });

  it('returns error when wallet address is empty', async () => {
    const { result } = renderHook(() => useBridgeLimits('', 'COTI'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.error).toContain('Wallet address is required');
    expect(result.current.isLoading).toBe(false);
  });

  it('fetches and returns limits on success', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ remainingLimit: '5000' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ remainingLimit: '100000' }),
      });

    const { result } = renderHook(() => useBridgeLimits('0xabc', 'COTI'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.userDailyLimit).toBe('5000');
    expect(result.current.globalDailyLimit).toBe('100000');
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('uses limit field as fallback when remainingLimit is undefined', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ limit: '3000' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ limit: '50000' }),
      });

    const { result } = renderHook(() => useBridgeLimits('0xabc', 'COTI'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.userDailyLimit).toBe('3000');
    expect(result.current.globalDailyLimit).toBe('50000');
  });

  it('retains last successful values on fetch error', async () => {
    // First call succeeds
    (global.fetch as any)
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ remainingLimit: '5000' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ remainingLimit: '100000' }),
      });

    const { result } = renderHook(() => useBridgeLimits('0xabc', 'COTI', 5000));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.userDailyLimit).toBe('5000');

    // Second call (polling) fails
    (global.fetch as any).mockRejectedValue(new Error('Network error'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Should retain previous values
    expect(result.current.userDailyLimit).toBe('5000');
    expect(result.current.globalDailyLimit).toBe('100000');
    expect(result.current.error).toContain('Network error');
  });

  it('sets error when API returns non-ok response', async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    const { result } = renderHook(() => useBridgeLimits('0xabc', 'COTI'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.error).toContain('non-success status');
  });

  it('handles unknown error type gracefully', async () => {
    (global.fetch as any).mockRejectedValue('string error');

    const { result } = renderHook(() => useBridgeLimits('0xabc', 'COTI'));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.error).toContain('unknown error');
  });
});
