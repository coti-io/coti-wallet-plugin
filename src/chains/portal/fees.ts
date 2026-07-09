import { ethers } from "ethers";
import type { PodFeeEstimate } from "@coti-io/pod-sdk";
import { getChainConfig } from "../index";
import type { TokenConfig } from "../types";
import { logger } from "../../lib/logger";
import type { PodWithdrawPermit } from "./podPortalFees";
import {
  buildPodMethodArgs,
  estimatePodExecutionGasWei,
  estimatePodFee,
  formatPodFeeDisplay,
  formatPortalFeeDisplay,
  quotePortalFeeOnly,
  resolvePodPortalMethod,
  resolvePodTxGasPrice,
} from "./podPortalFees";

export type PodPortalFeeQuote = {
  gasPrice: bigint;
  portalFeeWei: bigint;
  podInboxFeeWei: bigint;
  podCallbackFeeWei: bigint;
  l1ExecutionGasWei: bigint;
  podFeeEstimate: PodFeeEstimate;
  usedDynamicPricing: boolean;
  display: {
    portalFee: string;
    podInboxFee: string;
    l1Gas: string;
    portalFeeSymbol: string;
  };
};

/** Single source of truth for PoD portal fee quotes — one gasPrice, all components. */
export const quotePodPortalTransactionFees = async (params: {
  runner: ethers.ContractRunner;
  chainId: number;
  portalAddress: string;
  pubTok: TokenConfig | undefined;
  amount: string;
  direction: "to-private" | "to-public";
  withdrawPermit?: PodWithdrawPermit;
  gasPrice?: bigint;
}): Promise<PodPortalFeeQuote> => {
  const dec = params.pubTok?.decimals ?? 18;
  const amountWei = ethers.parseUnits(params.amount, dec);
  const provider =
    "provider" in params.runner && params.runner.provider
      ? (params.runner.provider as ethers.Provider)
      : (params.runner as ethers.Provider);
  const gasPrice = params.gasPrice ?? await resolvePodTxGasPrice(provider);
  const nativeSymbol =
    getChainConfig(params.chainId)?.walletNetwork.nativeCurrency.symbol ?? "ETH";

  const portalQuote = await quotePortalFeeOnly(
    params.runner,
    params.portalAddress,
    amountWei,
    params.direction,
    gasPrice,
  );
  const method = resolvePodPortalMethod(params.direction, !!params.pubTok?.isNative);
  const wallet = await (params.runner as ethers.Signer).getAddress();
  const args = buildPodMethodArgs({
    direction: params.direction,
    wallet,
    amountWei,
    portalFee: portalQuote.portalFee,
    isNativeDeposit: !!params.pubTok?.isNative,
    withdrawPermit: params.withdrawPermit,
  });
  const podFeeEstimate = await estimatePodFee({
    runner: params.runner,
    portalAddress: params.portalAddress,
    chainId: params.chainId,
    direction: params.direction,
    method,
    args,
    gasPrice,
  });
  const l1ExecutionGasWei = await estimatePodExecutionGasWei({
    chainId: params.chainId,
    portalAddress: params.portalAddress,
    wallet,
    amountWei,
    portalFee: portalQuote.portalFee,
    direction: params.direction,
    isNativeDeposit: !!params.pubTok?.isNative,
    gasPrice,
    podFee: podFeeEstimate,
    withdrawPermit: params.withdrawPermit,
  });

  const result: PodPortalFeeQuote = {
    gasPrice,
    portalFeeWei: portalQuote.portalFee,
    podInboxFeeWei: podFeeEstimate.totalFee,
    podCallbackFeeWei: podFeeEstimate.callBackFee,
    l1ExecutionGasWei,
    podFeeEstimate,
    usedDynamicPricing: portalQuote.usedDynamicPricing,
    display: {
      portalFee: formatPortalFeeDisplay(portalQuote.portalFee, portalQuote.usedDynamicPricing),
      podInboxFee: formatPodFeeDisplay(podFeeEstimate.totalFee),
      l1Gas: formatPodFeeDisplay(l1ExecutionGasWei),
      portalFeeSymbol: nativeSymbol,
    },
  };

  logger.debug("[portal/fees] quotePodPortalTransactionFees", {
    chainId: params.chainId,
    direction: params.direction,
    portalAddress: params.portalAddress,
    amount: params.amount,
    gasPrice: gasPrice.toString(),
    portalFeeWei: result.portalFeeWei.toString(),
    podInboxFeeWei: result.podInboxFeeWei.toString(),
    l1ExecutionGasWei: l1ExecutionGasWei.toString(),
  });

  return result;
};
