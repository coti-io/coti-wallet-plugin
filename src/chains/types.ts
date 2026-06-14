import type { BridgeData } from "../hooks/useBridgeData";

export type UnlockStrategy = "snap" | "manual-aes-key";
export type PortalStrategy = "coti-bridge" | "pod-privacy-portal";

/**
 * Determines which COTI chain holds the AES key for this network.
 * - Testnet chains (Sepolia, COTI Testnet, Fiji) → COTI Testnet (7082400)
 * - Mainnet chains (Ethereum, COTI Mainnet, Avalanche) → COTI Mainnet (2632500)
 */
export type KeySourceChain = "coti-testnet" | "coti-mainnet";

export interface TokenConfig {
  symbol: string;
  name: string;
  icon: string;
  decimals: number;
  isPrivate: boolean;
  addressKey?: string;
  bridgeAddressKey?: string;
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
  explorerBaseUrl: string;
  addresses: Record<string, string>;
  tokens: TokenConfig[];
  unlockStrategy: UnlockStrategy;
  /**
   * Which COTI chain to use when retrieving/generating the AES key.
   * The Snap and onboard contract both live on COTI chains — this tells
   * the key provider which one to target for wallets connected to non-COTI networks.
   * Defaults to "coti-testnet" if not specified.
   */
  keySourceChain: KeySourceChain;
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
