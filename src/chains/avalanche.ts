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
const USDT = "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7";
const WBTC = "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c";
const WETH = "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB";
const WAVAX = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";

const P_USDC = "0x13AE6A6429fA6F2dfD0DBE79C85B28DdC74111BE";
const P_USDT = "0xa492A5c5D3bC11f24138A029E0b6083fC4eaab3b";
const P_WBTC = "0x052777CCCa2577dafbB653db3640504025FcDfEC";
const P_WETH = "0x2720dFE9766d00CEDE64946A65bFA99F68991E72";
const P_AVAX = "0xf632A73D5923BBC1F87BA727D7261436bA768c85";
const PORTAL_USDC = "0xeAce463ea0B85E728D2d5404a0653Af50113356c";
const PORTAL_USDT = "0x9BBf65fE20B871568cE1d34D278460F0c96F624c";
const PORTAL_WBTC = "0x15d5b023baB985154Aca592C37C761787b9F0403";
const PORTAL_WETH = "0x9C64D0d2DAe8C4aEa5662d4D154f59FDd683ceFC";
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
    USDT,
    WBTC,
    WETH,
    WAVAX,
    "p.USDC": P_USDC,
    "p.USDT": P_USDT,
    "p.WBTC": P_WBTC,
    "p.WETH": P_WETH,
    "p.AVAX": P_AVAX,
    PrivacyPortalUSDC: PORTAL_USDC,
    PrivacyPortalUSDT: PORTAL_USDT,
    PrivacyPortalWBTC: PORTAL_WBTC,
    PrivacyPortalWETH: PORTAL_WETH,
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
      symbol: "USDT",
      name: "Tether USD",
      icon: "/icons/usdt.svg",
      decimals: 6,
      isPrivate: false,
      addressKey: "USDT",
      bridgeAddressKey: "PrivacyPortalUSDT",
      supportedChainIds: [AVALANCHE_C_CHAIN_ID],
    },
    {
      symbol: "p.USDT",
      name: "Private USDT",
      icon: "/icons/usdt.svg",
      decimals: 6,
      isPrivate: true,
      addressKey: "p.USDT",
      bridgeAddressKey: "PrivacyPortalUSDT",
      supportedChainIds: [AVALANCHE_C_CHAIN_ID],
    },
    {
      symbol: "WBTC",
      name: "Wrapped BTC",
      icon: "/icons/wBTC.svg",
      decimals: 8,
      isPrivate: false,
      addressKey: "WBTC",
      bridgeAddressKey: "PrivacyPortalWBTC",
      supportedChainIds: [AVALANCHE_C_CHAIN_ID],
    },
    {
      symbol: "p.WBTC",
      name: "Private WBTC",
      icon: "/icons/wBTC.svg",
      decimals: 8,
      isPrivate: true,
      addressKey: "p.WBTC",
      bridgeAddressKey: "PrivacyPortalWBTC",
      supportedChainIds: [AVALANCHE_C_CHAIN_ID],
    },
    {
      symbol: "WETH",
      name: "Wrapped Ether",
      icon: "/icons/wETH.svg",
      decimals: 18,
      isPrivate: false,
      addressKey: "WETH",
      bridgeAddressKey: "PrivacyPortalWETH",
      supportedChainIds: [AVALANCHE_C_CHAIN_ID],
    },
    {
      symbol: "p.WETH",
      name: "Private WETH",
      icon: "/icons/wETH.svg",
      decimals: 18,
      isPrivate: true,
      addressKey: "p.WETH",
      bridgeAddressKey: "PrivacyPortalWETH",
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
