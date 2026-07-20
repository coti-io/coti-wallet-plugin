import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBridgeStatus } from '../../src/hooks/useBridgeStatus';
import type { BridgeData } from '../../src/hooks/useBridgeData';

function makeBridge(isPaused: boolean, isDepositEnabled = true): BridgeData {
  return { isPaused, isDepositEnabled } as BridgeData;
}

describe('useBridgeStatus', () => {
  it('returns "active" when the bridge is not paused and deposits are enabled', () => {
    const { result } = renderHook(() => useBridgeStatus(makeBridge(false, true)));
    expect(result.current).toBe('active');
  });

  it('returns "paused" when the bridge is paused', () => {
    const { result } = renderHook(() => useBridgeStatus(makeBridge(true)));
    expect(result.current).toBe('paused');
  });

  it('returns "withdraw-only" when deposits are disabled', () => {
    const { result } = renderHook(() => useBridgeStatus(makeBridge(false, false)));
    expect(result.current).toBe('withdraw-only');
  });

  it('prefers paused over withdraw-only', () => {
    const { result } = renderHook(() => useBridgeStatus(makeBridge(true, false)));
    expect(result.current).toBe('paused');
  });

  it('recomputes when isPaused or isDepositEnabled changes', () => {
    const { result, rerender } = renderHook(
      ({ paused, deposits }) => useBridgeStatus(makeBridge(paused, deposits)),
      { initialProps: { paused: false, deposits: true } },
    );
    expect(result.current).toBe('active');

    rerender({ paused: false, deposits: false });
    expect(result.current).toBe('withdraw-only');

    rerender({ paused: true, deposits: false });
    expect(result.current).toBe('paused');
  });
});
