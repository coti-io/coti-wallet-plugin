import type { ChainConfig } from "./types";

/** Avalanche C-Chain (mainnet). */
export const AVALANCHE_C_CHAIN_ID = 43114;

const AVALANCHE_C_PUBLICNODE_RPC_URL =
  "https://avalanche-c-chain-rpc.publicnode.com";
const AVALANCHE_C_AVALANCHE_API_RPC_URL =
  "https://api.avax.network/ext/bc/C/rpc";

const AVALANCHE_C_RPC_URL = AVALANCHE_C_PUBLICNODE_RPC_URL;
const AVALANCHE_C_RPC_FALLBACK_URLS = [AVALANCHE_C_AVALANCHE_API_RPC_URL];

/**
 * Underlying + PoD portal pairs from pod-ecosystem-integration
 * `deployConfig.mainnet.yaml` (Avalanche C-Chain / 43114).
 */
const USDC = "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E";
const WAVAX = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";

const P_USDC = "0x13AE6A6429fA6F2dfD0DBE79C85B28DdC74111BE";
const P_AVAX = "0xf632A73D5923BBC1F87BA727D7261436bA768c85";
const PORTAL_USDC = "0xeAce463ea0B85E728D2d5404a0653Af50113356c";
const PORTAL_AVAX = "0x3b17A57Ecd4B74603A171024203f34E9FC473255";
const PRIVACY_PORTAL_FACTORY = "0xc25ac091b5a6377024f8cbd90c836eac185c3a57";
/** PoDPriceOracle (`chains.43114.priceOracle`), not the Chainlink live adapter. */
const PRICE_ORACLE = "0xDF887895A9aD1F44D80d8924832A5eE302CcC7bC";

export const avalancheCChain: ChainConfig = {
  id: AVALANCHE_C_CHAIN_ID,
  hexId: "0xa86a",
  name: "Avalanche",
  rpcUrl: AVALANCHE_C_RPC_URL,
  rpcFallbackUrls: AVALANCHE_C_RPC_FALLBACK_URLS,
  explorerBaseUrl: "https://snowscan.xyz",
  priceOracleAddress: PRICE_ORACLE,
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
    USDC,
    WAVAX,
    "p.USDC": P_USDC,
    "p.AVAX": P_AVAX,
    PrivacyPortalUSDC: PORTAL_USDC,
    PrivacyPortalAVAX: PORTAL_AVAX,
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
      supportedChainIds: [AVALANCHE_C_CHAIN_ID],
    },
    {
      symbol: "p.USDC",
      name: "Private USDC",
      icon: "/icons/USDC.svg",
      decimals: 6,
      isPrivate: true,
      addressKey: "p.USDC",
      bridgeAddressKey: "PrivacyPortalUSDC",
      supportedChainIds: [AVALANCHE_C_CHAIN_ID],
    },
    {
      symbol: "AVAX",
      name: "Avalanche",
      icon: "/icons/avalanche.svg",
      decimals: 18,
      isPrivate: false,
      isNative: true,
      addressKey: "WAVAX",
      bridgeAddressKey: "PrivacyPortalAVAX",
      supportedChainIds: [AVALANCHE_C_CHAIN_ID],
    },
    {
      symbol: "p.AVAX",
      name: "Private WAVAX",
      icon: "/icons/avalanche.svg",
      decimals: 18,
      isPrivate: true,
      addressKey: "p.AVAX",
      bridgeAddressKey: "PrivacyPortalAVAX",
      supportedChainIds: [AVALANCHE_C_CHAIN_ID],
    },
  ],
  walletNetwork: {
    chainId: "0xa86a",
    chainName: "Avalanche C-Chain",
    rpcUrls: [AVALANCHE_C_RPC_URL, ...AVALANCHE_C_RPC_FALLBACK_URLS],
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    blockExplorerUrls: ["https://snowscan.xyz"],
  },
  indexPage: {
    showPodRequestTracker: true,
    amountModalGasLabel: "Estimated Network Gas",
    amountModalGasSymbol: "native",
  },
};
