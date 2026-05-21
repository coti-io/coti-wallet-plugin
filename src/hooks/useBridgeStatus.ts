import { useMemo } from 'react';
import { BridgeData } from './useBridgeData';

export type BridgeStatus = 'active' | 'paused';

export function useBridgeStatus(bridge: BridgeData) {
  return useMemo<BridgeStatus>(
    () => (bridge.isPaused ? 'paused' : 'active'),
    [bridge.isPaused]
  );
}
