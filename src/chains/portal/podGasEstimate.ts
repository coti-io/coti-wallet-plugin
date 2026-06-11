import { ethers } from "ethers";
import type { TokenConfig } from "../types";
import { getSepoliaGasPrice, quotePortalPodRequest } from "./executePodPortalTransaction";

type EthereumRequest = {
  request: (args: { method: string; params?: unknown[] }) => Promise<string>;
};

export async function estimatePodPortalGasFeeDisplay(params: {
  provider: ethers.BrowserProvider;
  currentChainId: number;
  addresses: Record<string, string>;
  symbol: string;
  direction: "to-private" | "to-public";
  bridgeAddress: string;
  pubTok: TokenConfig | undefined;
  estimationAmount: string;
}): Promise<string> {
  const { provider, direction, bridgeAddress, pubTok, estimationAmount } = params;

  try {
    let gasPrice = 1000000000n;
    try {
      gasPrice = await getSepoliaGasPrice(provider);
    } catch {
      /* default 1 gwei */
    }

    const walletAddr = await provider.getSigner().then(s => s.getAddress());
    const dec = pubTok?.decimals ?? 18;
    const amountWei = ethers.parseUnits(estimationAmount, dec);

    let gasLimit: bigint;
    let podValueWei: bigint;
    if (direction === "to-private") {
      const podFees = await quotePortalPodRequest(
        await provider.getSigner(),
        bridgeAddress,
        "deposit",
        [
          { value: walletAddr },
          { value: amountWei.toString() },
          { value: "0", isCallBackFee: true },
        ],
        gasPrice,
      );
      podValueWei = podFees.totalFeeWei;
      const iface = new ethers.Interface(["function deposit(address recipient,uint256 amount,uint256 mintCallbackFee) payable"]);
      const calldataPod = iface.encodeFunctionData("deposit", [walletAddr, amountWei, podFees.callbackFeeWei]);
      try {
        const gasEstimateHex = await (window.ethereum as EthereumRequest).request({
          method: "eth_estimateGas",
          params: [
            {
              from: walletAddr,
              to: bridgeAddress,
              data: calldataPod,
              value: "0x" + podValueWei.toString(16),
            },
          ],
        });
        gasLimit = BigInt(gasEstimateHex);
      } catch {
        gasLimit = 850000n;
      }
    } else {
      const placeholderDeadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30);
      const transferQuote = await quotePortalPodRequest(
        await provider.getSigner(),
        bridgeAddress,
        "requestWithdrawWithPermit",
        [
          { value: walletAddr },
          { value: amountWei.toString() },
          { value: "0" },
          { value: "0", isCallBackFee: true },
          { value: "0" },
          { value: "0" },
          { value: placeholderDeadline.toString() },
          { value: "0" },
          { value: ethers.ZeroHash },
          { value: ethers.ZeroHash },
        ],
        gasPrice,
      );
      const burnQuote = await quotePortalPodRequest(
        await provider.getSigner(),
        bridgeAddress,
        "requestWithdrawWithPermit",
        [
          { value: walletAddr },
          { value: amountWei.toString() },
          { value: "0" },
          { value: "0" },
          { value: "0" },
          { value: "0", isCallBackFee: true },
          { value: placeholderDeadline.toString() },
          { value: "0" },
          { value: ethers.ZeroHash },
          { value: ethers.ZeroHash },
        ],
        gasPrice,
      );
      podValueWei = transferQuote.totalFeeWei + burnQuote.totalFeeWei;
      gasLimit = 900000n;
    }

    const gasCostWei = gasLimit * gasPrice;
    const totalNativeWei = gasCostWei + podValueWei;
    /* v8 ignore next */
    return ethers.formatEther(totalNativeWei).replace(/\.?0+$/, "") || "0"; /* v8 ignore branch */
  } catch (err) {
    // The PoD portal contract reverts estimateFee() when the wallet is not yet registered
    // (i.e. before the user has completed onboarding). Suppress the error and return a
    // static realistic fallback so the UI can still render without spamming the console.
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("pending") && !msg.includes("untrusted")) {
      console.warn("⚠️ PoD gas estimation unavailable (wallet may not be onboarded yet). Using static fallback.");
    }
    // Static fallback: 850k gas × 1 gwei for deposit, 900k gas × 1 gwei for withdraw
    const fallbackGas = direction === "to-private" ? 850000n : 900000n;
    const fallbackFeeWei = fallbackGas * 1000000000n;
    /* v8 ignore next */
    return ethers.formatEther(fallbackFeeWei).replace(/\.?0+$/, "") || "0"; /* v8 ignore branch -- fallback fee is always > 0 */
  }
}
