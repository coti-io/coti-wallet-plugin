import { ethers } from "ethers";
import { getChainConfig } from "./index";
import { getRpcUrlsForChain } from "./rpcUrls";
import { logger } from "../lib/logger";

/**
 * PoDPriceOracle deployed alongside the PoD privacy portals (Band adapter on
 * Sepolia, Chainlink adapter on Fuji). Prices are 18-decimal USD per whole
 * token; adapters return 0 (never revert) when a feed is unset or stale.
 */
export const POD_PRICE_ORACLE_ABI = [
  "function getLivePrice(address token) view returns (uint256 priceUsd)",
  "function getLivePrices(address tokenA, address tokenB) view returns (uint256 priceA, uint256 priceB)",
];

/**
 * Resolves the underlying ERC-20 the oracle prices for a token symbol.
 * Native symbols (ETH, AVAX) resolve through their wrapped collateral
 * (WETH, WAVAX) via the token's `addressKey`; private symbols (p.X)
 * resolve through their public counterpart.
 */
function resolveOracleTokenAddress(symbol: string, chainId: number): string | null {
  const config = getChainConfig(chainId);
  if (!config) return null;
  const publicSymbol = symbol.startsWith("p.") ? symbol.slice(2) : symbol;
  const token = config.tokens.find(t => t.symbol === publicSymbol && !t.isPrivate);
  if (!token?.addressKey) return null;
  return config.addresses[token.addressKey] ?? null;
}

/**
 * Fetches the live USD price for a token symbol from the chain's PoDPriceOracle.
 *
 * @param symbol   - Token symbol from the chain config (e.g. "ETH", "USDC", "AVAX", "p.USDC")
 * @param chainId  - Host chain id (Sepolia 11155111 or Fuji 43113)
 * @param provider - Optional ethers provider; defaults to the chain's configured RPCs
 * @returns USD price as a number, or null when the chain has no oracle,
 *          the symbol is unknown, or the feed is unset/stale (oracle returns 0)
 */
export async function fetchPodOracleTokenUsdPrice(
  symbol: string,
  chainId: number,
  provider?: ethers.JsonRpcProvider | ethers.BrowserProvider,
): Promise<number | null> {
  const oracleAddress = getChainConfig(chainId)?.priceOracleAddress;
  if (!oracleAddress) {
    logger.warn(`No PoD price oracle configured for chain ${chainId}`);
    return null;
  }
  const tokenAddress = resolveOracleTokenAddress(symbol, chainId);
  if (!tokenAddress) {
    logger.warn(`No oracle token mapping for symbol ${symbol} on chain ${chainId}`);
    return null;
  }

  const rpcUrls = provider ? [] : getRpcUrlsForChain(chainId);
  const providers = provider ? [provider] : rpcUrls.map(url => new ethers.JsonRpcProvider(url));

  let lastError: unknown;
  for (const rpcProvider of providers) {
    try {
      const oracle = new ethers.Contract(oracleAddress, POD_PRICE_ORACLE_ABI, rpcProvider);
      const raw: bigint = await oracle.getLivePrice(tokenAddress);
      if (raw === 0n) {
        logger.warn(`PoD price oracle has no live feed for ${symbol} on chain ${chainId}`);
        return null;
      }
      return Number(ethers.formatEther(raw));
    } catch (err) {
      lastError = err;
    }
  }
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  logger.error(`Error fetching PoD oracle USD price for ${symbol} on chain ${chainId}: ${message}`);
  return null;
}
