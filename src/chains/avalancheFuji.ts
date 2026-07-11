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

/** Deployed PoD portal pairs from pod-mpc-lib deployConfig.json (Fuji). */
const P_AVAX = "0xe7956aDaC668b563Dc77eD29C5E7A4Ef5edFB3FB";
const P_USDC = "0x4C8dD09336BB7A219bef9448914a9E4621cE3645";
const PORTAL_AVAX = "0x25E7a1BddF4b9696F19A726Cb2Ce550467527e90";
const PORTAL_USDC = "0x956D8994a56F65d2fF1F9b09565857a09374D852";

export const avalancheFujiChain: ChainConfig = {
  id: AVALANCHE_FUJI_CHAIN_ID,
  hexId: "0xa869",
  name: "Avalanche Fuji",
  rpcUrl: AVALANCHE_FUJI_RPC_URL,
  rpcFallbackUrls: [AVALANCHE_FUJI_RPC_FALLBACK_URL],
  explorerBaseUrl: "https://testnet.snowscan.xyz",
  priceOracleAddress: "0xb06340c020274ef5d92f664070966402a4d27712",
  unlockStrategy: "manual-aes-key",
  portalStrategy: "pod-privacy-portal",
  podFeeEstimation: {
    deposit: { forwardGasLimit: 850_000n, callBackGasLimit: 2_000_000n },
    withdraw: { forwardGasLimit: 900_000n, callBackGasLimit: 2_000_000n },
  },
  addresses: {
    MTT,
    USDC,
    WAVAX,
    "p.MTT": "0x8F34570CEAD49273D5DA8A0E25e728eCC28af267",
    "p.USDC": P_USDC,
    "p.AVAX": P_AVAX,
    PrivacyPortalMTT: "0x64D99D761aC68D1a495B4f7E5bE7277586EDFE78",
    PrivacyPortalUSDC: PORTAL_USDC,
    PrivacyPortalAVAX: PORTAL_AVAX,
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
    amountModalGasLabel: "Estimated Gas and PoD fee",
    amountModalGasSymbol: "native",
  },
};
