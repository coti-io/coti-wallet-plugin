import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBridgeStatus } from '../../src/hooks/useBridgeStatus';
import type { BridgeData } from '../../src/hooks/useBridgeData';

function makeBridge(isPaused: boolean): BridgeData {
  return { isPaused } as BridgeData;
}

describe('useBridgeStatus', () => {
  it('returns "active" when the bridge is not paused', () => {
    const { result } = renderHook(() => useBridgeStatus(makeBridge(false)));
    expect(result.current).toBe('active');
  });

  it('returns "paused" when the bridge is paused', () => {
    const { result } = renderHook(() => useBridgeStatus(makeBridge(true)));
    expect(result.current).toBe('paused');
  });

  it('recomputes when isPaused changes', () => {
    const { result, rerender } = renderHook(
      ({ paused }) => useBridgeStatus(makeBridge(paused)),
      { initialProps: { paused: false } },
    );
    expect(result.current).toBe('active');

    rerender({ paused: true });
    expect(result.current).toBe('paused');
  });
});
