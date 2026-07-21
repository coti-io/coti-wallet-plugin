import { useMemo } from 'react';
import { BridgeData } from './useBridgeData';

export type BridgeStatus = 'active' | 'paused' | 'withdraw-only';

export function useBridgeStatus(bridge: BridgeData) {
  return useMemo<BridgeStatus>(() => {
    if (bridge.isPaused) return 'paused';
    if (bridge.isDepositEnabled === false) return 'withdraw-only';
    return 'active';
  }, [bridge.isPaused, bridge.isDepositEnabled]);
}
