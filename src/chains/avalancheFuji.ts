import type { ChainConfig } from "./types";

export const AVALANCHE_FUJI_CHAIN_ID = 43113;

const AVALANCHE_FUJI_RPC_URL =
  "https://twilight-small-rain.avalanche-testnet.quiknode.pro/ad1393483c2713058688a4e0fb47a308f29dd52d/ext/bc/C/rpc/";
const AVALANCHE_FUJI_RPC_FALLBACK_URL =
  "https://avalanche-fuji-c-chain-rpc.publicnode.com";

/** Underlying ERC-20s from PrivacyPortalConfig.json (Avalanche Fuji). */
const MTT = "0x328e70e1c52662cd5f19f824fcb8b463d77a6686";
const USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
const WAVAX = "0xd00ae08403B9bbb9124bB305C09058E32C39A48c";

/** Deployed PoD portal pairs from pod-ecosystem-integration deployConfig.json (Fuji). */
const P_AVAX = "0x5910f4f38660A7932485a6De854e9895E6d78D85";
const P_USDC = "0x01635605900E3200679079BD35AF0BefF25e2072";
const P_MTT = "0x7BE9Cd10b51eFf6FFCE8f620EA17f6C4dc37a379";
const PORTAL_AVAX = "0x1A775D5a9d034f27dB1328B446088E93BC1bF9EE";
const PORTAL_USDC = "0xa15aBf3BBf23795F7F6d018D592B448F3af1A2e5";
const PORTAL_MTT = "0x397b1DE4EbAaC2e522B583120C29ff97F011c84c";
const PRIVACY_PORTAL_FACTORY = "0x0e6b35da5aa3e3aeb6f98471821d5b16552efced";

export const avalancheFujiChain: ChainConfig = {
  id: AVALANCHE_FUJI_CHAIN_ID,
  hexId: "0xa869",
  name: "Avalanche Fuji",
  rpcUrl: AVALANCHE_FUJI_RPC_URL,
  rpcFallbackUrls: [AVALANCHE_FUJI_RPC_FALLBACK_URL],
  explorerBaseUrl: "https://testnet.snowscan.xyz",
  priceOracleAddress: "0x95ce33378c88734f3d86b51a4c6dc588722995fd",
  unlockStrategy: "manual-aes-key",
  portalStrategy: "pod-privacy-portal",
  podFeeEstimation: {
    deposit: { forwardGasLimit: 850_000n, callBackGasLimit: 2_000_000n },
    withdraw: { forwardGasLimit: 900_000n, callBackGasLimit: 2_000_000n },
    // forwardDataSize matches PodERC20.FEE_ESTIMATE_REMOTE_CALL_SIZE (encrypted itUint256).
    transfer: {
      forwardGasLimit: 850_000n,
      callBackGasLimit: 2_000_000n,
      forwardDataSize: 512n,
    },
  },
  addresses: {
    MTT,
    USDC,
    WAVAX,
    "p.MTT": P_MTT,
    "p.USDC": P_USDC,
    "p.AVAX": P_AVAX,
    PrivacyPortalMTT: PORTAL_MTT,
    PrivacyPortalUSDC: PORTAL_USDC,
    PrivacyPortalAVAX: PORTAL_AVAX,
    PrivacyPortalFactory: PRIVACY_PORTAL_FACTORY,
  },
  tokens: [
    {
      symbol: "MTT",
      name: "MyTestToken",
      icon: "/icons/coti.svg",
      decimals: 18,
      isPrivate: false,
      addressKey: "MTT",
      bridgeAddressKey: "PrivacyPortalMTT",
      supportedChainIds: [AVALANCHE_FUJI_CHAIN_ID],
    },
    {
      symbol: "p.MTT",
      name: "Private MyTestToken",
      icon: "/icons/coti.svg",
      decimals: 18,
      isPrivate: true,
      addressKey: "p.MTT",
      bridgeAddressKey: "PrivacyPortalMTT",
      supportedChainIds: [AVALANCHE_FUJI_CHAIN_ID],
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      icon: "/icons/USDC.svg",
      decimals: 6,
      isPrivate: false,
      addressKey: "USDC",
      bridgeAddressKey: "PrivacyPortalUSDC",
      supportedChainIds: [AVALANCHE_FUJI_CHAIN_ID],
    },
    {
      symbol: "p.USDC",
      name: "Private USDC",
      icon: "/icons/USDC.svg",
      decimals: 6,
      isPrivate: true,
      addressKey: "p.USDC",
      bridgeAddressKey: "PrivacyPortalUSDC",
      supportedChainIds: [AVALANCHE_FUJI_CHAIN_ID],
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
      supportedChainIds: [AVALANCHE_FUJI_CHAIN_ID],
    },
    {
      symbol: "p.AVAX",
      name: "Private WAVAX",
      icon: "/icons/avalanche.svg",
      decimals: 18,
      isPrivate: true,
      addressKey: "p.AVAX",
      bridgeAddressKey: "PrivacyPortalAVAX",
      supportedChainIds: [AVALANCHE_FUJI_CHAIN_ID],
    },
  ],
  walletNetwork: {
    chainId: "0xa869",
    chainName: "Avalanche Fuji Testnet",
    rpcUrls: [AVALANCHE_FUJI_RPC_URL, AVALANCHE_FUJI_RPC_FALLBACK_URL],
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    blockExplorerUrls: ["https://testnet.snowscan.xyz"],
  },
  indexPage: {
    showPodRequestTracker: true,
    amountModalGasLabel: "Estimated Network Gas",
    amountModalGasSymbol: "native",
  },
};
