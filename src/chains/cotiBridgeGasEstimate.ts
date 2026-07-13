import { ethers } from "ethers";
import { getRpcUrlForChain } from "./index";
import type { FeeEstimate } from "../hooks/useEstimateBridgeFees";
import { logger } from "../lib/logger";

/**
 * Gas fee string for display on COTI bridge chains (not PoD portal).
 *
 * Builds the real bridge calldata (amount + live oracle timestamps + portal fee
 * as msg.value) and estimates against it, the same way usePrivacyBridgeExecutor
 * does at submit time. Returns null when no estimate can be produced — e.g. no
 * oracle price data yet, or (for ERC20 deposits specifically) the user hasn't
 * approved the token yet, since transferFrom() only succeeds once a real
 * allowance exists. That resolves itself the moment the user approves.
 */
export async function estimateCotiBridgeGasFeeDisplay(params: {
  provider: ethers.BrowserProvider;
  currentChainId: number;
  bridgeAddress: string;
  direction: "to-private" | "to-public";
  amountWei: bigint;
  gasPrice: bigint;
  isErc20Token: boolean;
  /** When set, avoids provider.getSigner() (which may hit a hijacked window.ethereum). */
  fromAddress?: string;
  /** Portal fee + oracle timestamps, already fetched by the caller for this amount. */
  feeEstimate: FeeEstimate;
}): Promise<string | null> {
  const { provider, currentChainId, bridgeAddress, direction, amountWei, gasPrice, isErc20Token, fromAddress, feeEstimate } = params;

  const cotiTs = BigInt(feeEstimate.cotiLastUpdated || "0");
  const tokenTs = isErc20Token ? BigInt(feeEstimate.tokenLastUpdated || "0") : cotiTs;
  // The bridge enforces strict equality between these timestamps and its
  // on-chain oracle rows (OracleTimestampMismatch), so without them no
  // estimate against real calldata is possible.
  if (cotiTs === 0n || tokenTs === 0n) {
    logger.warn("No oracle timestamps for display estimate", { direction, isErc20Token });
    return null;
  }

  const feeStr = direction === "to-private" ? feeEstimate.depositFee : feeEstimate.withdrawFee;
  const feeWei = feeStr !== "Error" ? ethers.parseEther(feeStr) : 0n;

  let calldata: string;
  let msgValue: bigint;
  if (direction === "to-private" && isErc20Token) {
    const iface = new ethers.Interface(["function deposit(uint256 amount, uint256 cotiOracleTimestamp, uint256 tokenOracleTimestamp) payable"]);
    calldata = iface.encodeFunctionData("deposit", [amountWei, cotiTs, tokenTs]);
    msgValue = feeWei;
  } else if (direction === "to-private") {
    const iface = new ethers.Interface(["function deposit(uint256 cotiOracleTimestamp, uint256 tokenOracleTimestamp) payable"]);
    calldata = iface.encodeFunctionData("deposit", [cotiTs, tokenTs]);
    msgValue = amountWei;
  } else {
    const iface = new ethers.Interface(["function withdraw(uint256 amount, uint256 cotiOracleTimestamp, uint256 tokenOracleTimestamp) payable"]);
    calldata = iface.encodeFunctionData("withdraw", [amountWei, cotiTs, tokenTs]);
    msgValue = isErc20Token ? feeWei : 0n;
  }

  try {
    const walletAddr = fromAddress ?? await provider.getSigner().then(s => s.getAddress());
    // Use a direct COTI JsonRpcProvider for the display estimate rather than
    // window.ethereum. Routing through MetaMask makes it log every rejected RPC
    // (-32603) to the console even though we catch the error and fall back here.
    const rpcProvider = new ethers.JsonRpcProvider(getRpcUrlForChain(currentChainId));
    const gasLimit = await rpcProvider.estimateGas({
      from: walletAddr,
      to: bridgeAddress,
      data: calldata,
      value: msgValue,
    });
    logger.log("Display gas estimate succeeded", { gasLimit: gasLimit.toString() });
    return ethers.formatEther(gasLimit * gasPrice).replace(/\.?0+$/, "") || "0";
  } catch (err: any) {
    // Expected pre-approval for ERC20 deposits (transferFrom needs a real
    // allowance); the next refresh after the user approves will succeed.
    logger.warn("Display gas estimate failed, no estimate available", { message: err?.message });
    return null;
  }
}
