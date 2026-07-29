import type { ChainConfig } from "./types";

export const AVALANCHE_FUJI_CHAIN_ID = 43113;

/** Rate-limited under load — keep last in the fallback list for reads. */
const AVALANCHE_FUJI_QUIKNODE_RPC_URL =
  "https://twilight-small-rain.avalanche-testnet.quiknode.pro/ad1393483c2713058688a4e0fb47a308f29dd52d/ext/bc/C/rpc/";
const AVALANCHE_FUJI_PUBLICNODE_RPC_URL =
  "https://avalanche-fuji-c-chain-rpc.publicnode.com";
const AVALANCHE_FUJI_AVALANCHE_API_RPC_URL =
  "https://api.avax-test.network/ext/bc/C/rpc";

/** Prefer public RPCs first; QuikNode last (often returns HTTP 429). */
const AVALANCHE_FUJI_RPC_URL = AVALANCHE_FUJI_PUBLICNODE_RPC_URL;
const AVALANCHE_FUJI_RPC_FALLBACK_URLS = [
  AVALANCHE_FUJI_AVALANCHE_API_RPC_URL,
  AVALANCHE_FUJI_QUIKNODE_RPC_URL,
];

/** Underlying ERC-20s from PrivacyPortalConfig.json (Avalanche Fuji). */
const MTT = "0x328e70e1c52662cd5f19f824fcb8b463d77a6686";
const USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
const WAVAX = "0xd00ae08403B9bbb9124bB305C09058E32C39A48c";

/** Deployed PoD portal pairs from pod-ecosystem-integration deployConfig.json (Fuji). */
const P_AVAX = "0x74d47cD68203066c97BA99787Fe1e0c68Ce42b04";
const P_USDC = "0x21576D8CCE47d044C5815bd59eca1F6DA94c65A5";
const P_MTT = "0x02f284a1968160E1d3e4bC2BA3261be49725E765";
const PORTAL_AVAX = "0xe6932f6Ab846bf389f7ef355dd5830594623B8E5";
const PORTAL_USDC = "0xE75373ADb4AD1A5634a10f4644822943830b18c5";
const PORTAL_MTT = "0x758a8F9a216A95773DDf6F73004B85d59f224518";
const PRIVACY_PORTAL_FACTORY = "0xaf9327277cb370d536d2c8a9e15a0a7ff6c42c15";

export const avalancheFujiChain: ChainConfig = {
  id: AVALANCHE_FUJI_CHAIN_ID,
  hexId: "0xa869",
  name: "Avalanche Fuji",
  rpcUrl: AVALANCHE_FUJI_RPC_URL,
  rpcFallbackUrls: AVALANCHE_FUJI_RPC_FALLBACK_URLS,
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
    rpcUrls: [AVALANCHE_FUJI_RPC_URL, ...AVALANCHE_FUJI_RPC_FALLBACK_URLS],
    nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 },
    blockExplorerUrls: ["https://testnet.snowscan.xyz"],
  },
  indexPage: {
    showPodRequestTracker: true,
    amountModalGasLabel: "Estimated Network Gas",
    amountModalGasSymbol: "native",
  },
};
