import { CHAIN_CONFIGS } from '../chains';
import type { TokenConfig } from '../chains/types';

export type { TokenConfig };

export const CONTRACT_ADDRESSES: Record<number, Record<string, string>> =
  Object.fromEntries(Object.values(CHAIN_CONFIGS).map(chain => [chain.id, chain.addresses]));

export const SUPPORTED_TOKENS: TokenConfig[] = Array.from(
  new Map(
    Object.values(CHAIN_CONFIGS)
      .flatMap(chain => chain.tokens)
      .map(token => [`${token.isPrivate ? 'private' : 'public'}:${token.symbol}`, token])
  ).values()
);

export {
  getPublicTokensForChain,
  getPrivateTokensForChain,
} from '../chains';

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
