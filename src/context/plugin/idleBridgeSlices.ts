import type {
  CotiPodContextValue,
  CotiSwapContextValue,
} from './types';

const BRIDGE_SURFACE_REQUIRED =
  'This API requires CotiPluginProvider surface="bridge" (or configureCotiPlugin({ pluginSurface: "bridge" })).';

const requireBridgeSurface = (): never => {
  throw new Error(BRIDGE_SURFACE_REQUIRED);
};

/** Inert swap slice for `surface="core"` — reads are empty; mutating APIs throw. */
export const IDLE_COTI_SWAP: CotiSwapContextValue = {
  amount: '',
  direction: 'to-private',
  selectedTokenIndex: 0,
  setAmount: requireBridgeSurface,
  setDirection: requireBridgeSurface,
  setSelectedTokenIndex: requireBridgeSurface,
  handleSwap: requireBridgeSurface,
  isBridgingLoading: false,
  isApprovalNeeded: false,
  isApproving: false,
  handleApprove: requireBridgeSurface,
  estimatedGasFee: null,
  updateGasFee: requireBridgeSurface,
  isGasEstimating: false,
  portalFeeCoti: null,
  portalFee: null,
  portalFeeSymbol: 'COTI',
  podInboxFee: null,
  l1GasFee: null,
  isPodChain: false,
  feeDebugInfo: null,
};

/** Inert PoD tracker for `surface="core"` — no localStorage poll. */
export const IDLE_COTI_POD: CotiPodContextValue = {
  podRequests: [],
  refreshPodRequest: async () => {},
};
