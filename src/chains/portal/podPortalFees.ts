import { ethers } from "ethers";
import {
  DataType,
  PodContract,
  encodePodMethodArguments,
  type PodFeeEstimate,
  type PodFeeEstimationConfig,
  type PodMethodArgument,
} from "@coti-io/pod-sdk";
import { PRIVACY_PORTAL_ABI } from "../../contracts/pod";
import { getChainConfig, getRpcUrlForChain } from "../index";
import { logger } from "../../lib/logger";
import { getPodSdkConfig } from "./podSdkConfig";
import { POD_DEFAULT_CALLBACK_DATA_SIZE, POD_INBOX_ADDRESS } from "../podInbox";
import type { TokenConfig } from "../types";

export interface PodWithdrawPermit {
  wallet: string;
  pTokenAddress: string;
  portalAddress: string;
  amountWei: string;
  deadline: string;
  v: number;
  r: string;
  s: string;
}

export type PortalFeeQuote = {
  portalFee: bigint;
  usedDynamicPricing: boolean;
  gasPrice: bigint;
};

const resolveFeeRunnerProvider = (runner: ethers.ContractRunner): ethers.Provider => {
  if ("provider" in runner && runner.provider) {
    return runner.provider as ethers.Provider;
  }
  return runner as ethers.Provider;
};

/** 10% headroom applied to spot gas price for both estimate and send. */
export const POD_GAS_PRICE_BUFFER_BPS = 1100n;

/** Spot chain gas price via `eth_gasPrice`. */
export const getPodGasPrice = async (
  provider: ethers.BrowserProvider | ethers.JsonRpcProvider | ethers.Provider,
): Promise<bigint> => {
  const rpc = provider as ethers.JsonRpcProvider;
  const gasPriceHex = await rpc.send("eth_gasPrice", []);
  return BigInt(gasPriceHex);
};

/**
 * Gas price for PoD inbox fee estimation and tx send.
 * Uses `getFeeData().gasPrice` when available, with a 10% buffer so estimate
 * and `tx.gasprice` stay aligned per pod-sdk inbox rules.
 */
export const resolvePodTxGasPrice = async (
  provider: ethers.BrowserProvider | ethers.JsonRpcProvider | ethers.Provider,
): Promise<bigint> => {
  let base: bigint;
  try {
    const feeData = await provider.getFeeData();
    base = feeData.gasPrice ?? await getPodGasPrice(provider);
  } catch {
    base = await getPodGasPrice(provider);
  }
  return (base * POD_GAS_PRICE_BUFFER_BPS) / 1000n;
};

/** @deprecated Use {@link resolvePodTxGasPrice}. */
export const getSepoliaGasPrice = resolvePodTxGasPrice;

export const quotePortalFeeOnly = async (
  runner: ethers.ContractRunner,
  portalAddress: string,
  amount: bigint,
  direction: "to-private" | "to-public",
  gasPrice?: bigint,
): Promise<PortalFeeQuote> => {
  const provider = resolveFeeRunnerProvider(runner);
  const resolvedGasPrice = gasPrice ?? await resolvePodTxGasPrice(provider);
  const portal = new ethers.Contract(portalAddress, PRIVACY_PORTAL_ABI, runner);

  if (direction === "to-private") {
    const [portalFee, usedDynamicPricing] = await portal.estimateDepositFees(amount);
    const quote = {
      portalFee: BigInt(portalFee.toString()),
      usedDynamicPricing: Boolean(usedDynamicPricing),
      gasPrice: resolvedGasPrice,
    };
    logger.debug("[podPortalFees] quotePortalFeeOnly deposit", {
      portalAddress,
      amount: amount.toString(),
      portalFee: quote.portalFee.toString(),
      usedDynamicPricing: quote.usedDynamicPricing,
      gasPrice: quote.gasPrice.toString(),
    });
    return quote;
  }

  const [portalFee, usedDynamicPricing] = await portal.estimateWithdrawFees(amount);
  const quote = {
    portalFee: BigInt(portalFee.toString()),
    usedDynamicPricing: Boolean(usedDynamicPricing),
    gasPrice: resolvedGasPrice,
  };
  logger.debug("[podPortalFees] quotePortalFeeOnly withdraw", {
    portalAddress,
    amount: amount.toString(),
    portalFee: quote.portalFee.toString(),
    usedDynamicPricing: quote.usedDynamicPricing,
    gasPrice: quote.gasPrice.toString(),
  });
  return quote;
};

export const formatPortalFeeDisplay = (
  portalFee: bigint,
  _usedDynamicPricing?: boolean,
): string => ethers.formatEther(portalFee).replace(/\.?0+$/, "") || "0";

export const formatPodFeeDisplay = (totalFee: bigint): string =>
  ethers.formatEther(totalFee).replace(/\.?0+$/, "") || "0";

export const resolvePodFeeEstimationConfig = (
  chainId: number,
  direction: "to-private" | "to-public",
  gasPrice: bigint,
): PodFeeEstimationConfig => {
  const limits = getChainConfig(chainId)?.podFeeEstimation?.[direction === "to-private" ? "deposit" : "withdraw"];
  if (!limits) {
    throw new Error(`PoD fee estimation is not configured for chain ${chainId}`);
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

export const resolvePodPortalMethod = (
  direction: "to-private" | "to-public",
  isNativeDeposit: boolean,
): string => {
  if (direction === "to-private") {
    return isNativeDeposit ? "depositNative" : "deposit";
  }
  return "requestWithdrawWithPermit";
};

export const buildPodMethodArgs = (params: {
  direction: "to-private" | "to-public";
  wallet: string;
  amountWei: bigint;
  portalFee: bigint;
  isNativeDeposit?: boolean;
  withdrawPermit?: PodWithdrawPermit;
  /** Remote PoD fee component for withdraw (`transferFee` arg). */
  remoteFee?: bigint;
}): PodMethodArgument[] => {
  const {
    direction,
    wallet,
    amountWei,
    portalFee,
    isNativeDeposit = false,
    withdrawPermit,
    remoteFee = 0n,
  } = params;

  if (direction === "to-private") {
    return [
      { type: DataType.String, value: wallet, isCallBackFee: false },
      { type: DataType.Uint256, value: amountWei.toString(), isCallBackFee: false },
      { type: DataType.Uint256, value: portalFee.toString(), isCallBackFee: false },
      { type: DataType.Uint256, value: "0", isCallBackFee: true },
    ];
  }

  if (
    !withdrawPermit ||
    withdrawPermit.wallet.toLowerCase() !== wallet.toLowerCase() ||
    withdrawPermit.amountWei !== amountWei.toString()
  ) {
    const placeholderDeadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 30);
    return [
      { type: DataType.String, value: wallet, isCallBackFee: false },
      { type: DataType.Uint256, value: amountWei.toString(), isCallBackFee: false },
      { type: DataType.Uint256, value: portalFee.toString(), isCallBackFee: false },
      { type: DataType.Uint256, value: remoteFee.toString(), isCallBackFee: false },
      { type: DataType.Uint256, value: "0", isCallBackFee: true },
      { type: DataType.Uint256, value: placeholderDeadline.toString(), isCallBackFee: false },
      { type: DataType.Uint8, value: "0", isCallBackFee: false },
      { type: DataType.String, value: ethers.ZeroHash, isCallBackFee: false },
      { type: DataType.String, value: ethers.ZeroHash, isCallBackFee: false },
    ];
  }

  return [
    { type: DataType.String, value: wallet, isCallBackFee: false },
    { type: DataType.Uint256, value: amountWei.toString(), isCallBackFee: false },
    { type: DataType.Uint256, value: portalFee.toString(), isCallBackFee: false },
    { type: DataType.Uint256, value: remoteFee.toString(), isCallBackFee: false },
    { type: DataType.Uint256, value: "0", isCallBackFee: true },
    { type: DataType.Uint256, value: withdrawPermit.deadline, isCallBackFee: false },
    { type: DataType.Uint8, value: withdrawPermit.v.toString(), isCallBackFee: false },
    { type: DataType.String, value: withdrawPermit.r, isCallBackFee: false },
    { type: DataType.String, value: withdrawPermit.s, isCallBackFee: false },
  ];
};

export const createPodContract = (
  portalAddress: string,
  runner: ethers.ContractRunner,
) =>
  new PodContract(portalAddress, PRIVACY_PORTAL_ABI, runner, {
    config: getPodSdkConfig(),
    inboxAddress: POD_INBOX_ADDRESS,
  });

const fallbackExecutionGasLimit = (
  chainId: number,
  direction: "to-private" | "to-public",
): bigint => {
  const limits = getChainConfig(chainId)?.podFeeEstimation;
  if (!limits) return direction === "to-private" ? 850_000n : 900_000n;
  return direction === "to-private" ? limits.deposit.forwardGasLimit : limits.withdraw.forwardGasLimit;
};

/** L1 execution gas cost (gasLimit × gasPrice) for the portal tx, aligned with executor simulation. */
export const estimatePodExecutionGasWei = async (params: {
  chainId: number;
  portalAddress: string;
  wallet: string;
  amountWei: bigint;
  portalFee: bigint;
  direction: "to-private" | "to-public";
  isNativeDeposit: boolean;
  gasPrice: bigint;
  podFee: PodFeeEstimate;
  withdrawPermit?: PodWithdrawPermit;
}): Promise<bigint> => {
  const fallbackLimit = fallbackExecutionGasLimit(params.chainId, params.direction);
  try {
    const rpcUrl = getRpcUrlForChain(params.chainId);
    const rpcProvider = new ethers.JsonRpcProvider(rpcUrl);
    const portal = new ethers.Contract(params.portalAddress, PRIVACY_PORTAL_ABI, rpcProvider);

    if (params.direction === "to-private") {
      const method = resolvePodPortalMethod("to-private", params.isNativeDeposit);
      // The portal requires msg.value to cover the PoD fee on top of portalFee
      // (and the deposit amount for native), otherwise the simulation reverts.
      const nativeAmount = params.isNativeDeposit ? params.amountWei : 0n;
      const simulationValue = nativeAmount + params.portalFee + params.podFee.totalFee;
      const gasLimit = await portal[method].estimateGas(
        params.wallet,
        params.amountWei,
        params.portalFee,
        params.podFee.callBackFee,
        { from: params.wallet, value: simulationValue, gasPrice: params.gasPrice },
      );
      return gasLimit * params.gasPrice;
    }

    const permit = params.withdrawPermit;
    const deadline = permit
      ? BigInt(permit.deadline)
      : BigInt(Math.floor(Date.now() / 1000) + 60 * 30);
    const v = permit?.v ?? 0;
    const r = permit?.r ?? ethers.ZeroHash;
    const s = permit?.s ?? ethers.ZeroHash;
    // The contract requires transferFee == msg.value - portalFee, and the
    // transfer fee is the full PoD fee (remote + callback).
    const gasLimit = await portal.requestWithdrawWithPermit.estimateGas(
      params.wallet,
      params.amountWei,
      params.portalFee,
      params.podFee.totalFee,
      params.podFee.callBackFee,
      deadline,
      v,
      r,
      s,
      {
        from: params.wallet,
        value: params.portalFee + params.podFee.totalFee,
        gasPrice: params.gasPrice,
      },
    );
    return gasLimit * params.gasPrice;
  } catch {
    return fallbackLimit * params.gasPrice;
  }
};

export const estimatePodFee = async (params: {
  runner: ethers.ContractRunner;
  portalAddress: string;
  chainId: number;
  direction: "to-private" | "to-public";
  method: string;
  args: PodMethodArgument[];
  gasPrice: bigint;
}): Promise<PodFeeEstimate> => {
  const pod = createPodContract(params.portalAddress, params.runner);
  const feeCfg = resolvePodFeeEstimationConfig(params.chainId, params.direction, params.gasPrice);
  return pod.estimateFee(params.method, params.args, feeCfg);
};

export const estimatePodPortalFees = async (params: {
  runner: ethers.ContractRunner;
  chainId: number;
  portalAddress: string;
  pubTok: TokenConfig | undefined;
  amount: string;
  direction: "to-private" | "to-public";
  withdrawPermit?: PodWithdrawPermit;
}): Promise<{
  portalFeeDisplay: string;
  podFeeDisplay: string;
  podInboxFeeDisplay: string;
  l1GasDisplay: string;
  portalFeeWei: bigint;
  podFeeEstimate: PodFeeEstimate;
  gasPrice: bigint;
  usedDynamicPricing: boolean;
}> => {
  const { quotePodPortalTransactionFees } = await import("./fees");
  const quote = await quotePodPortalTransactionFees(params);
  const combinedPodFeeWei = quote.podInboxFeeWei + quote.l1ExecutionGasWei;
  return {
    portalFeeDisplay: quote.display.portalFee,
    podFeeDisplay: formatPodFeeDisplay(combinedPodFeeWei),
    podInboxFeeDisplay: quote.display.podInboxFee,
    l1GasDisplay: quote.display.l1Gas,
    portalFeeWei: quote.portalFeeWei,
    podFeeEstimate: quote.podFeeEstimate,
    gasPrice: quote.gasPrice,
    usedDynamicPricing: quote.usedDynamicPricing,
  };
};

/** Build tx gas overrides pinned to {@link gasPrice}, using EIP-1559 when the network supports it. */
export const buildPodPortalTxGasOverrides = async (
  runner: ethers.ContractRunner,
  gasPrice: bigint,
): Promise<Pick<ethers.TransactionRequest, "type" | "gasPrice" | "maxFeePerGas" | "maxPriorityFeePerGas">> => {
  const provider = resolveFeeRunnerProvider(runner);
  let supportsEip1559 = false;
  if (provider) {
    try {
      const feeData = await provider.getFeeData();
      supportsEip1559 = feeData.maxFeePerGas != null && feeData.maxPriorityFeePerGas != null;
    } catch {
      supportsEip1559 = false;
    }
  }

  if (supportsEip1559) {
    // Effective price = min(maxFeePerGas, baseFee + maxPriorityFeePerGas).
    // Pin both to gasPrice so on-chain tx.gasprice matches the inbox estimate input.
    return {
      type: 2,
      maxFeePerGas: gasPrice,
      maxPriorityFeePerGas: gasPrice,
    };
  }

  return { gasPrice };
};

/** Send a PoD portal tx using SDK fee estimation; pins gas fees to the estimate snapshot. */
export const sendPodPortalMethod = async (params: {
  runner: ethers.Signer;
  portalAddress: string;
  chainId: number;
  direction: "to-private" | "to-public";
  method: string;
  args: PodMethodArgument[];
  gasPrice: bigint;
  portalFee: bigint;
  amountWei?: bigint;
  isNativeDeposit?: boolean;
  gasLimit?: bigint;
  /** Precomputed PoD fee (from {@link estimatePodFee}) to avoid re-estimating. */
  fee?: PodFeeEstimate;
}): Promise<ethers.ContractTransactionResponse> => {
  const pod = createPodContract(params.portalAddress, params.runner);
  const fee = params.fee ?? await pod.estimateFee(
    params.method,
    params.args,
    resolvePodFeeEstimationConfig(params.chainId, params.direction, params.gasPrice),
  );

  const cbIndex = params.args.findIndex(arg => arg.isCallBackFee);
  const encodedArgs = await encodePodMethodArguments(
    params.args.map(arg => ({ ...arg })),
    getPodSdkConfig().encryptionNetwork ?? "testnet",
    false,
  );
  if (cbIndex !== -1) {
    encodedArgs[cbIndex].value = fee.callBackFee;
  }

  if (params.direction === "to-public") {
    // Privacy Portal requires transferFee == msg.value - portalFee (full PoD fee: remote + callback).
    const transferFeeIndex = 3;
    encodedArgs[transferFeeIndex].value = fee.totalFee;
  }

  const fn = pod.contract.getFunction(params.method);
  const vals = encodedArgs.map(arg => arg.value);
  const nativeAmount = params.isNativeDeposit && params.amountWei ? params.amountWei : 0n;
  const txValue = nativeAmount + params.portalFee + fee.totalFee;
  const gasOverrides = await buildPodPortalTxGasOverrides(params.runner, params.gasPrice);
  const overrides: ethers.TransactionRequest = {
    value: txValue,
    ...gasOverrides,
  };
  if (params.gasLimit) {
    overrides.gasLimit = params.gasLimit;
  }
  return fn(...vals, overrides);
};
