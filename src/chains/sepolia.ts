import type { ChainConfig } from "./types";

export const SEPOLIA_CHAIN_ID = 11155111;

const SEPOLIA_RPC_URL =
  "https://sepolia.infura.io/v3/ed65559ebd384beabfee7a97c266d6bf";
const SEPOLIA_RPC_FALLBACK_URL = "https://ethereum-sepolia-rpc.publicnode.com";

/** Underlying ERC-20s from PrivacyPortalConfig.json (Sepolia). */
const WETH = "0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const MTT = "0xd3f5c63f4D87D2235b295FbA83351d31d0eD1BeE";

/** Deployed PoD portal pairs from pod-mpc-lib deployConfig.json (Sepolia). */
const P_ETH = "0x28f6CFc45c3D4C13E6BAB034cb05278Db496b9d6";
const P_USDC = "0xc727D2Ab43bF0d4cab75FD5C046BA38899ca988a";
const PORTAL_ETH = "0xa4efc209144565126c034dfD23208f040748923f";
const PORTAL_USDC = "0xDc0b0e5681C17A8449Baf5aBB130d7664Bb56d5a";

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
  priceOracleAddress: "0x7eecdceec31d285aee99c7960b405f63593903d1",
  addresses: {
    MTT,
    WETH,
    USDC,
    "p.MTT": "0x46f9f46971f6bEc21Fe5d42909Ef99D1D2af43c4",
    "p.USDC": P_USDC,
    "p.ETH": P_ETH,
    PrivacyPortalMTT: "0xaCD7fE838354Dd72147d9c387558477D7d4D6514",
    PrivacyPortalUSDC: PORTAL_USDC,
    PrivacyPortalETH: PORTAL_ETH,
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
