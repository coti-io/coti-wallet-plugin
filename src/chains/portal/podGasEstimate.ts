import { ethers } from "ethers";
import type { TokenConfig } from "../types";
import { getRpcUrlForChain } from "../index";
import {
  getSepoliaGasPrice,
  quotePortalDepositFees,
  quotePortalWithdrawFees,
} from "./executePodPortalTransaction";
import { logger } from "../../lib/logger";

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
      const isNativeDeposit = !!pubTok?.isNative;
      const fees = await quotePortalDepositFees(
        await provider.getSigner(),
        bridgeAddress,
        amountWei,
        gasPrice,
      );
      // For native deposits the msg.value sent to the contract is amountWei + fees.msgValue,
      // but only the fee portion is the actual *cost* to the user — the deposit amount is
      // not a fee. We track both: the full value for accurate gas simulation, and just the
      // fee portion for the displayed cost.
      podValueWei = fees.msgValue;
      const simulationValue = isNativeDeposit ? amountWei + fees.msgValue : fees.msgValue;
      const depositSig = isNativeDeposit
        ? "function depositNative(address recipient,uint256 amount,uint256 portalFee,uint256 mintCallbackFee) payable"
        : "function deposit(address recipient,uint256 amount,uint256 portalFee,uint256 mintCallbackFee) payable";
      const iface = new ethers.Interface([depositSig]);
      const calldataPod = iface.encodeFunctionData(isNativeDeposit ? "depositNative" : "deposit", [
        walletAddr,
        amountWei,
        fees.portalFee,
        fees.mintCallbackFee,
      ]);
      // Use a direct JSON-RPC provider — routing eth_estimateGas through MetaMask
      // logs noisy "execution reverted" errors when the simulation lacks allowance.
      try {
        const rpcUrl = getRpcUrlForChain(params.currentChainId);
        const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
        gasLimit = await rpcProvider.estimateGas({
          from: walletAddr,
          to: bridgeAddress,
          data: calldataPod,
          value: simulationValue,
        });
      } catch {
        gasLimit = 850000n;
      }
    } else {
      const placeholderDeadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30);
      const fees = await quotePortalWithdrawFees(
        await provider.getSigner(),
        bridgeAddress,
        amountWei,
        gasPrice,
      );
      podValueWei = fees.msgValue;
      const withdrawSig =
        "function requestWithdrawWithPermit(address recipient,uint256 amount,uint256 portalFee,uint256 transferFee,uint256 transferCallbackFee,uint256 permitDeadline,uint8 v,bytes32 r,bytes32 s) payable";
      const iface = new ethers.Interface([withdrawSig]);
      const calldataPod = iface.encodeFunctionData("requestWithdrawWithPermit", [
        walletAddr,
        amountWei,
        fees.portalFee,
        fees.transferTotalFee,
        fees.transferCallbackFee,
        placeholderDeadline,
        0,
        ethers.ZeroHash,
        ethers.ZeroHash,
      ]);
      try {
        const rpcUrl = getRpcUrlForChain(params.currentChainId);
        const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
        gasLimit = await rpcProvider.estimateGas({
          from: walletAddr,
          to: bridgeAddress,
          data: calldataPod,
          value: fees.msgValue,
        });
      } catch {
        gasLimit = 900000n;
      }
    }

    const gasCostWei = gasLimit * gasPrice;
    const totalNativeWei = gasCostWei + podValueWei;
    /* v8 ignore next */
    return ethers.formatEther(totalNativeWei).replace(/\.?0+$/, "") || "0"; /* v8 ignore branch */
  } catch (err) {
    // The PoD portal contract reverts estimateFee() when the wallet is not yet registered
    // (i.e. before the user has completed onboarding). Suppress the error and return a
    // static realistic fallback so the UI can still render without spamming logs.
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("pending") && !msg.includes("untrusted")) {
      logger.warn('PoD gas estimation unavailable (wallet may not be onboarded yet). Using static fallback.');
    }
    // Static fallback: 850k gas × 1 gwei for deposit, 900k gas × 1 gwei for withdraw
    const fallbackGas = direction === "to-private" ? 850000n : 900000n;
    const fallbackFeeWei = fallbackGas * 1000000000n;
    /* v8 ignore next */
    return ethers.formatEther(fallbackFeeWei).replace(/\.?0+$/, "") || "0"; /* v8 ignore branch -- fallback fee is always > 0 */
  }
}
