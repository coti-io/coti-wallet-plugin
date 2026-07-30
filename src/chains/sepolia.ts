import type { ChainConfig } from "./types";

export const SEPOLIA_CHAIN_ID = 11155111;

const SEPOLIA_RPC_URL =
  "https://damp-greatest-ensemble.ethereum-sepolia.quiknode.pro/181816e3606c96014a5cfbac3eedb823d79dde08/";
const SEPOLIA_RPC_FALLBACK_URL = "https://ethereum-sepolia-rpc.publicnode.com";

/** Underlying ERC-20s from PrivacyPortalConfig.json (Sepolia). */
const WETH = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const MTT = "0xd3f5c63f4D87D2235b295FbA83351d31d0eD1BeE";

/** Deployed PoD portal pairs from pod-ecosystem-integration deployConfig.json (Sepolia). */
const P_ETH = "0xd33A363459c6Ee0C4F8504E380E8D3Aa4F209116";
const P_USDC = "0xD7B3D49F85000489708B7db5B0f1a8693Fc707f3";
const P_MTT = "0x0510F0b32828D5fB472dE5A5bE30b370c5D1a056";
const PORTAL_ETH = "0x2C8B9bBeC8604143863c90D02FdF626a7D5a51C5";
const PORTAL_USDC = "0x0D02bD729698630c6f9776cDE1C8e5E00146202e";
const PORTAL_MTT = "0x7e1fecDBC7393A7165Ae7f5F1c56baA4D12c6fc0";
const PRIVACY_PORTAL_FACTORY = "0x11a27bdf2b2c251609d78d5c9b53b3c2d71d663c";

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
  priceOracleAddress: "0x71f0deac8adb89b7f1b09b38e2531e06bcca0b03",
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
