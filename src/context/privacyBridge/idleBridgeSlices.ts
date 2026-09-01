import type {
  PrivacyBridgePodContextValue,
  PrivacyBridgeSwapContextValue,
} from './types';

const BRIDGE_SURFACE_REQUIRED =
  'This API requires PrivacyBridgeProvider surface="bridge" (or configureCotiPlugin({ privacyBridgeSurface: "bridge" })).';

const requireBridgeSurface = (): never => {
  throw new Error(BRIDGE_SURFACE_REQUIRED);
};

/** Inert swap slice for `surface="core"` — reads are empty; mutating APIs throw. */
export const IDLE_PRIVACY_BRIDGE_SWAP: PrivacyBridgeSwapContextValue = {
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
export const IDLE_PRIVACY_BRIDGE_POD: PrivacyBridgePodContextValue = {
  podRequests: [],
  refreshPodRequest: async () => {},
};
