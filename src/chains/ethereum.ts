import type { ChainConfig } from "./types";

/** Ethereum mainnet. */
export const ETHEREUM_MAINNET_CHAIN_ID = 1;

const ETHEREUM_MAINNET_RPC_URL = "https://ethereum-rpc.publicnode.com";
const ETHEREUM_MAINNET_RPC_FALLBACK_URL = "https://eth.llamarpc.com";

/**
 * Canonical underlyings from pod-ecosystem-integration `deployConfig.mainnet.yaml`
 * (Ethereum / 1). PoD portal + pToken addresses are not filled there yet — leave
 * empty until mainnet portals are deployed; the UI will show the chain but
 * portal ops stay unavailable until those keys are set.
 */
const WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
const USDC = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

const P_ETH = "";
const P_USDC = "";
const PORTAL_ETH = "";
const PORTAL_USDC = "";
const PRIVACY_PORTAL_FACTORY = "";
const PRICE_ORACLE = "";

export const ethereumMainnetChain: ChainConfig = {
  id: ETHEREUM_MAINNET_CHAIN_ID,
  hexId: "0x1",
  name: "Ethereum",
  rpcUrl: ETHEREUM_MAINNET_RPC_URL,
  rpcFallbackUrls: [ETHEREUM_MAINNET_RPC_FALLBACK_URL],
  explorerBaseUrl: "https://etherscan.io",
  priceOracleAddress: PRICE_ORACLE || undefined,
  unlockStrategy: "manual-aes-key",
  portalStrategy: "pod-privacy-portal",
  podFeeEstimation: {
    deposit: { forwardGasLimit: 850_000n, callBackGasLimit: 2_000_000n },
    withdraw: { forwardGasLimit: 900_000n, callBackGasLimit: 2_000_000n },
    transfer: {
      forwardGasLimit: 850_000n,
      callBackGasLimit: 2_000_000n,
      forwardDataSize: 512n,
    },
  },
  addresses: {
    WETH,
    USDC,
    "p.ETH": P_ETH,
    "p.USDC": P_USDC,
    PrivacyPortalETH: PORTAL_ETH,
    PrivacyPortalUSDC: PORTAL_USDC,
    PrivacyPortalFactory: PRIVACY_PORTAL_FACTORY,
  },
  tokens: [
    {
      symbol: "USDC",
      name: "USD Coin",
      icon: "/icons/USDC.svg",
      decimals: 6,
      isPrivate: false,
      addressKey: "USDC",
      bridgeAddressKey: "PrivacyPortalUSDC",
      supportedChainIds: [ETHEREUM_MAINNET_CHAIN_ID],
    },
    {
      symbol: "p.USDC",
      name: "Private USDC",
      icon: "/icons/USDC.svg",
      decimals: 6,
      isPrivate: true,
      addressKey: "p.USDC",
      bridgeAddressKey: "PrivacyPortalUSDC",
      supportedChainIds: [ETHEREUM_MAINNET_CHAIN_ID],
    },
    {
      symbol: "ETH",
      name: "Ether",
      icon: "/icons/wETH.svg",
      decimals: 18,
      isPrivate: false,
      isNative: true,
      addressKey: "WETH",
      bridgeAddressKey: "PrivacyPortalETH",
      supportedChainIds: [ETHEREUM_MAINNET_CHAIN_ID],
    },
    {
      symbol: "p.ETH",
      name: "Private WETH",
      icon: "/icons/wETH.svg",
      decimals: 18,
      isPrivate: true,
      addressKey: "p.ETH",
      bridgeAddressKey: "PrivacyPortalETH",
      supportedChainIds: [ETHEREUM_MAINNET_CHAIN_ID],
    },
  ],
  walletNetwork: {
    chainId: "0x1",
    chainName: "Ethereum Mainnet",
    rpcUrls: [ETHEREUM_MAINNET_RPC_URL, ETHEREUM_MAINNET_RPC_FALLBACK_URL],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://etherscan.io"],
  },
  indexPage: {
    showPodRequestTracker: true,
    amountModalGasLabel: "Estimated Network Gas",
    amountModalGasSymbol: "native",
  },
};
