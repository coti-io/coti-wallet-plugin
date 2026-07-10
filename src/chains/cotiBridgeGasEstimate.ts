import { ethers } from "ethers";
import { getRpcUrlForChain } from "./index";
import { estimateBridgeFee } from "../hooks/useEstimateBridgeFees";
import { logger } from "../lib/logger";

/**
 * Gas fee string for display on COTI bridge chains (not PoD portal).
 * Mirrors the estimation path in usePrivacyBridge `updateGasFee`.
 */
export async function estimateCotiBridgeGasFeeDisplay(params: {
  provider: ethers.BrowserProvider;
  currentChainId: number;
  bridgeAddress: string;
  symbol: string;
  direction: "to-private" | "to-public";
  amountWei: bigint;
  gasPrice: bigint;
  isErc20Token: boolean;
  /** When set, avoids provider.getSigner() (which may hit a hijacked window.ethereum). */
  fromAddress?: string;
}): Promise<string> {
  const { provider, currentChainId, bridgeAddress, symbol, direction, amountWei, gasPrice, isErc20Token, fromAddress } = params;

  let nativeCotiFee = 0n;
  if (isErc20Token) {
    try {
      const rpcUrl = getRpcUrlForChain(Number((await provider.getNetwork()).chainId));
      const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
      const isDeposit = direction === "to-private";
      const feeEstimate = await estimateBridgeFee(symbol, "1", rpcProvider);
      const feeStr = isDeposit ? feeEstimate.depositFee : feeEstimate.withdrawFee;
      if (feeStr !== "Error") {
        nativeCotiFee = ethers.parseEther(feeStr);
      }
    } catch (e) {
      logger.warn('Could not compute dynamic fee for gas estimation', e);
    }
  }

  let calldata: string;
  let msgValue = nativeCotiFee;

  if (direction === "to-private" && isErc20Token) {
    const estimatedFeeWei = 790000n * gasPrice;
    logger.log('ERC20 deposit: using observed gas constant 790000');
    /* v8 ignore next */
    return ethers.formatEther(estimatedFeeWei).replace(/\.?0+$/, "") || "0";
  } else if (direction === "to-private") {
    const iface = new ethers.Interface(["function deposit(uint256 cotiOracleTimestamp, uint256 tokenOracleTimestamp) payable"]);
    calldata = iface.encodeFunctionData("deposit", [0, 0]);
    msgValue = amountWei;
  } else {
    const iface = new ethers.Interface(["function withdraw(uint256 amount, uint256 cotiOracleTimestamp, uint256 tokenOracleTimestamp) payable"]);
    calldata = iface.encodeFunctionData("withdraw", [amountWei, 0, 0]);
  }

  let gasLimit: bigint;
  try {
    const walletAddr = fromAddress ?? await provider.getSigner().then(s => s.getAddress());
    // Use a direct COTI JsonRpcProvider for the display estimate rather than
    // window.ethereum. Routing through MetaMask makes it log every rejected RPC
    // (-32603) to the console even though we catch the error and fall back here.
    // ethers' JsonRpcProvider surfaces the same error quietly via our try/catch.
    const rpcProvider = new ethers.JsonRpcProvider(getRpcUrlForChain(currentChainId));
    gasLimit = await rpcProvider.estimateGas({
      from: walletAddr,
      to: bridgeAddress,
      data: calldata,
      value: msgValue,
    });
    logger.log('eth_estimateGas succeeded', { gasLimit: gasLimit.toString() });
  } catch (estimateErr: any) {
    const isNativeCotiDeposit = !isErc20Token && direction === "to-private";
    gasLimit = isNativeCotiDeposit ? 660000n : 500000n;
    logger.warn('eth_estimateGas failed, using realistic fallback', {
      gasLimit: gasLimit.toString(),
      message: estimateErr?.message,
    });
  }

  const estimatedFeeWei = gasLimit * gasPrice;
  logger.log('Gas fee estimation', {
    gasPrice: gasPrice.toString(),
    gasLimit: gasLimit.toString(),
    feeCoti: ethers.formatEther(estimatedFeeWei),
  });

  /* v8 ignore next */
  return ethers.formatEther(estimatedFeeWei).replace(/\.?0+$/, "") || "0";
}
