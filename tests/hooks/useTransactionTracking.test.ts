import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTransactionTracking } from '../../src/hooks/useTransactionTracking';
import type { TrackingApiResponse } from '../../src/hooks/useTransactionTracking';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

function createMockResponse(data: TrackingApiResponse, ok = true, status = 200) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

describe('useTransactionTracking', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('does not poll when txHash is empty', () => {
    const { result } = renderHook(() =>
      useTransactionTracking('', 7082400, 11155111),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.currentStep).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not poll when txHash is undefined', () => {
    const { result } = renderHook(() =>
      useTransactionTracking(undefined, 7082400, 11155111),
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.currentStep).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not poll when sourceNetworkId is undefined', () => {
    const { result } = renderHook(() =>
      useTransactionTracking('0xabc', undefined, 11155111),
    );

    expect(result.current.isLoading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not poll when destinationNetworkId is undefined', () => {
    const { result } = renderHook(() =>
      useTransactionTracking('0xabc', 7082400, undefined),
    );

    expect(result.current.isLoading).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('starts polling when valid params are provided', async () => {
    mockFetch.mockReturnValue(
      createMockResponse({ status: 'pending', step: 1 }),
    );

    const { result } = renderHook(() =>
      useTransactionTracking('0xabc123', 7082400, 11155111, 100),
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        'https://bridge-api.coti.io/api/v1/tracking/0xabc123',
      );
      expect(result.current.currentStep).toBe(1);
    });
  });

  it('updates currentStep on each poll', async () => {
    mockFetch
      .mockReturnValueOnce(createMockResponse({ status: 'pending', step: 1 }))
      .mockReturnValueOnce(createMockResponse({ status: 'pending', step: 2 }));

    const { result } = renderHook(() =>
      useTransactionTracking('0xabc123', 7082400, 11155111, 50),
    );

    await waitFor(() => {
      expect(result.current.currentStep).toBe(1);
    });

    // Wait for second poll
    await waitFor(() => {
      expect(result.current.currentStep).toBe(2);
    });
  });

  it('stops polling on done status and sets destinationHash', async () => {
    mockFetch.mockReturnValue(
      createMockResponse({
        status: 'done',
        step: 4,
        destinationHash: '0xdest123',
        fee: '0.01',
      }),
    );

    const { result } = renderHook(() =>
      useTransactionTracking('0xabc123', 7082400, 11155111, 50),
    );

    await waitFor(() => {
      expect(result.current.currentStep).toBe(4);
      expect(result.current.destinationHash).toBe('0xdest123');
      expect(result.current.fee).toBe('0.01');
      expect(result.current.isLoading).toBe(false);
    });

    // Clear and verify no more polls happen
    const callCount = mockFetch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(mockFetch.mock.calls.length).toBe(callCount);
  });

  it('stops polling on failed status and sets failureReason and failedStep', async () => {
    mockFetch.mockReturnValue(
      createMockResponse({
        status: 'failed',
        step: 2,
        failureReason: 'Insufficient liquidity',
      }),
    );

    const { result } = renderHook(() =>
      useTransactionTracking('0xabc123', 7082400, 11155111, 50),
    );

    await waitFor(() => {
      expect(result.current.failureReason).toBe('Insufficient liquidity');
      expect(result.current.failedStep).toBe(2);
      expect(result.current.isLoading).toBe(false);
    });

    // Verify polling stopped
    const callCount = mockFetch.mock.calls.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(mockFetch.mock.calls.length).toBe(callCount);
  });

  it('stops polling on refunded status and sets failureReason', async () => {
    mockFetch.mockReturnValue(
      createMockResponse({
        status: 'refunded',
        step: 3,
        failureReason: 'Bridge capacity exceeded',
      }),
    );

    const { result } = renderHook(() =>
      useTransactionTracking('0xabc123', 11155111, 7082400, 50),
    );

    await waitFor(() => {
      expect(result.current.failureReason).toBe('Bridge capacity exceeded');
      expect(result.current.failedStep).toBe(3);
      expect(result.current.isLoading).toBe(false);
    });
  });

  it('propagates network errors without stopping polling', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('Network timeout'))
      .mockReturnValueOnce(createMockResponse({ status: 'pending', step: 2 }));

    const { result } = renderHook(() =>
      useTransactionTracking('0xabc123', 7082400, 11155111, 50),
    );

    // First poll fails — error should be set
    await waitFor(() => {
      expect(result.current.error).toBe('Network timeout');
    });

    // Polling continues — second poll succeeds
    await waitFor(() => {
      expect(result.current.currentStep).toBe(2);
      expect(result.current.error).toBeNull();
    });
  });

  it('propagates HTTP error without stopping polling', async () => {
    mockFetch
      .mockReturnValueOnce(
        Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) }),
      )
      .mockReturnValueOnce(createMockResponse({ status: 'pending', step: 1 }));

    const { result } = renderHook(() =>
      useTransactionTracking('0xabc123', 7082400, 11155111, 50),
    );

    await waitFor(() => {
      expect(result.current.error).toBe('Tracking API returned status 500');
    });

    // Continue polling — next poll succeeds
    await waitFor(() => {
      expect(result.current.currentStep).toBe(1);
      expect(result.current.error).toBeNull();
    });
  });

  it('returns fee from API response', async () => {
    mockFetch.mockReturnValue(
      createMockResponse({ status: 'pending', step: 2, fee: '1.5' }),
    );

    const { result } = renderHook(() =>
      useTransactionTracking('0xabc123', 7082400, 11155111, 100),
    );

    await waitFor(() => {
      expect(result.current.fee).toBe('1.5');
    });
  });

  it('resets state when txHash changes', async () => {
    mockFetch.mockReturnValue(
      createMockResponse({ status: 'pending', step: 3 }),
    );

    const { result, rerender } = renderHook(
      ({ txHash }) => useTransactionTracking(txHash, 7082400, 11155111, 100),
      { initialProps: { txHash: '0xfirst' } },
    );

    await waitFor(() => {
      expect(result.current.currentStep).toBe(3);
    });

    // Change txHash — state should reset
    mockFetch.mockReturnValue(
      createMockResponse({ status: 'pending', step: 1 }),
    );

    rerender({ txHash: '0xsecond' });

    // After rerender with new txHash, state resets then new fetch occurs
    await waitFor(() => {
      expect(result.current.currentStep).toBe(1);
    });
  });

  it('cleans up interval on unmount', async () => {
    mockFetch.mockReturnValue(
      createMockResponse({ status: 'pending', step: 1 }),
    );

    const { result, unmount } = renderHook(() =>
      useTransactionTracking('0xabc123', 7082400, 11155111, 50),
    );

    await waitFor(() => {
      expect(result.current.currentStep).toBe(1);
    });

    const callCount = mockFetch.mock.calls.length;
    unmount();

    // Wait and ensure no more fetches after unmount
    await new Promise((r) => setTimeout(r, 120));
    expect(mockFetch.mock.calls.length).toBe(callCount);
  });

  it('returns correct initial state shape', () => {
    const { result } = renderHook(() =>
      useTransactionTracking(undefined, undefined, undefined),
    );

    expect(result.current).toEqual({
      currentStep: null,
      destinationHash: null,
      failureReason: null,
      failedStep: null,
      fee: null,
      isLoading: false,
      error: null,
    });
  });
});
