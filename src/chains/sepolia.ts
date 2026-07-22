import type { ChainConfig } from "./types";

export const SEPOLIA_CHAIN_ID = 11155111;

const SEPOLIA_RPC_URL =
  "https://sepolia.infura.io/v3/ed65559ebd384beabfee7a97c266d6bf";
const SEPOLIA_RPC_FALLBACK_URL = "https://ethereum-sepolia-rpc.publicnode.com";

/** Underlying ERC-20s from PrivacyPortalConfig.json (Sepolia). */
const WETH = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const MTT = "0xd3f5c63f4D87D2235b295FbA83351d31d0eD1BeE";

/** Deployed PoD portal pairs from pod-ecosystem-integration deployConfig.json (Sepolia). */
const P_ETH = "0xD586736543F7666d1adbF862B769Ba838a9a3deD";
const P_USDC = "0xc04Cb7256E849C34877D801A77f9165BaC209c06";
const P_MTT = "0x1566ADA98695D39b2D5A8e1359d7Af9D567c74ab";
const PORTAL_ETH = "0x7666F6576956530E2D56CDB548b71e62286d1d18";
const PORTAL_USDC = "0x79679CE36664c3b1360501B2c7ea6bbee65a2717";
const PORTAL_MTT = "0x621E744eF059262Fd531a0f345d38Ce31d92D105";

export const sepoliaChain: ChainConfig = {
  id: SEPOLIA_CHAIN_ID,
  hexId: "0xaa36a7",
  name: "Sepolia",
  rpcUrl: SEPOLIA_RPC_URL,
  rpcFallbackUrls: [SEPOLIA_RPC_FALLBACK_URL],
  explorerBaseUrl: "https://eth-sepolia.blockscout.com",
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
  priceOracleAddress: "0x3281160888138e786c3eb0f4f4cc51453d8dfeff",
  addresses: {
    MTT,
    WETH,
    USDC,
    "p.MTT": P_MTT,
    "p.USDC": P_USDC,
    "p.ETH": P_ETH,
    PrivacyPortalMTT: PORTAL_MTT,
    PrivacyPortalUSDC: PORTAL_USDC,
    PrivacyPortalETH: PORTAL_ETH,
    // PrivacyPortalFactory — pauseController of all portals above (verified on-chain 2026-07-16).
    PrivacyPortalFactory: "0xE26A0dB663a9D546AB4dFd02d8B4305E3DF9cE73",
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
      supportedChainIds: [SEPOLIA_CHAIN_ID],
    },
    {
      symbol: "p.MTT",
      name: "Private MyTestToken",
      icon: "/icons/coti.svg",
      decimals: 18,
      isPrivate: true,
      addressKey: "p.MTT",
      bridgeAddressKey: "PrivacyPortalMTT",
      supportedChainIds: [SEPOLIA_CHAIN_ID],
    },
    {
      symbol: "USDC",
      name: "USD Coin",
      icon: "/icons/USDC.svg",
      decimals: 6,
      isPrivate: false,
      addressKey: "USDC",
      bridgeAddressKey: "PrivacyPortalUSDC",
      supportedChainIds: [SEPOLIA_CHAIN_ID],
    },
    {
      symbol: "p.USDC",
      name: "Private USDC",
      icon: "/icons/USDC.svg",
      decimals: 6,
      isPrivate: true,
      addressKey: "p.USDC",
      bridgeAddressKey: "PrivacyPortalUSDC",
      supportedChainIds: [SEPOLIA_CHAIN_ID],
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
      supportedChainIds: [SEPOLIA_CHAIN_ID],
    },
    {
      symbol: "p.ETH",
      name: "Private WETH",
      icon: "/icons/wETH.svg",
      decimals: 18,
      isPrivate: true,
      addressKey: "p.ETH",
      bridgeAddressKey: "PrivacyPortalETH",
      supportedChainIds: [SEPOLIA_CHAIN_ID],
    },
  ],
  walletNetwork: {
    chainId: "0xaa36a7",
    chainName: "Sepolia",
    rpcUrls: [SEPOLIA_RPC_URL, SEPOLIA_RPC_FALLBACK_URL],
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    blockExplorerUrls: ["https://eth-sepolia.blockscout.com"],
  },
  indexPage: {
    showPodRequestTracker: true,
    amountModalGasLabel: "Estimated Network Gas",
    amountModalGasSymbol: "native",
  },
};
