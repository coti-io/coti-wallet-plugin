import { useMemo } from 'react';
import { getChainConfig } from '../../chains';
import { useCotiBridgeFees } from './useCotiBridgeFees';
import { usePodPortalFees } from './usePodPortalFees';
import type { UsePluginBridgeGasOptions } from './usePluginBridgeGas.types';

export type { UsePluginBridgeGasOptions } from './usePluginBridgeGas.types';

/** Routes fee estimation to COTI bridge or PoD portal hooks by chain strategy. */
export const usePluginBridgeGas = (options: UsePluginBridgeGasOptions) => {
  const isPodChain = getChainConfig(options.chainId)?.portalStrategy === 'pod-privacy-portal';
  const podFees = usePodPortalFees(options);
  const cotiFees = useCotiBridgeFees(options);

  return useMemo(
    () => (isPodChain ? podFees : cotiFees),
    [isPodChain, podFees, cotiFees],
  );
};
