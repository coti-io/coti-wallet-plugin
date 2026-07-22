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
const P_AVAX = "0x0c58954d91392794A50F610dF8c84228D63BE9D4";
const P_USDC = "0xe2235E064a3CEB5F1765c3b095855549d3c8A8a4";
const P_MTT = "0xFC6283a9000d7D5Cf8A058A04A9ED90265Af1634";
const PORTAL_AVAX = "0x20e7239cd78BDf2E8f34c52947e54fE68D7b536F";
const PORTAL_USDC = "0x090D2dc8C38275939b9381Ff2aa53012Ff412E34";
const PORTAL_MTT = "0xf4100d21eB4B1a66aDde58A01D1E32356F268b3F";

export const avalancheFujiChain: ChainConfig = {
  id: AVALANCHE_FUJI_CHAIN_ID,
  hexId: "0xa869",
  name: "Avalanche Fuji",
  rpcUrl: AVALANCHE_FUJI_RPC_URL,
  rpcFallbackUrls: [AVALANCHE_FUJI_RPC_FALLBACK_URL],
  explorerBaseUrl: "https://testnet.snowscan.xyz",
  priceOracleAddress: "0xf2283ca93a6747c547a961c50d0393d549c57268",
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
    // PrivacyPortalFactory — pauseController of all portals above (verified on-chain 2026-07-16).
    PrivacyPortalFactory: "0xCf06fBf94Af5e9ECEb15aa1Ba6458b72521424FD",
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
