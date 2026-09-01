import type {
  CotiPodContextValue,
  CotiSwapContextValue,
} from './types';

const PORTAL_FEATURE_REQUIRED =
  'This API requires CotiPluginProvider features that include "portal" (or configureCotiPlugin({ pluginFeatures: ["portal"] })).';

const requirePortalFeature = (): never => {
  throw new Error(PORTAL_FEATURE_REQUIRED);
};

/** Inert swap slice when `portal` is off — reads are empty; mutating APIs throw. */
export const IDLE_COTI_SWAP: CotiSwapContextValue = {
  amount: '',
  direction: 'to-private',
  selectedTokenIndex: 0,
  setAmount: requirePortalFeature,
  setDirection: requirePortalFeature,
  setSelectedTokenIndex: requirePortalFeature,
  handleSwap: requirePortalFeature,
  isBridgingLoading: false,
  isApprovalNeeded: false,
  isApproving: false,
  handleApprove: requirePortalFeature,
  estimatedGasFee: null,
  updateGasFee: requirePortalFeature,
  isGasEstimating: false,
  portalFeeCoti: null,
  portalFee: null,
  portalFeeSymbol: 'COTI',
  podInboxFee: null,
  l1GasFee: null,
  isPodChain: false,
  feeDebugInfo: null,
};

/** Inert PoD tracker when `pod` is off — no localStorage poll. */
export const IDLE_COTI_POD: CotiPodContextValue = {
  podRequests: [],
  refreshPodRequest: async () => {},
};
