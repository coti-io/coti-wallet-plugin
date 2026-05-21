export const CONTRACT_ADDRESSES: Record<number, Record<string, string>> = {
    // COTI Testnet
    7082400: {
    // Native
    PrivateCoti: "0x6cE8907414986E73De9e7D28d62Ea2080F8E88E1",
    PrivacyBridgeCotiNative: "0xb8Bb4fe953eAa53D528FAc95C1d9955B2b60D582",

    // Price Oracle
    CotiPriceConsumer: "0xD5EeD24e909AdE249b688671e32dcc013B236B74",

    // Public Tokens
    WETH: "0x8bca4e6bbE402DB4aD189A316137aD08206154FB",
    WBTC: "0x5dBDb2E5D51c3FFab5D6B862Caa11FCe1D83F492",
    USDT: "0x9e961430053cd5AbB3b060544cEcCec848693Cf0",
    USDC_E: "0x63f3D2Cc8F5608F57ce6E5Aa3590A2Beb428D19C",
    WADA: "0xe3E2cd3Abf412c73a404b9b8227B71dE3CfE829D",
    gCOTI: "0x878a42D3cB737DEC9E6c7e7774d973F46fd8ed4C",

    // Private Tokens
    "p.WETH": "0xF009BADb181d471995a1CFF406C3Db7B180F64eA",
    "p.WBTC": "0xB50F1680a4C69145ABc09A2A71c8D5b8051578cF",
    "p.USDT": "0xcEF137E96eDF68EE99D4CdEa7085f154d74895cD",
    "p.USDC_E": "0x37f78dcCd15876F74391EF1F01b76557D9FF1dea",
    "p.WADA": "0x1245f50a3E9129A219b4bf66D10fEaEA47467B69",
    "p.gCOTI": "0x1503b02a4Aa27812306c65116FD23b733603F142",

    // Bridges
    PrivacyBridgeWETH: "0x1841071A0296364739370a6d2F64c0eE46361fA0",
    PrivacyBridgeWBTC: "0x362faD66210401ADfAf27B98776F1e8D21dfc529",
    PrivacyBridgeUSDT: "0x73116aa5a50cADca47FD03Ca0B80D133346442FA",
    PrivacyBridgeUSDCe: "0x9C92Ad40553758C3d11Dcd8495Ee0ce3fd8fE0A1",
    PrivacyBridgeWADA: "0x3cB6e1E9cd504669DAb49910c30cDAfA8D05B641",
    PrivacyBridgegCOTI: "0x8A6ca3984Cb187f90C9Bd24c71C70eF97A71A8fA"
  },
  // COTI Mainnet
    2632500: {
      // Native
      PrivateCoti: "0xE4D2D9379df49cc6628Ce27134b924D695E8adAe",
      PrivacyBridgeCotiNative: "0xE736Cf6123dFf5d064Bb575C676290a0133652d0",

      // Price Oracle
      CotiPriceConsumer: "0xb2Ef3da8a6CFA06e367379F566CFb3db7619DE54",

      // Public Tokens
      WETH: "0x639aCc80569c5FC83c6FBf2319A6Cc38bBfe26d1",
      WBTC: "0x8C39B1fD0e6260fdf20652Fc436d25026832bfEA",
      USDT: "0xfA6f73446b17A97a56e464256DA54AD43c2Cbc3E",
      USDC_E: "0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C",
      WADA: "0xe757Ca19d2c237AA52eBb1d2E8E4368eeA3eb331",
      gCOTI: "0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1",

      // Private Tokens
      "p.WETH": "0x32a2DC0a159f1Da93a73A7E7e006Eea96Feb8668",
      "p.WBTC": "0x68Dd530D0D6E6f1d993F3F09BC5794FE22943e24",
      "p.USDT": "0xb87d31Bf3a654685e947f7F03bf9438605858eb2",
      "p.USDC_E": "0x784591bbc64fb624c24429F7dc9707a2ba2dfF15",
      "p.WADA": "0xdF522E96CD96189dFD419049C847101E2B56FbdC",
      "p.gCOTI": "0x7f1d93C3820325Eb182bCf3170B32d4d8Ca753b7",

      // Bridges
      PrivacyBridgeWETH: "0xc5D8a25fe5063C8D12cF07684994635294F40F5c",
      PrivacyBridgeWBTC: "0x65976d76bD765c70b92568a8436a76789A097bEe",
      PrivacyBridgeUSDT: "0xf1c0ec7faC14c99CFeb18713A671C4cA882C816F",
      PrivacyBridgeUSDCe: "0xf33DF5312DF736362395468a2D083d16Ded006d3",
      PrivacyBridgeWADA: "0xB495912771F6F4A77412Af32b9924D06b33890E4",
      PrivacyBridgegCOTI: "0x8d544420a28B6c847E7C8f2815a0a2d336960508"
    }
};


export interface TokenConfig {
  symbol: string;
  name: string;
  icon: string;
  decimals: number;
  isPrivate: boolean;
  addressKey?: string;
  bridgeAddressKey?: string;
  /** Oracle price staleness timeout in seconds. Default: 1800 (30 min) */
  timeout?: number;
}

export const SUPPORTED_TOKENS: TokenConfig[] = [
  // Public Tokens
  { symbol: "COTI", name: "COTI", icon: "/icons/coti.svg", decimals: 18, isPrivate: false, bridgeAddressKey: "PrivacyBridgeCotiNative", timeout: 1800 },
  { symbol: "WETH", name: "Wrapped Ether", icon: "/icons/wETH.svg", decimals: 18, isPrivate: false, addressKey: "WETH", bridgeAddressKey: "PrivacyBridgeWETH", timeout: 1800 },
  { symbol: "WBTC", name: "Wrapped BTC", icon: "/icons/wBTC.svg", decimals: 8, isPrivate: false, addressKey: "WBTC", bridgeAddressKey: "PrivacyBridgeWBTC", timeout: 1800 },
  { symbol: "USDT", name: "Tether USD", icon: "/icons/usdt.svg", decimals: 6, isPrivate: false, addressKey: "USDT", bridgeAddressKey: "PrivacyBridgeUSDT", timeout: 1800 },
  { symbol: "USDC.e", name: "Bridged USDC", icon: "/icons/USDC.svg", decimals: 6, isPrivate: false, addressKey: "USDC_E", bridgeAddressKey: "PrivacyBridgeUSDCe", timeout: 1800 },
  { symbol: "WADA", name: "Wrapped ADA", icon: "/icons/wADA.svg", decimals: 6, isPrivate: false, addressKey: "WADA", bridgeAddressKey: "PrivacyBridgeWADA", timeout: 1800 },
  { symbol: "gCOTI", name: "gCOTI", icon: "/icons/gcoti.svg", decimals: 18, isPrivate: false, addressKey: "gCOTI", bridgeAddressKey: "PrivacyBridgegCOTI", timeout: 1800 },

  // Private Tokens
  { symbol: "p.COTI", name: "p.COTI", icon: "/icons/coti.svg", decimals: 18, isPrivate: true, addressKey: "PrivateCoti", bridgeAddressKey: "PrivacyBridgeCotiNative", timeout: 1800 },
  { symbol: "p.WETH", name: "p.WETH", icon: "/icons/wETH.svg", decimals: 18, isPrivate: true, addressKey: "p.WETH", bridgeAddressKey: "PrivacyBridgeWETH", timeout: 1800 },
  { symbol: "p.WBTC", name: "p.WBTC", icon: "/icons/wBTC.svg", decimals: 8, isPrivate: true, addressKey: "p.WBTC", bridgeAddressKey: "PrivacyBridgeWBTC", timeout: 1800 },
  { symbol: "p.USDT", name: "p.USDT", icon: "/icons/usdt.svg", decimals: 6, isPrivate: true, addressKey: "p.USDT", bridgeAddressKey: "PrivacyBridgeUSDT", timeout: 1800 },
  { symbol: "p.USDC.e", name: "p.USDC.e", icon: "/icons/USDC.svg", decimals: 6, isPrivate: true, addressKey: "p.USDC_E", bridgeAddressKey: "PrivacyBridgeUSDCe", timeout: 1800 },
  { symbol: "p.WADA", name: "p.WADA", icon: "/icons/wADA.svg", decimals: 6, isPrivate: true, addressKey: "p.WADA", bridgeAddressKey: "PrivacyBridgeWADA", timeout: 1800 },
  { symbol: "p.gCOTI", name: "p.gCOTI", icon: "/icons/gcoti.svg", decimals: 18, isPrivate: true, addressKey: "p.gCOTI", bridgeAddressKey: "PrivacyBridgegCOTI", timeout: 1800 },
];

export const MINIMUM_PORTAL_IN_AMOUNTS: Record<string, string> = {
  'WBTC': '0.0000145',
  'WETH': '0.000497',
  'WADA': '4',
  'COTI': '82',
  'gCOTI': '390',
  'USDT': '1',
  'USDC.e': '1'
};

export const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function transferFrom(address from, address to, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
] as const;

export { TOKEN_ABI, BRIDGE_ERC20_ABI, BRIDGE_ABI, COTI_PRICE_CONSUMER_ABI } from './abis';
