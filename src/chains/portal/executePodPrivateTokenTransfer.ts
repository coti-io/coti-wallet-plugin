import { ethers } from "ethers";
import { POD_PTOKEN_ABI, type PodPortalRequest } from "../../contracts/pod";
import { getChainConfig } from "../index";
import { getEthereumProvider, type EIP1193Provider } from "../../lib/ethereum";
import { logger } from "../../lib/logger";
import { assertPodPTokenReady } from "./executePodPortalTransaction";
import { resolvePodTxGasPrice } from "./podPortalFees";
import {
  buildPodTransferMethodArgs,
  estimatePodTransferFee,
  quotePodTransferFees,
  sendPodTransferMethod,
  type PodTransferFeeQuote,
} from "./podTransferFees";
import {
  resolvePrivateTokenTransferTarget,
} from "../../hooks/privacyBridge/executePrivateTokenTransfer";

// Re-export quote helpers for consumers / tests.
export { quotePodTransferFees, buildPodTransferMethodArgs } from "./podTransferFees";
export type { PodTransferFeeQuote } from "./podTransferFees";

const findParsedEvent = (receipt: ethers.TransactionReceipt, iface: ethers.Interface, eventName: string) => {
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
      if (parsed?.name === eventName) return parsed;
    } catch {
      // Ignore logs from other contracts.
    }
  }
  return null;
};

export interface ExecutePodPrivateTokenTransferParams {
  chainId: number;
  symbol: string;
  recipient: string;
  amount: string;
  walletAddress: string;
  provider?: EIP1193Provider | null;
}

export interface ExecutePodPrivateTokenTransferResult {
  txHash: string;
  request?: PodPortalRequest;
}

function validatePodTransferInputs(
  tokenAddress: string,
  recipient: string,
  amount: string,
  walletAddress: string,
): void {
  if (!ethers.isAddress(tokenAddress)) {
    throw new Error("Invalid token contract address");
  }
  if (!ethers.isAddress(recipient)) {
    throw new Error("Invalid recipient address");
  }
  if (recipient.toLowerCase() === walletAddress.toLowerCase()) {
    throw new Error("Cannot send to your own address");
  }
  if (!amount?.trim() || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw new Error("Amount must be greater than zero");
  }
}

/**
 * PoD pToken peer Send — quote + encrypt + pay inbox fee via `@coti-io/pod-sdk`,
 * mirroring portal in/out fee/send discipline (pinned gasPrice, callback fee slot).
 */
export async function executePodPrivateTokenTransfer(
  params: ExecutePodPrivateTokenTransferParams,
): Promise<ExecutePodPrivateTokenTransferResult> {
  const { chainId, symbol, recipient, amount, walletAddress } = params;

  const chainConfig = getChainConfig(chainId);
  if (chainConfig?.portalStrategy !== "pod-privacy-portal") {
    throw new Error("PoD private transfer is only supported on PoD portal chains.");
  }

  const target = resolvePrivateTokenTransferTarget(chainId, symbol);
  if (!target) {
    throw new Error("This token is not supported for send on this network.");
  }

  validatePodTransferInputs(target.tokenAddress, recipient, amount, walletAddress);

  const eip1193 = params.provider ?? getEthereumProvider();
  if (!eip1193) {
    throw new Error("No wallet found");
  }

  const browserProvider = new ethers.BrowserProvider(eip1193);
  const signer = await browserProvider.getSigner(walletAddress);
  const amountWei = ethers.parseUnits(amount, target.decimals);
  if (amountWei <= 0n) {
    throw new Error("Amount must be greater than zero");
  }

  const pToken = new ethers.Contract(target.tokenAddress, POD_PTOKEN_ABI, signer);
  await assertPodPTokenReady(pToken, walletAddress, "transfer", {
    chainId,
    tokenSymbol: symbol,
    provider: browserProvider,
  });

  const gasPrice = await resolvePodTxGasPrice(browserProvider);
  const args = buildPodTransferMethodArgs({ recipient, amountWei });
  const podFee = await estimatePodTransferFee({
    runner: signer,
    pTokenAddress: target.tokenAddress,
    chainId,
    args,
    gasPrice,
  });

  logger.log("Sending PoD private token transfer", {
    chainId,
    symbol,
    token: target.tokenAddress,
    recipient,
    amount,
    totalFee: podFee.totalFee.toString(),
    gasPrice: gasPrice.toString(),
  });

  const tx = await sendPodTransferMethod({
    runner: signer,
    pTokenAddress: target.tokenAddress,
    chainId,
    args,
    gasPrice,
    fee: podFee,
  });

  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    const failed = new Error("PoD private token transfer failed") as Error & { txHash?: string };
    failed.txHash = tx.hash;
    throw failed;
  }

  const event = findParsedEvent(receipt, new ethers.Interface(POD_PTOKEN_ABI), "TransferRequestSubmitted");
  const requestId = event?.args?.requestId as string | undefined;

  return {
    txHash: tx.hash,
    request: {
      id: tx.hash,
      kind: "transfer",
      chainId,
      sourceTxHash: tx.hash,
      requestId,
      wallet: walletAddress,
      token: symbol,
      amount,
      status: "source-mined",
      message: requestId
        ? "PoD transfer request submitted."
        : "Source transaction mined; request id not found.",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fromBlock: receipt.blockNumber,
    },
  };
}

/** Quote PoD transfer fees for UI (recipient may be a placeholder when unknown). */
export async function quotePodPrivateTokenTransferFees(params: {
  chainId: number;
  symbol: string;
  recipient: string;
  amount: string;
  walletAddress: string;
  provider?: EIP1193Provider | null;
}): Promise<PodTransferFeeQuote> {
  const target = resolvePrivateTokenTransferTarget(params.chainId, params.symbol);
  if (!target) {
    throw new Error("This token is not supported for send on this network.");
  }

  const eip1193 = params.provider ?? getEthereumProvider();
  if (!eip1193) {
    throw new Error("No wallet found");
  }

  const browserProvider = new ethers.BrowserProvider(eip1193);
  const signer = await browserProvider.getSigner(params.walletAddress);
  const amountWei = ethers.parseUnits(params.amount, target.decimals);
  const recipient =
    ethers.isAddress(params.recipient) && params.recipient !== ethers.ZeroAddress
      ? params.recipient
      : params.walletAddress;

  return quotePodTransferFees({
    runner: signer,
    chainId: params.chainId,
    pTokenAddress: target.tokenAddress,
    recipient,
    amountWei,
  });
}
