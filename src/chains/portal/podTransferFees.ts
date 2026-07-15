import { ethers } from "ethers";
import {
  DataType,
  PodContract,
  encodePodMethodArguments,
  type EncryptContext,
  type PodFeeEstimate,
  type PodFeeEstimationConfig,
  type PodMethodArgument,
} from "@coti-io/pod-sdk";
import { POD_PTOKEN_ABI } from "../../contracts/pod";
import { getChainConfig, getRpcUrlForChain } from "../index";
import { logger } from "../../lib/logger";
import { getPodSdkConfig } from "./podSdkConfig";
import { POD_DEFAULT_CALLBACK_DATA_SIZE, POD_INBOX_ADDRESS } from "../podInbox";
import {
  buildPodPortalTxGasOverrides,
  formatPodFeeDisplay,
  resolvePodTxGasPrice,
} from "./podPortalFees";

export const POD_TRANSFER_METHOD = "transfer";

export type PodTransferFeeQuote = {
  gasPrice: bigint;
  podInboxFeeWei: bigint;
  podCallbackFeeWei: bigint;
  l1ExecutionGasWei: bigint;
  podFeeEstimate: PodFeeEstimate;
  display: {
    podInboxFee: string;
    l1Gas: string;
    feeSymbol: string;
  };
};

export const createPodPTokenContract = (
  pTokenAddress: string,
  runner: ethers.ContractRunner,
) =>
  new PodContract(pTokenAddress, POD_PTOKEN_ABI, runner, {
    config: getPodSdkConfig(),
    inboxAddress: POD_INBOX_ADDRESS,
  });

export const buildPodTransferMethodArgs = (params: {
  recipient: string;
  amountWei: bigint;
}): PodMethodArgument[] => [
  { type: DataType.String, value: params.recipient, isCallBackFee: false },
  { type: DataType.itUint256, value: params.amountWei.toString(), isCallBackFee: false },
  { type: DataType.Uint256, value: "0", isCallBackFee: true },
];

export const resolvePodTransferFeeEstimationConfig = (
  chainId: number,
  gasPrice: bigint,
): PodFeeEstimationConfig => {
  const limits = getChainConfig(chainId)?.podFeeEstimation?.transfer;
  if (!limits) {
    throw new Error(`PoD transfer fee estimation is not configured for chain ${chainId}`);
  }
  const callBackDataSize = limits.callBackDataSize ?? POD_DEFAULT_CALLBACK_DATA_SIZE;
  const config: PodFeeEstimationConfig = {
    forwardGasLimit: limits.forwardGasLimit,
    gasPrice,
  };
  if (limits.callBackGasLimit !== undefined) {
    config.callBackGasLimit = limits.callBackGasLimit;
    config.callBackDataSize = callBackDataSize;
  }
  return config;
};

export const estimatePodTransferFee = async (params: {
  runner: ethers.ContractRunner;
  pTokenAddress: string;
  chainId: number;
  args: PodMethodArgument[];
  gasPrice: bigint;
}): Promise<PodFeeEstimate> => {
  const pod = createPodPTokenContract(params.pTokenAddress, params.runner);
  const feeCfg = resolvePodTransferFeeEstimationConfig(params.chainId, params.gasPrice);
  return pod.estimateFee(POD_TRANSFER_METHOD, params.args, feeCfg);
};

const fallbackTransferGasLimit = (chainId: number): bigint => {
  const limits = getChainConfig(chainId)?.podFeeEstimation?.transfer;
  return limits?.forwardGasLimit ?? 850_000n;
};

/** L1 execution gas display — plaintext simulation is not possible for encrypted transfer. */
export const estimatePodTransferExecutionGasWei = (
  chainId: number,
  gasPrice: bigint,
): bigint => fallbackTransferGasLimit(chainId) * gasPrice;

const resolveNativeFeeSymbol = (chainId: number): string => {
  const symbol = getChainConfig(chainId)?.walletNetwork.nativeCurrency.symbol;
  return symbol ?? "ETH";
};

/** Single source of truth for PoD pToken Send fee quotes — one gasPrice, inbox + L1 gas. */
export const quotePodTransferFees = async (params: {
  runner: ethers.ContractRunner;
  chainId: number;
  pTokenAddress: string;
  recipient: string;
  amountWei: bigint;
  gasPrice?: bigint;
}): Promise<PodTransferFeeQuote> => {
  const provider =
    "provider" in params.runner && params.runner.provider
      ? (params.runner.provider as ethers.Provider)
      : (params.runner as ethers.Provider);
  const gasPrice = params.gasPrice ?? (await resolvePodTxGasPrice(provider));
  const args = buildPodTransferMethodArgs({
    recipient: params.recipient,
    amountWei: params.amountWei,
  });
  const podFeeEstimate = await estimatePodTransferFee({
    runner: params.runner,
    pTokenAddress: params.pTokenAddress,
    chainId: params.chainId,
    args,
    gasPrice,
  });
  const l1ExecutionGasWei = estimatePodTransferExecutionGasWei(params.chainId, gasPrice);

  logger.debug("[podTransferFees] quote", {
    chainId: params.chainId,
    pTokenAddress: params.pTokenAddress,
    amountWei: params.amountWei.toString(),
    gasPrice: gasPrice.toString(),
    totalFee: podFeeEstimate.totalFee.toString(),
    callBackFee: podFeeEstimate.callBackFee.toString(),
    l1ExecutionGasWei: l1ExecutionGasWei.toString(),
  });

  return {
    gasPrice,
    podInboxFeeWei: podFeeEstimate.totalFee,
    podCallbackFeeWei: podFeeEstimate.callBackFee,
    l1ExecutionGasWei,
    podFeeEstimate,
    display: {
      podInboxFee: formatPodFeeDisplay(podFeeEstimate.totalFee),
      l1Gas: formatPodFeeDisplay(l1ExecutionGasWei),
      feeSymbol: resolveNativeFeeSymbol(params.chainId),
    },
  };
};

/**
 * Send a PoD pToken transfer via pod-sdk encryption + pinned gasPrice
 * (inbox fee validation requires tx.gasprice to match the estimate).
 */
export const sendPodTransferMethod = async (params: {
  runner: ethers.Signer;
  pTokenAddress: string;
  chainId: number;
  args: PodMethodArgument[];
  gasPrice: bigint;
  gasLimit?: bigint;
  fee?: PodFeeEstimate;
}): Promise<ethers.ContractTransactionResponse> => {
  const pod = createPodPTokenContract(params.pTokenAddress, params.runner);
  const fee =
    params.fee ??
    (await pod.estimateFee(
      POD_TRANSFER_METHOD,
      params.args,
      resolvePodTransferFeeEstimationConfig(params.chainId, params.gasPrice),
    ));

  const fn = pod.contract.getFunction(POD_TRANSFER_METHOD);
  const userAddress = await params.runner.getAddress();
  const encryptContext: EncryptContext = {
    contractAddress: params.pTokenAddress,
    functionSelector: fn.fragment.selector,
    userAddress,
  };

  const encodedArgs = await encodePodMethodArguments(
    params.args.map(arg => ({ ...arg })),
    getPodSdkConfig().encryptionNetwork ?? "testnet",
    true,
    encryptContext,
  );

  const cbIndex = encodedArgs.findIndex(arg => arg.isCallBackFee);
  if (cbIndex !== -1) {
    encodedArgs[cbIndex].value = fee.callBackFee;
  }

  const vals = encodedArgs.map(arg => arg.value);
  const gasOverrides = await buildPodPortalTxGasOverrides(params.runner, params.gasPrice);
  const overrides: ethers.TransactionRequest = {
    value: fee.totalFee,
    ...gasOverrides,
  };
  if (params.gasLimit) {
    overrides.gasLimit = params.gasLimit;
  }

  // Prefer an RPC-backed estimate when possible; encrypted calldata may still revert
  // in eth_call on some nodes — fall back to configured forward gas limit.
  if (!overrides.gasLimit) {
    try {
      const rpcUrl = getRpcUrlForChain(params.chainId);
      const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
      const pToken = new ethers.Contract(params.pTokenAddress, POD_PTOKEN_ABI, rpcProvider);
      const estimated = await pToken.getFunction(POD_TRANSFER_METHOD).estimateGas(...vals, {
        from: userAddress,
        value: fee.totalFee,
        gasPrice: params.gasPrice,
      });
      overrides.gasLimit = (estimated * 130n) / 100n;
    } catch {
      overrides.gasLimit = fallbackTransferGasLimit(params.chainId);
    }
  }

  return fn(...vals, overrides);
};
