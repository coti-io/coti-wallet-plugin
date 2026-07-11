import { ethers } from "ethers";
import { POD_PORTAL_ADMIN_ABI } from "../../contracts/pod";
import { getChainConfig } from "../index";
import { getRpcUrlsForChain } from "../rpcUrls";
import { fetchPodOracleTokenUsdPrice } from "../podPriceOracle";
import { logger } from "../../lib/logger";
import type { ChainConfig, TokenConfig } from "../types";
import type { BridgeData } from "../../hooks/useBridgeData";
import type { SimulationResult } from "../../hooks/useBridgeFees";

const ERC20_BALANCE_ABI = ["function balanceOf(address) view returns (uint256)"];

/** Same percentage scale as the COTI bridges (500 bps = 0.05%). */
const FEE_DIVISOR = 1_000_000n;

/** Deployed portals use uint128.max as the "no max fee cap" sentinel. */
export const POD_NO_MAX_FEE_SENTINEL = (1n << 128n) - 1n;

/** Formats a fee config value, mapping the no-cap sentinel to "0" (COTI convention). */
const formatFee = (value: bigint): string =>
  value >= POD_NO_MAX_FEE_SENTINEL ? "0" : ethers.formatEther(value);

async function fetchPortalRow(
  token: TokenConfig,
  config: ChainConfig,
  provider: ethers.JsonRpcProvider,
  nativeSymbol: string,
): Promise<BridgeData> {
  const portalAddress = config.addresses[token.bridgeAddressKey!];
  const privateToken = config.tokens.find(
    t => t.isPrivate && t.bridgeAddressKey === token.bridgeAddressKey
  );
  const base = {
    bridgeName: `${token.symbol} PoD Portal`,
    bridgeAddress: portalAddress,
    publicToken: token.symbol,
    publicTokenIcon: token.icon,
    privateToken: privateToken?.symbol || "N/A",
    privateTokenIcon: privateToken?.icon || "",
    tokenDecimals: token.decimals,
    feeTokenSymbol: nativeSymbol,
    // PoD portals have no deposit/withdraw limits
    minDepositAmount: "N/A",
    maxDepositAmount: "N/A",
    minWithdrawAmount: "N/A",
    maxWithdrawAmount: "N/A",
    accumulatedFees: "0",
    nativeCotiFee: "0",
    // No readable pause flag on the portal (pausing goes through a controller)
    isPaused: false,
    isLoading: false,
  };

  try {
    const portal = new ethers.Contract(portalAddress, POD_PORTAL_ADMIN_ABI, provider);
    const [depCfg, wdCfg, accFees, balance] = await Promise.all([
      portal.getFeeConfig(true),
      portal.getFeeConfig(false),
      portal.accumulatedPortalFees().catch(() => 0n),
      token.isNative
        ? provider.getBalance(portalAddress)
        : token.addressKey && config.addresses[token.addressKey]
          ? new ethers.Contract(config.addresses[token.addressKey], ERC20_BALANCE_ABI, provider)
              .balanceOf(portalAddress).catch(() => 0n)
          : Promise.resolve(0n),
    ]);
    return {
      ...base,
      depositFixedFee: formatFee(depCfg[0]),
      depositPercentageBps: depCfg[1].toString(),
      depositMaxFee: formatFee(depCfg[2]),
      withdrawFixedFee: formatFee(wdCfg[0]),
      withdrawPercentageBps: wdCfg[1].toString(),
      withdrawMaxFee: formatFee(wdCfg[2]),
      accumulatedCotiFees: ethers.formatEther(accFees),
      bridgeBalance: ethers.formatUnits(balance, token.decimals),
      error: null,
    };
  } catch (err) {
    logger.error(`Error fetching PoD portal data for ${token.symbol}:`, err);
    return {
      ...base,
      depositFixedFee: "Error",
      depositPercentageBps: "Error",
      depositMaxFee: "Error",
      withdrawFixedFee: "Error",
      withdrawPercentageBps: "Error",
      withdrawMaxFee: "Error",
      accumulatedCotiFees: "0",
      bridgeBalance: "0",
      error: "Failed to fetch portal data",
    };
  }
}

/**
 * Live backoffice reader for PoD privacy portals (Sepolia/Fuji).
 * Reads the deposit/withdraw fee configs, accumulated portal fees and portal
 * balance for every public token with a configured portal, shaped as
 * {@link BridgeData} rows. Fee values are native-coin denominated; the row's
 * `feeTokenSymbol` carries the display symbol (ETH/AVAX).
 */
export async function fetchPodBridgeData(chainId: number): Promise<BridgeData[]> {
  const config = getChainConfig(chainId);
  if (!config || config.portalStrategy !== "pod-privacy-portal") return [];
  const nativeSymbol = config.walletNetwork.nativeCurrency.symbol;
  const publicTokens = config.tokens.filter(
    t => !t.isPrivate && t.bridgeAddressKey && config.addresses[t.bridgeAddressKey]
  );

  let lastError: unknown;
  for (const rpcUrl of getRpcUrlsForChain(chainId)) {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    try {
      await provider.getBlockNumber(); // probe before fanning out
      return await Promise.all(
        publicTokens.map(token => fetchPortalRow(token, config, provider, nativeSymbol))
      );
    } catch (err) {
      lastError = err;
    }
  }
  logger.error(`Error fetching PoD bridge data for chain ${chainId}:`, lastError);
  return [];
}

/**
 * Local mirror of the assumed PoD portal fee math for the backoffice
 * simulate panel: max(fixedFee, valueInNative * bps / 1e6), capped at maxFee
 * (0 = no cap). ERC-20 amounts are converted to native units via the chain's
 * PoDPriceOracle live prices.
 *
 * @param chainId       - PoD chain id (Sepolia 11155111 / Fuji 43113)
 * @param tokenSymbol   - Public token symbol from the chain config (e.g. "ETH", "USDC")
 * @param amount        - Token amount (human-readable)
 * @param fixedFee      - Floor fee in native coin (human-readable)
 * @param percentageBps - Basis points relative to FEE_DIVISOR (raw number string)
 * @param maxFee        - Cap fee in native coin (human-readable, "0" = no cap)
 */
export async function simulatePodPortalFee(
  chainId: number,
  tokenSymbol: string,
  amount: string,
  fixedFee: string,
  percentageBps: string,
  maxFee: string,
): Promise<SimulationResult> {
  try {
    const config = getChainConfig(chainId);
    if (!config) return { fee: "—", explanation: "Unsupported chain" };
    const token = config.tokens.find(t => t.symbol === tokenSymbol && !t.isPrivate);
    if (!token) return { fee: "—", explanation: "Unknown token" };

    // Fees are charged in the native coin; convert ERC-20 amounts via oracle prices.
    const amountWei = ethers.parseUnits(amount, token.decimals);
    let valueInNative: bigint;
    if (token.isNative) {
      valueInNative = amountWei;
    } else {
      const nativeSymbol = config.walletNetwork.nativeCurrency.symbol;
      const [tokenUsd, nativeUsd] = await Promise.all([
        fetchPodOracleTokenUsdPrice(tokenSymbol, chainId),
        fetchPodOracleTokenUsdPrice(nativeSymbol, chainId),
      ]);
      if (!tokenUsd || !nativeUsd) {
        return { fee: "—", explanation: "Oracle price unavailable" };
      }
      const tokenUsdWei = ethers.parseEther(tokenUsd.toString());
      const nativeUsdWei = ethers.parseEther(nativeUsd.toString());
      const amount18 = amountWei * 10n ** BigInt(18 - token.decimals);
      valueInNative = (amount18 * tokenUsdWei) / nativeUsdWei;
    }

    const fixedFeeWei = ethers.parseEther(fixedFee || "0");
    const maxFeeWei = ethers.parseEther(maxFee || "0");
    const bps = BigInt(parseInt(percentageBps || "0", 10));

    const percentageFee = (valueInNative * bps) / FEE_DIVISOR;
    let fee = percentageFee > fixedFeeWei ? percentageFee : fixedFeeWei;
    if (maxFeeWei > 0n && fee > maxFeeWei) fee = maxFeeWei;

    const explanation =
      maxFeeWei > 0n && fee === maxFeeWei && fee !== fixedFeeWei
        ? "Max fee cap applied"
        : fee === fixedFeeWei
          ? "Fixed fee floor applied"
          : "Percentage fee applied";
    return { fee: parseFloat(ethers.formatEther(fee)).toFixed(6), explanation };
  } catch (err) {
    logger.error("simulatePodPortalFee error:", err);
    return { fee: "—", explanation: "Simulation failed" };
  }
}
