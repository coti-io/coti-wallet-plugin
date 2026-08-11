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
const MTT = "0x0fd36eae65230037760054d25ec4617156950a53";
const USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
const WAVAX = "0xd00ae08403B9bbb9124bB305C09058E32C39A48c";

/** Deployed PoD portal pairs from pod-ecosystem-integration deployConfig.testnet.yaml (Fuji). */
const P_AVAX = "0x5b904faF2C7458a59D5d48E255d48A0eD6cEf539";
const P_USDC = "0xEfD3A5121F1dBA2431F3cEfa4f0d66B43444449D";
const P_MTT = "0x68A984197345eea57ED33dB37D6Ec6f0F0922747";
const PORTAL_AVAX = "0xE181b3B2D76C8936B42089b250902407C32EC59e";
const PORTAL_USDC = "0x6af371e686635aC517AA35E9560CFB8aBdD8475c";
const PORTAL_MTT = "0xFFef82eff8643110c7eCf2627EF73d050f395D7C";
const PRIVACY_PORTAL_FACTORY = "0xe6401d65fae91e2160d230c1e76176bb900c5466";

export const avalancheFujiChain: ChainConfig = {
  id: AVALANCHE_FUJI_CHAIN_ID,
  hexId: "0xa869",
  name: "Avalanche Fuji",
  rpcUrl: AVALANCHE_FUJI_RPC_URL,
  rpcFallbackUrls: AVALANCHE_FUJI_RPC_FALLBACK_URLS,
  explorerBaseUrl: "https://testnet.snowscan.xyz",
  priceOracleAddress: "0xcc077e4211d58efe944d95f10ae0a6b6b84f5daf",
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
