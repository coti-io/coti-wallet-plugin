import type { BridgeData } from "../hooks/useBridgeData";

export type UnlockStrategy = "snap" | "manual-aes-key";
export type PortalStrategy = "coti-bridge" | "pod-privacy-portal";

export interface TokenConfig {
  symbol: string;
  name: string;
  icon: string;
  decimals: number;
  isPrivate: boolean;
  /** Wrapped ERC-20 used by the portal contract as underlying collateral. */
  addressKey?: string;
  bridgeAddressKey?: string;
  /**
   * When true, Portal In sends native coin (no ERC-20 approve) via `depositNative`.
   * Balances use the chain native asset; `addressKey` still points at the wrapped token.
   */
  isNative?: boolean;
  timeout?: number;
  supportedChainIds?: number[];
}

export interface WalletNetworkConfig {
  chainId: string;
  chainName: string;
  rpcUrls: string[];
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorerUrls: string[];
}

export interface ChainIndexPageUi {
  /** Extra section below token cards (e.g. PoD request tracker on Sepolia). */
  showPodRequestTracker: boolean;
  /** Label for the gas estimate row in the amount modal. */
  amountModalGasLabel: string;
  /** Symbol shown next to the gas estimate (chain native vs fixed COTI branding). */
  amountModalGasSymbol: "native" | "COTI";
}

export interface ChainConfig {
  id: number;
  hexId: string;
  name: string;
  rpcUrl: string;
  /** Secondary RPC endpoints tried when the primary {@link rpcUrl} is unavailable. */
  rpcFallbackUrls?: string[];
  explorerBaseUrl: string;
  /** PoD inbox on this host chain (for fee quotes and request tracking). */
  podInboxAddress?: string;
  addresses: Record<string, string>;
  tokens: TokenConfig[];
  unlockStrategy: UnlockStrategy;
  portalStrategy: PortalStrategy;
  walletNetwork: WalletNetworkConfig;
  getBridgeDataOverride?: (addresses: Record<string, string>) => BridgeData[];
  /** Main Index page: which chrome and labels to show for this chain. */
  indexPage: ChainIndexPageUi;
}

/** Index page UI with `amountModalGasSymbol` resolved to a display string (e.g. ETH vs COTI). */
export interface ResolvedIndexPageUi {
  showPodRequestTracker: boolean;
  amountModalGasLabel: string;
  amountModalGasSymbol: string;
}
