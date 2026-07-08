export const SEPOLIA_CHAIN_ID = 11155111;
export const COTI_TESTNET_CHAIN_ID = 7082400;
export const DEFAULT_POD_EXPLORER_BASE_URL = "https://coti-pod-explorer.netlify.app";

export const buildPodExplorerRequestUrl = (
  requestId: string,
  chainSlug = "sepolia",
  baseUrl = DEFAULT_POD_EXPLORER_BASE_URL
) => {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, "");
  const normalizedRequestId = requestId.replace(/^0x/, "");
  return `${normalizedBaseUrl}/#/request/${chainSlug}/${normalizedRequestId}`;
};

export type PodBalanceTrustState = "ready" | "pending-request" | "callback-error" | "unknown";

export interface PodBalanceState {
  status: PodBalanceTrustState;
  pending: boolean;
  callbackErrored: boolean;
  message?: string;
}

export const DEFAULT_POD_BALANCE_STATE: PodBalanceState = {
  status: "unknown",
  pending: false,
  callbackErrored: false,
};

export type PodPortalRequestStatus =
  | "wallet-signing"
  | "source-submitted"
  | "source-mined"
  | "target-mined"
  | "callback-generated"
  | "pod-pending"
  | "callback-errored"
  | "succeeded"
  | "failed"
  | "burn-debt";

export interface PodPortalRequest {
  id: string;
  kind: "deposit" | "withdraw";
  chainId: number;
  sourceTxHash: string;
  requestId?: string;
  withdrawalId?: string;
  wallet: string;
  token: string;
  amount: string;
  fromBlock?: number;
  status: PodPortalRequestStatus;
  balanceRefreshPending?: boolean;
  message?: string;
  createdAt: number;
  updatedAt: number;
}

export const PRIVACY_PORTAL_ABI = [
  "function underlyingToken() view returns (address)",
  "function pToken() view returns (address)",
  "function decimals() view returns (uint8)",
  "function withdrawals(bytes32) view returns (address,address,uint256,uint256,uint256,bytes32,bytes32,uint8)",
  "function deposit(address recipient,uint256 amount,uint256 portalFee,uint256 mintCallbackFee) payable returns (bytes32)",
  "function depositNative(address recipient,uint256 amount,uint256 portalFee,uint256 mintCallbackFee) payable returns (bytes32)",
  "function nativeWrappedUnderlying() view returns (bool)",
  "function estimateDepositFees(uint256 amount) view returns (uint256 portalFee,bool usedDynamicPricing,uint256 mintTotalFee,uint256 mintCallbackFee)",
  "function estimateWithdrawFees(uint256 amount) view returns (uint256 portalFee,bool usedDynamicPricing,uint256 transferTotalFee,uint256 transferCallbackFee)",
  "function requestWithdrawWithPermit(address recipient,uint256 amount,uint256 portalFee,uint256 transferFee,uint256 transferCallbackFee,uint256 permitDeadline,uint8 v,bytes32 r,bytes32 s) payable returns (bytes32,bytes32)",
  "event DepositRequested(address indexed user,address indexed recipient,uint256 amount,bytes32 indexed mintRequestId)",
  "event WithdrawalRequested(bytes32 indexed withdrawalId,address indexed user,address indexed recipient,uint256 amount,bytes32 transferRequestId)",
  "event WithdrawalReleased(bytes32 indexed withdrawalId,address indexed recipient,uint256 amount)",
  "event BurnSubmitted(bytes32 indexed withdrawalId,uint256 amount,bytes32 burnRequestId)",
  "event BurnDebtRecorded(bytes32 indexed withdrawalId,uint256 amount,bytes reason)",
] as const;

export const POD_PTOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function nonces(address owner) view returns (uint256)",
  "function estimateFee() view returns (uint256 totalFeeWei,uint256 targetFeeWei,uint256 callbackFeeWei)",
  "function failedRequests(bytes32 requestId) view returns (bytes)",
  "function balanceOf(address account) view returns (tuple(tuple(uint256 high,uint256 low) high,tuple(uint256 high,uint256 low) low))",
  "function balanceWithState(address account) view returns (tuple(tuple(uint256 high,uint256 low) high,tuple(uint256 high,uint256 low) low) balance,bool pending,bool callbackErrored)",
  "function balanceOfWithStatus(address account) view returns (tuple(tuple(uint256 high,uint256 low) high,tuple(uint256 high,uint256 low) low),bool)",
  "error TransferAlreadyPending(address from, address to, bytes32 requestId)",
  "event TransferRequestSubmitted(address indexed from,address indexed to,bytes32 requestId)",
  "event Transfer(address indexed from,address indexed to,bytes senderValue,bytes receiverValue)",
  "event TransferFailed(address indexed from,address indexed to,bytes errorMsg)",
  "event RequestCallbackFailed(address indexed from,address indexed to,bytes32 requestId,bytes callbackData)",
] as const;

