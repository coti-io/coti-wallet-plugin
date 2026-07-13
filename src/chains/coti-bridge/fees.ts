import { ethers } from "ethers";
import { CONTRACT_ADDRESSES } from "../../contracts/config";
import { estimateCotiBridgeGasFeeDisplay } from "../cotiBridgeGasEstimate";
import { estimateBridgeFee } from "../../hooks/useEstimateBridgeFees";
import { getPublicTokensForChain, getRpcUrlForChain } from "../index";
import { resolveConfiguredAddress } from "../portal/helpers";
import { logger } from "../../lib/logger";

export type CotiBridgeFeeQuote = {
  portalFeeCoti: string | null;
  estimatedGasFee: string | null;
  feeDebugInfo: {
    cotiLastUpdated: string;
    tokenLastUpdated: string;
    blockTimestamp: string;
  } | null;
};

const resolveBridgeAddress = (
  chainId: number,
  symbol: string,
  pubTok: ReturnType<typeof getPublicTokensForChain>[number] | undefined,
): string | undefined => {
  const addresses = CONTRACT_ADDRESSES[chainId];
  if (!addresses) return undefined;

  const bridgeAddress = resolveConfiguredAddress(addresses, pubTok?.bridgeAddressKey);
  if (bridgeAddress) return bridgeAddress;

  if (symbol === "WETH") return addresses.PrivacyBridgeWETH;
  if (symbol === "WBTC") return addresses.PrivacyBridgeWBTC;
  if (symbol === "USDT") return addresses.PrivacyBridgeUSDT;
  if (symbol === "USDC.e") return addresses.PrivacyBridgeUSDCe;
  if (symbol === "WADA") return addresses.PrivacyBridgeWADA;
  if (symbol === "gCOTI") return addresses.PrivacyBridgegCOTI;
  return addresses.PrivacyBridgeCotiNative;
};

/** COTI bridge portal + gas fee quotes (isolated from PoD). */
export const quoteCotiBridgeFees = async (params: {
  chainId: number;
  symbol: string;
  direction: "to-private" | "to-public";
  amount: string;
  walletAddress?: string;
}): Promise<CotiBridgeFeeQuote> => {
  const { chainId, symbol, direction, amount, walletAddress } = params;
  const currentAmount = amount && parseFloat(amount) > 0 ? amount : "0";
  if (currentAmount === "0") {
    return { portalFeeCoti: null, estimatedGasFee: null, feeDebugInfo: null };
  }

  const rpcUrl = getRpcUrlForChain(chainId);
  const rpcProvider = new ethers.JsonRpcProvider(rpcUrl, chainId);
  const pubTok = getPublicTokensForChain(chainId).find(
    t => t.symbol === symbol && !t.isPrivate,
  );
  const bridgeAddress = resolveBridgeAddress(chainId, symbol, pubTok);
  if (!bridgeAddress) {
    return { portalFeeCoti: null, estimatedGasFee: null, feeDebugInfo: null };
  }

  const isWeth = symbol === "WETH";
  const isWbtc = symbol === "WBTC";
  const isUsdt = symbol === "USDT";
  const isUsdcE = symbol === "USDC.e";
  const isWada = symbol === "WADA";
  const isGCoti = symbol === "gCOTI";
  const isNight = symbol === "NIGHT";
  const isErc20Token = isWeth || isWbtc || isUsdt || isUsdcE || isWada || isGCoti || isNight;

  let publicDecimals = pubTok?.decimals ?? 18;
  let privateDecimals = pubTok?.decimals ?? 18;
  if (!pubTok) {
    if (isWbtc) { publicDecimals = 8; privateDecimals = 8; }
    else if (isUsdt || isUsdcE || isWada) { publicDecimals = 6; privateDecimals = 6; }
  }

  const decimals = direction === "to-private" ? publicDecimals : privateDecimals;
  let amountWei: bigint;
  try {
    amountWei = ethers.parseUnits(currentAmount, decimals);
  } catch {
    // e.g. user is still typing and has entered more decimals than the token supports
    amountWei = ethers.parseUnits("1", decimals);
  }

  let gasPrice = 1_000_000_000n;
  try {
    const gasPriceHex = await rpcProvider.send("eth_gasPrice", []);
    gasPrice = BigInt(gasPriceHex);
  } catch {
    logger.warn("eth_gasPrice failed, using default (1 Gwei).");
  }

  // Fee first: the gas estimate needs its oracle timestamps to build calldata
  // the bridge won't reject on (OracleTimestampMismatch).
  const feeEstimate = await estimateBridgeFee(symbol, currentAmount, rpcProvider);
  const gasDisplay = await estimateCotiBridgeGasFeeDisplay({
    provider: rpcProvider as unknown as ethers.BrowserProvider,
    currentChainId: chainId,
    bridgeAddress,
    direction,
    amountWei,
    gasPrice,
    isErc20Token,
    fromAddress: walletAddress,
    feeEstimate,
  });

  const fee = direction === "to-private" ? feeEstimate.depositFee : feeEstimate.withdrawFee;
  if (fee === "Error") {
    return { portalFeeCoti: null, estimatedGasFee: gasDisplay, feeDebugInfo: null };
  }

  const display = fee.replace(/\.?0+$/, "") || "0";
  return {
    portalFeeCoti: display === "0" ? null : display,
    estimatedGasFee: gasDisplay,
    feeDebugInfo: {
      cotiLastUpdated: feeEstimate.cotiLastUpdated,
      tokenLastUpdated: feeEstimate.tokenLastUpdated,
      blockTimestamp: feeEstimate.blockTimestamp,
    },
  };
};
