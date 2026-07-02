export interface Token {
  symbol: string;
  name: string;
  balance: string;
  isPrivate: boolean;
  icon?: string;
  addressKey?: string;
  bridgeAddressKey?: string;
  decimals?: number;
  isNative?: boolean;
  supportedChainIds?: number[];
}

export interface ToastState {
  visible: boolean;
  title: string;
  message: string | React.ReactNode;
}

export type SwapProgressStage =
  | 'approve-start'
  | 'approve-complete'
  | 'transfer-start'
  | 'transfer-complete';

/** Shared inputs for the privacy bridge coordinator and sub-hooks. */
export interface UsePrivacyBridgeProps {
  isConnected: boolean;
  walletAddress: string;
  publicTokens: Token[];
  refreshPrivateBalances?: () => Promise<boolean>;
  refreshPublicBalances?: () => Promise<boolean>;
  setPublicTokens: React.Dispatch<React.SetStateAction<Token[]>>;
  setPrivateTokens: React.Dispatch<React.SetStateAction<Token[]>>;
  setToastState: React.Dispatch<React.SetStateAction<ToastState>>;
  amount: string;
  setAmount: React.Dispatch<React.SetStateAction<string>>;
  direction: 'to-private' | 'to-public';
  setDirection: React.Dispatch<React.SetStateAction<'to-private' | 'to-public'>>;
  selectedTokenIndex: number;
  setSelectedTokenIndex: React.Dispatch<React.SetStateAction<number>>;
  error: { title: string; message: string } | null;
  hasSnap: boolean;
  setHasSnap: (hasSnap: boolean) => void;
  handleOnboard: () => Promise<string | null>;
  upsertPodRequest?: (request: import('../../contracts/pod').PodPortalRequest) => void;
  /** When set, the Snap gate is bypassed — no Snap interaction needed for bridging. */
  sessionAesKey?: string | null;
}
