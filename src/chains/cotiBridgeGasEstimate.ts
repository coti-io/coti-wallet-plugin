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
}): Promise<string> {
  const { provider, currentChainId, bridgeAddress, symbol, direction, amountWei, gasPrice, isErc20Token } = params;

  let nativeCotiFee = 0n;
  if (isErc20Token) {
    try {
      const rpcUrl = getRpcUrlForChain(Number((await provider.getNetwork()).chainId));
      const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
      const isDeposit = direction === "to-private";
      const feeEstimate = await estimateBridgeFee(symbol, "1", rpcProvider);
      const feeStr = isDeposit ? feeEstimate.depositFee : feeEstimate.withdrawFee;
      if (feeStr !== "Error") {
        const feeWei = ethers.parseEther(feeStr);
        nativeCotiFee = (feeWei * 101n) / 100n;
      }
    } catch (e) {
      console.warn("⚠️ Could not compute dynamic fee for gas estimation");
    }
  }

  let calldata: string;
  let msgValue = nativeCotiFee;

  if (direction === "to-private" && isErc20Token) {
    const estimatedFeeWei = 790000n * gasPrice;
    console.log("⛽️ ERC20 deposit: using observed gas constant 790000");
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
    const walletAddr = await provider.getSigner().then(s => s.getAddress());
    const gasEstimateHex = await (window.ethereum as any).request({
      method: "eth_estimateGas",
      params: [
        {
          from: walletAddr,
          to: bridgeAddress,
          data: calldata,
          value: "0x" + msgValue.toString(16),
        },
      ],
    });
    gasLimit = BigInt(gasEstimateHex);
    console.log(`⛽️ eth_estimateGas succeeded: ${gasLimit.toString()} gas units`);
  } catch (estimateErr: any) {
    const isNativeCotiDeposit = !isErc20Token && direction === "to-private";
    gasLimit = isNativeCotiDeposit ? 660000n : 500000n;
    console.warn(`⚠️ eth_estimateGas failed, using realistic fallback (${gasLimit}):`, estimateErr?.message);
  }

  const estimatedFeeWei = gasLimit * gasPrice;
  console.log("⛽️ Gas Fee Estimation:", {
    gasPrice: gasPrice.toString(),
    gasLimit: gasLimit.toString(),
    feeCoti: ethers.formatEther(estimatedFeeWei),
  });

  return ethers.formatEther(estimatedFeeWei).replace(/\.?0+$/, "") || "0";
}
