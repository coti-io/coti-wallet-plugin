import { ethers } from 'ethers';
import { BRIDGE_ABI, BRIDGE_ERC20_ABI, COTI_PRICE_CONSUMER_ABI, CONTRACT_ADDRESSES } from '../contracts/config';
import { getRpcUrlForChainId } from '../config/chains';
import { logger } from '../lib/logger';

/**
 * Maps bridge token symbols to the `_base` argument of the COTI price consumer's
 * `getPrice(string)` view function. Mirrors what the on-chain bridge passes when
 * resolving prices.
 */
const SYMBOL_TO_ORACLE_BASE: Record<string, string> = {
  COTI: 'COTI',
  WETH: 'ETH',
  WBTC: 'WBTC',
  USDT: 'USDT',
  USDC: 'USDC',
  'USDC.e': 'USDC',
  WADA: 'ADA',
  // Consumer base is uppercase GCOTI (lowercase gCOTI reverts).
  gCOTI: 'GCOTI',
  NIGHT: 'NIGHT',
};

/**
 * Resolves the COTI price-consumer address for the given chain id.
 * Falls back to the testnet oracle when the chain id is unknown.
 */
function getPriceConsumerAddress(chainId: number = 7082400): string {
  const addresses = (CONTRACT_ADDRESSES as Record<number, Record<string, string>>)[chainId];
  return addresses?.CotiPriceConsumer || (CONTRACT_ADDRESSES as any)[7082400].CotiPriceConsumer;
}

/**
 * Fetches the current USD price for a token symbol via the on-chain
 * COTI price consumer (replaces the previous Band Protocol RPC call).
 *
 * The consumer returns a fixed-point uint256 with 18 decimals.
 *
 * @param symbol   - Token symbol (e.g. "WETH", "WBTC", "USDT", "COTI")
 * @param provider - Optional ethers provider; defaults to COTI testnet RPC
 * @param chainId  - Optional chain id; controls which oracle address is used
 * @returns USD price as a number, or null if unavailable
 */
export async function fetchTokenUsdPrice(
  symbol: string,
  provider?: ethers.JsonRpcProvider | ethers.BrowserProvider,
  chainId: number = 7082400,
): Promise<number | null> {
  const base = SYMBOL_TO_ORACLE_BASE[symbol];
  if (!base) {
    logger.warn(`No on-chain price mapping for symbol: ${symbol}`);
    return null;
  }

  try {
    const rpcProvider = provider || new ethers.JsonRpcProvider(getRpcUrlForChainId(chainId));
    const oracleAddress = getPriceConsumerAddress(chainId);
    const contract = new ethers.Contract(oracleAddress, COTI_PRICE_CONSUMER_ABI, rpcProvider);
    const raw: bigint = await contract.getPrice(base);
    // Price is returned as 18-decimal fixed point (same scale as parseEther)
    return Number(ethers.formatEther(raw));
  } catch (err: any) {
    // The consumer can revert with StaleOracleData(uint256, uint256) when the
    // underlying IStdReference data is older than `maxStaleness`.
    const decoded = err?.revert?.name === 'StaleOracleData'
      ? `oracle data stale (lastUpdated=${err.revert.args?.[0]}, threshold=${err.revert.args?.[1]})`
      : err?.shortMessage || err?.message || 'unknown error';
    logger.error(`Error fetching on-chain USD price for ${symbol}: ${decoded}`);
    return null;
  }
}

export interface BridgeFees {
  depositFixedFee: string;
  depositPercentageBps: string;
  depositMaxFee: string;
  withdrawFixedFee: string;
  withdrawPercentageBps: string;
  withdrawMaxFee: string;
}

const ERROR_FEES: BridgeFees = {
  depositFixedFee: 'Error',
  depositPercentageBps: 'Error',
  depositMaxFee: 'Error',
  withdrawFixedFee: 'Error',
  withdrawPercentageBps: 'Error',
  withdrawMaxFee: 'Error',
};

/**
 * Fetches the dynamic fee parameters (fixedFee, percentageBps, maxFee) for
 * both deposit and withdraw from a bridge contract.
 *
 * @param bridgeAddress - On-chain address of the bridge contract
 * @param isNativeBridge - true for the native COTI bridge, false for ERC-20 bridges
 * @param provider - An ethers JsonRpcProvider (or compatible)
 * @returns Formatted BridgeFees with COTI values in ether and bps as raw string
 */
export async function fetchBridgeFees(
  bridgeAddress: string,
  isNativeBridge: boolean,
  provider: ethers.JsonRpcProvider
): Promise<BridgeFees> {
  try {
    const abi = isNativeBridge ? BRIDGE_ABI : BRIDGE_ERC20_ABI;
    const contract = new ethers.Contract(bridgeAddress, abi, provider);

    const [
      depositFixedFee,
      depositPercentageBps,
      depositMaxFee,
      withdrawFixedFee,
      withdrawPercentageBps,
      withdrawMaxFee,
    ] = await Promise.all([
      contract.depositFixedFee().catch(() => '0'),
      contract.depositPercentageBps().catch(() => '0'),
      contract.depositMaxFee().catch(() => '0'),
      contract.withdrawFixedFee().catch(() => '0'),
      contract.withdrawPercentageBps().catch(() => '0'),
      contract.withdrawMaxFee().catch(() => '0'),
    ]);

    return {
      depositFixedFee: ethers.formatEther(depositFixedFee),
      depositPercentageBps: depositPercentageBps.toString(),
      depositMaxFee: ethers.formatEther(depositMaxFee),
      withdrawFixedFee: ethers.formatEther(withdrawFixedFee),
      withdrawPercentageBps: withdrawPercentageBps.toString(),
      withdrawMaxFee: ethers.formatEther(withdrawMaxFee),
    };
  } catch (err) {
    logger.error(`Error fetching fees for bridge ${bridgeAddress}:`, err);
    return ERROR_FEES;
  }
}

// ─── Fee Computation (mirrors Solidity logic) ────────────────────────────────

const FEE_DIVISOR = 1_000_000n;

/**
 * Dynamic fee: take the greater of percentageFee and fixedFee, then cap at maxFee.
 * All values in wei (bigint).
 */
function calculateDynamicFee(percentageFee: bigint, fixedFee: bigint, maxFee: bigint): bigint {
  const fee = percentageFee > fixedFee ? percentageFee : fixedFee;
  return maxFee > 0n && fee > maxFee ? maxFee : fee;
}

/**
 * Compute the bridge fee for a native COTI deposit/withdraw.
 * Mirrors the Solidity `_computeCotiFee` function.
 *
 * @param cotiAmount   - Amount in COTI (human-readable, e.g. "10.5")
 * @param fixedFee     - Floor fee in COTI (human-readable)
 * @param percentageBps - Basis points relative to FEE_DIVISOR (raw number string)
 * @param maxFee       - Cap fee in COTI (human-readable)
 * @param cotiUsdPrice - Current COTI price in USD (from Band Protocol)
 * @returns Fee in COTI as a human-readable string
 */
export function computeCotiFee(
  cotiAmount: string,
  fixedFee: string,
  percentageBps: string,
  maxFee: string,
  cotiUsdPrice: number
): string {
  const amountWei = ethers.parseEther(cotiAmount);
  const fixedFeeWei = ethers.parseEther(fixedFee);
  const maxFeeWei = ethers.parseEther(maxFee);
  const bps = BigInt(percentageBps);

  // cotiUsdRate as 18-decimal fixed point (same scale as Solidity oracle)
  const cotiUsdRate = ethers.parseEther(cotiUsdPrice.toString());

  // txValueUsd = (cotiAmount * cotiUsdRate) / 1e18
  const txValueUsd = (amountWei * cotiUsdRate) / ethers.WeiPerEther;

  // percentageFeeUsd = (txValueUsd * percentageBps) / FEE_DIVISOR
  const percentageFeeUsd = (txValueUsd * bps) / FEE_DIVISOR;

  // percentageFeeCoti = (percentageFeeUsd * 1e18) / cotiUsdRate
  const percentageFeeCoti = cotiUsdRate > 0n
    ? (percentageFeeUsd * ethers.WeiPerEther) / cotiUsdRate
    : 0n;

  const fee = calculateDynamicFee(percentageFeeCoti, fixedFeeWei, maxFeeWei);
  return ethers.formatEther(fee);
}

/**
 * Compute the bridge fee for an ERC-20 token deposit/withdraw.
 * Mirrors the Solidity `_computeErc20Fee` function.
 * The fee is denominated in COTI.
 *
 * @param tokenAmount   - Amount in token units (human-readable, e.g. "1.5")
 * @param tokenDecimals - Decimals of the ERC-20 token (e.g. 18, 8, 6)
 * @param fixedFee      - Floor fee in COTI (human-readable)
 * @param percentageBps - Basis points relative to FEE_DIVISOR (raw number string)
 * @param maxFee        - Cap fee in COTI (human-readable)
 * @param tokenUsdPrice - Current token price in USD (from Band Protocol)
 * @param cotiUsdPrice  - Current COTI price in USD (from Band Protocol)
 * @returns Fee in COTI as a human-readable string
 */
export function computeErc20Fee(
  tokenAmount: string,
  tokenDecimals: number,
  fixedFee: string,
  percentageBps: string,
  maxFee: string,
  tokenUsdPrice: number,
  cotiUsdPrice: number
): string {
  const amountWei = ethers.parseUnits(tokenAmount, tokenDecimals);
  const fixedFeeWei = ethers.parseEther(fixedFee);
  const maxFeeWei = ethers.parseEther(maxFee);
  const bps = BigInt(percentageBps);

  // tokenUsdRate as 18-decimal fixed point
  const tokenUsdRate = ethers.parseEther(tokenUsdPrice.toString());
  const cotiUsdRate = ethers.parseEther(cotiUsdPrice.toString());

  // txValueUsd = (tokenAmount * tokenUsdRate) / 10^tokenDecimals
  const tokenUnit = 10n ** BigInt(tokenDecimals);
  const txValueUsd = (amountWei * tokenUsdRate) / tokenUnit;

  // percentageFeeUsd = (txValueUsd * percentageBps) / FEE_DIVISOR
  const percentageFeeUsd = (txValueUsd * bps) / FEE_DIVISOR;

  // percentageFeeCoti = (percentageFeeUsd * 1e18) / cotiUsdRate
  const percentageFeeCoti = cotiUsdRate > 0n
    ? (percentageFeeUsd * ethers.WeiPerEther) / cotiUsdRate
    : 0n;

  const fee = calculateDynamicFee(percentageFeeCoti, fixedFeeWei, maxFeeWei);
  return ethers.formatEther(fee);
}

// ─── Unified Fee Simulation (on-chain call to bridge.computeCotiFee / computeErc20Fee) ─────────────

/** ABI fragments for the on-chain fee simulation view functions */
const SIMULATE_FEE_NATIVE_ABI = [
  'function computeCotiFee(uint256 amount, uint256 fixedFee, uint256 percentageBps, uint256 maxFee) view returns (uint256 fee)',
] as const;

const SIMULATE_FEE_ERC20_ABI = [
  'function computeErc20Fee(uint256 amount, uint256 fixedFee, uint256 percentageBps, uint256 maxFee, string tokenSymbol, uint8 tokenDecimals) view returns (uint256 fee)',
] as const;

/** Maps bridge token symbols to their Band oracle symbol */
const TOKEN_TO_ORACLE_SYMBOL: Record<string, string> = {
  COTI: 'COTI',
  WETH: 'ETH',
  WBTC: 'WBTC',
  USDT: 'USDT',
  'USDC.e': 'USDC',
  WADA: 'ADA',
  gCOTI: 'GCOTI',
  NIGHT: 'NIGHT',
};

/** Maps bridge token symbols to their decimals */
const TOKEN_DECIMALS: Record<string, number> = {
  COTI: 18,
  WETH: 18,
  WBTC: 8,
  USDT: 6,
  'USDC.e': 6,
  WADA: 6,
  gCOTI: 18,
  NIGHT: 6,
};

export interface SimulationResult {
  fee: string;
  explanation: string;
}

/**
 * Call the on-chain fee simulation view function on a bridge contract.
 * - Native COTI bridge: calls computeCotiFee(amount, fixedFee, percentageBps, maxFee)
 * - ERC-20 bridges: calls computeErc20Fee(amount, fixedFee, percentageBps, maxFee, tokenSymbol, tokenDecimals)
 *
 * @param bridgeAddress  - Address of the bridge contract
 * @param amount         - Token amount (human-readable, e.g. "1.5")
 * @param fixedFee       - Floor fee in COTI (human-readable, e.g. "10")
 * @param percentageBps  - Basis points relative to FEE_DIVISOR (raw number string, e.g. "500")
 * @param maxFee         - Cap fee in COTI (human-readable, e.g. "3000")
 * @param oracleSymbol   - Oracle symbol: "COTI" for native, "ETH"/"WBTC"/"USDT"/"USDC"/"ADA" for ERC-20
 * @param tokenDecimals  - Token decimals (18, 8, or 6)
 * @param provider       - An ethers provider
 * @returns SimulationResult with fee in COTI and explanation
 */
export async function simulateFeeOnChain(
  bridgeAddress: string,
  amount: string,
  fixedFee: string,
  percentageBps: string,
  maxFee: string,
  oracleSymbol: string,
  tokenDecimals: number,
  provider: ethers.JsonRpcProvider | ethers.BrowserProvider
): Promise<SimulationResult> {
  try {
    const amountWei = ethers.parseUnits(amount, tokenDecimals);
    const fixedFeeWei = ethers.parseEther(fixedFee || '0');
    const bpsNum = parseInt(percentageBps || '0');
    const maxFeeWei = ethers.parseEther(maxFee || '0');

    const isNative = oracleSymbol === 'COTI';
    let fee: bigint;

    if (isNative) {
      const contract = new ethers.Contract(bridgeAddress, SIMULATE_FEE_NATIVE_ABI, provider);
      fee = await contract.computeCotiFee(amountWei, fixedFeeWei, bpsNum, maxFeeWei);
    } else {
      const contract = new ethers.Contract(bridgeAddress, SIMULATE_FEE_ERC20_ABI, provider);
      fee = await contract.computeErc20Fee(amountWei, fixedFeeWei, bpsNum, maxFeeWei, oracleSymbol, tokenDecimals);
    }

    const feeFormatted = parseFloat(ethers.formatEther(fee)).toFixed(4);

    // Determine which rule was applied
    let explanation: string;
    if (fee === maxFeeWei && maxFeeWei > 0n) {
      explanation = 'Max fee cap applied';
    } else if (fee === fixedFeeWei) {
      explanation = 'Fixed fee floor applied';
    } else {
      explanation = 'Percentage fee applied';
    }

    return { fee: feeFormatted, explanation };
  } catch (err) {
    logger.error('simulateFeeOnChain error:', err);
    return { fee: '—', explanation: 'Contract call failed' };
  }
}

/**
 * Helper to get oracle symbol and decimals for a bridge token symbol.
 */
export function getTokenSimulationMeta(tokenSymbol: string): { oracleSymbol: string; decimals: number } {
  return {
    oracleSymbol: TOKEN_TO_ORACLE_SYMBOL[tokenSymbol] || tokenSymbol,
    decimals: TOKEN_DECIMALS[tokenSymbol] || 18,
  };
}
