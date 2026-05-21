export const CONTRACT_ADDRESSES: Record<number, Record<string, string>> = {
    // COTI Testnet
    7082400: {
    // Native
    PrivateCoti: "0x6cE8907414986E73De9e7D28d62Ea2080F8E88E1",
    PrivacyBridgeCotiNative: "0x313020ac96cCDc3F32781b5afC85D1b50E2217F4",

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
    PrivacyBridgeWETH: "0x2f2f853abb93762B403b21Ef114312A2c0FF6c95",
    PrivacyBridgeWBTC: "0x7300581c25c4e8ecA850386007892F947E0751b3",
    PrivacyBridgeUSDT: "0x478B202464623Ad75BA956b448cbE49F64EF1600",
    PrivacyBridgeUSDCe: "0x83218437cF358C1280Af714655645ACa6bd99e81",
    PrivacyBridgeWADA: "0x8146e5BfafE1B27336ca949959d2dDC72C09ad73",
    PrivacyBridgegCOTI: "0x7e850698B14546128D1C3f165457cF406483cF8C"
  },
  // COTI Mainnet
    2632500: {
      // Native
      PrivateCoti: "0xD2F2692B83C3ecDF2EAa0f7c2632BBd46Ae1cC91",
      PrivacyBridgeCotiNative: "0x44D864973392064304dD88E2BDef39fF1ab11b7b",

      // Price Oracle
      CotiPriceConsumer: "0x830c5112E677459648C1aa7Bc5Dd65A36d71Aa4D",

      // Public Tokens
      WETH: "0x639aCc80569c5FC83c6FBf2319A6Cc38bBfe26d1",
      WBTC: "0x8C39B1fD0e6260fdf20652Fc436d25026832bfEA",
      USDT: "0xfA6f73446b17A97a56e464256DA54AD43c2Cbc3E",
      USDC_E: "0xf1Feebc4376c68B7003450ae66343Ae59AB37D3C",
      WADA: "0xe757Ca19d2c237AA52eBb1d2E8E4368eeA3eb331",
      gCOTI: "0x7637C7838EC4Ec6b85080F28A678F8E234bB83D1",

      // Private Tokens
      "p.WETH": "0x4727FE8D8450CEBcB142331FAc034Cd8d311f0E5",
      "p.WBTC": "0x65449561257ba5756631Aa0d34f07f6457a319be",
      "p.USDT": "0x42107250C3D385ddfABE69ab6de163702040FeB0",
      "p.USDC_E": "0x63C9a1D05471fc8d47C83968725Dcfdcb5410392",
      "p.WADA": "0x3a8b49aAC1dAD86aa45a75231FbeC5bEb810e416",
      "p.gCOTI": "0x394b3c4328160f000763Ca391D07F902926EDaAc",

      // Bridges
      PrivacyBridgeWETH: "0x7286c83300f0C7131b4006f3cf9F8e44BeB45c13",
      PrivacyBridgeWBTC: "0xc3B7EdEe4f1c0A0bA1AcD341e4982371eC869862",
      PrivacyBridgeUSDT: "0x7685B473DAF1c6DeD815Ca64C6fa18Da2227440D",
      PrivacyBridgeUSDCe: "0x29334fC23ffa2c44AF1b372336C2296591Eadd86",
      PrivacyBridgeWADA: "0xFa2126C07F517013c8d237cc465342da89B96f92",
      PrivacyBridgegCOTI: "0xD4e0d9AB16b48c68044cB6aeA3A089380d6D8cD4"
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
