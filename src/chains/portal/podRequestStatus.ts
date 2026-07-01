import { ethers } from "ethers";
import { PodRequest, type RequestTrackingResponse } from "@coti/pod-sdk";
import { getPrivateTokensForChain, getPublicTokensForChain, getNetworkNameForChain, getRpcUrlForChain } from "../index";
import { CONTRACT_ADDRESSES } from "../../contracts/config";
import { POD_PTOKEN_ABI, PRIVACY_PORTAL_ABI, type PodPortalRequest } from "../../contracts/pod";
import { getPodSdkConfig } from "./executePodPortalTransaction";
import {
  logPodTrackingDiagnostics,
  type PodStatusResolution,
} from "./podRequestTrackingDiagnostics";
import { logger } from "../../lib/logger";

const hasPodExecutionError = (execution: RequestTrackingResponse["execution"]) => {
  if (!execution) return false;
  const errorCode = execution.errorCode;
  if (errorCode === undefined || errorCode === null) return false;
  return BigInt(errorCode) !== 0n;
};

const getFailedRequestHex = async (
  provider: ethers.Provider,
  request: PodPortalRequest,
  pTokenAddress: string,
) => {
  if (!request.requestId) {
    /* v8 ignore next -- unreachable: resolvePodRequestStatus guards requestId before calling */
    return "0x";
  }
  const pToken = new ethers.Contract(pTokenAddress, POD_PTOKEN_ABI, provider);
  const failedRaw = await pToken.failedRequests(request.requestId).catch(() => "0x");
  return typeof failedRaw === "string" ? failedRaw : ethers.hexlify(failedRaw);
};

export async function resolvePodRequestStatus(request: PodPortalRequest) {
  if (!request.requestId) {
    logger.warn(
      `[PoD][resolveStatus] Missing requestId for tx ${request.sourceTxHash}. ` +
        "PoD cannot be tracked — DepositRequested event may not have been parsed.",
    );
    return {
      status: "source-mined" as const,
      message: "PoD request ID not found. Cannot track progress.",
      refreshPrivateBalances: false,
    };
  }

  const chainId = request.chainId;
  const addresses = CONTRACT_ADDRESSES[chainId];
  if (!addresses) return null;

  const rpcUrl = getRpcUrlForChain(chainId);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const sym = request.token.replace(/^p\./, "");
  const pubCfg = getPublicTokensForChain(chainId).find(t => t.symbol === sym && !t.isPrivate);
  const privCfg =
    getPrivateTokensForChain(chainId).find(t => t.symbol === `p.${sym}`) ??
    getPrivateTokensForChain(chainId).find(t => t.symbol === request.token);
  const portalKey = pubCfg?.bridgeAddressKey ?? privCfg?.bridgeAddressKey;
  const pTokenAddress = privCfg?.addressKey ? addresses[privCfg.addressKey] : undefined;
  const portalAddress = portalKey ? addresses[portalKey] : undefined;
  if (!pTokenAddress || !portalAddress) {
    logger.warn("[PoD][resolveStatus] Could not resolve portal/pToken for request", {
      chainId,
      token: request.token,
      requestId: request.requestId,
      portalKey,
      pTokenAddress,
      portalAddress,
    });
    return null;
  }

  const sourceChainName = getNetworkNameForChain(chainId);

  const failedHex = await getFailedRequestHex(provider, request, pTokenAddress);
  if (failedHex !== "0x") {
    return {
      status: "callback-errored" as const,
      message: "PoD callback failed. Balance is untrusted until the callback is replayed.",
      refreshPrivateBalances: false,
    };
  }

  const sdkConfig = getPodSdkConfig();
  let tracking: RequestTrackingResponse;
  try {
    const tracker = new PodRequest(sdkConfig);
    tracking = await tracker.trackRequest(chainId, request.requestId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("[PoD][trackRequest] SDK trackRequest failed", {
      sourceTxHash: request.sourceTxHash,
      requestId: request.requestId,
      chainId,
      message,
      sdkConfig: sdkConfig.chains.map(c => ({
        chainId: c.chainId,
        inboxAddress: c.inboxAddress,
        rpcUrl: c.rpcUrl,
      })),
    });
    throw error;
  }

  let resolution: PodStatusResolution = "no-change";
  let result: {
    status: PodPortalRequest["status"];
    message: string;
    refreshPrivateBalances: boolean;
  } | null = null;

  if (hasPodExecutionError(tracking.execution)) {
    resolution = "failed";
    result = {
      status: "failed",
      message: tracking.execution?.errorMessage || "PoD request execution failed.",
      refreshPrivateBalances: false,
    };
  } else if (request.kind === "deposit" && tracking.response?.minedOnTarget) {
    resolution = "succeeded";
    result = {
      status: "succeeded",
      message: `PoD mint callback completed on ${sourceChainName}.`,
      refreshPrivateBalances: true,
    };
  } else if (request.kind === "withdraw" && request.withdrawalId) {
    const iface = new ethers.Interface(PRIVACY_PORTAL_ABI);
    const latest = await provider.getBlockNumber();
    const fromBlock = request.fromBlock ?? Math.max(0, latest - 20_000);
    const logs = await provider.getLogs({
      address: portalAddress,
      fromBlock,
      toBlock: latest,
      topics: [iface.getEvent("WithdrawalReleased")!.topicHash, request.withdrawalId],
    });
    if (logs.length > 0) {
      resolution = "succeeded";
      result = {
        status: "succeeded",
        message: `Withdraw released on ${sourceChainName}.`,
        refreshPrivateBalances: true,
      };
    }
  }

  if (!result && tracking.response) {
    resolution = "callback-generated";
    result = {
      status: "callback-generated",
      message: `PoD callback was generated and is waiting to complete on ${sourceChainName}.`,
      refreshPrivateBalances: false,
    };
  }

  if (!result && tracking.minedOnTarget) {
    resolution = "target-mined";
    result = {
      status: "target-mined",
      message: "PoD request was mined on COTI and is waiting for callback generation.",
      refreshPrivateBalances: false,
    };
  }

  if (
    !result &&
    (request.status === "source-mined" || request.status === "pod-pending")
  ) {
    resolution = "pod-pending";
    result = {
      status: "pod-pending",
      message: "PoD request submitted. Waiting to be indexed and processed.",
      refreshPrivateBalances: false,
    };
  }

  logPodTrackingDiagnostics({
    request,
    tracking,
    sdkConfig,
    resolution,
    resolvedMessage: result?.message,
    failedHex,
  });

  return result;
}
