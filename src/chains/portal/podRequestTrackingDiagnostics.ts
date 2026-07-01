import type { RequestTrackingResponse } from "@coti/pod-sdk";
import type { PodSdkConfig } from "@coti/pod-sdk";
import { buildPodExplorerRequestUrl, type PodPortalRequest } from "../../contracts/pod";
import { logger } from "../../lib/logger";

export type PodStatusResolution =
  | "callback-errored"
  | "failed"
  | "succeeded"
  | "callback-generated"
  | "target-mined"
  | "pod-pending"
  | "source-mined-no-id"
  | "no-change";

export type SerializedTracking = {
  requestId: string;
  sourceChainId: string;
  targetChainId: string;
  timestamp: string;
  minedOnTarget: boolean;
  isTwoWay: boolean;
  localGasLimit: string;
  remoteGasLimit: string;
  execution: {
    errorCode: string;
    errorMessage: string;
  } | null;
  response: SerializedTracking | null;
};

const chainIdToExplorerSlug = (chainId: number | bigint | string) => {
  const id = Number(chainId);
  if (id === 11155111) return "sepolia";
  if (id === 7082400) return "coti";
  if (id === 43113) return "fuji";
  return String(id);
};

export const serializeTrackingResponse = (
  tracking: RequestTrackingResponse,
): SerializedTracking => ({
  requestId: tracking.requestId ?? "unknown",
  sourceChainId: tracking.sourceChainId != null ? tracking.sourceChainId.toString() : "unknown",
  targetChainId: tracking.targetChainId != null ? tracking.targetChainId.toString() : "unknown",
  timestamp: tracking.timestamp != null ? tracking.timestamp.toString() : "unknown",
  minedOnTarget: Boolean(tracking.minedOnTarget),
  isTwoWay: Boolean(tracking.isTwoWay),
  localGasLimit: tracking.localGasLimit != null ? tracking.localGasLimit.toString() : "0",
  remoteGasLimit: tracking.remoteGasLimit != null ? tracking.remoteGasLimit.toString() : "0",
  execution:
    tracking.execution?.errorCode != null && tracking.execution.errorCode !== undefined
      ? {
          errorCode: BigInt(tracking.execution.errorCode).toString(),
          errorMessage: tracking.execution.errorMessage ?? "",
        }
      : null,
  response: tracking.response ? serializeTrackingResponse(tracking.response) : null,
});

/** Human-readable explanation of why a request is still in `pod-pending`. */
export const explainPodPendingReason = (
  tracking: RequestTrackingResponse,
  kind: PodPortalRequest["kind"],
): string => {
  if (tracking.execution?.errorCode != null && BigInt(tracking.execution.errorCode) !== 0n) {
    return (
      `PoD target execution failed on chain ${tracking.targetChainId}: ` +
      `${tracking.execution.errorMessage || `error code ${tracking.execution.errorCode}`}.`
    );
  }

  if (!tracking.minedOnTarget) {
    const target = tracking.targetChainId != null ? tracking.targetChainId.toString() : "unknown";
    return (
      `Sepolia deposit is confirmed and the request exists in the source PoD inbox, but the ` +
      `relayer has not mined it on the target chain yet (targetChainId=${target}, ` +
      `incomingRequests still empty). This step is handled by off-chain PoD infrastructure — ` +
      `the UI cannot advance until the COTI inbox ingests the message.`
    );
  }

  if (tracking.isTwoWay && !tracking.response) {
    return (
      `Request was mined on COTI (targetChainId=${tracking.targetChainId}) but the two-way ` +
      `callback response has not been generated yet.`
    );
  }

  if (tracking.response && !tracking.response.minedOnTarget) {
    if (kind === "deposit") {
      return (
        `Callback was generated on COTI but has not been mined back on Sepolia yet ` +
        `(mint callback pending on source chain).`
      );
    }
    return "Callback was generated but has not completed on the source chain yet.";
  }

  return "PoD tracker returned no progress fields; request may still be queued.";
};

export const summarizeSdkConfig = (config: PodSdkConfig) =>
  config.chains.map(chain => ({
    chainId: chain.chainId,
    inboxAddress: chain.inboxAddress,
    rpcUrl: chain.rpcUrl,
  }));

let loggedSdkConfigSignature = "";

export const logPodTrackingDiagnostics = (params: {
  request: PodPortalRequest;
  tracking: RequestTrackingResponse;
  sdkConfig: PodSdkConfig;
  resolution: PodStatusResolution;
  resolvedMessage?: string;
  failedHex?: string;
}) => {
  const { request, tracking, sdkConfig, resolution, resolvedMessage, failedHex } = params;
  const serialized = serializeTrackingResponse(tracking);
  const pendingReason =
    resolution === "pod-pending" ? explainPodPendingReason(tracking, request.kind) : undefined;
  const explorerUrl = request.requestId
    ? buildPodExplorerRequestUrl(request.requestId, chainIdToExplorerSlug(request.chainId))
    : undefined;

  const configSignature = sdkConfig.chains
    .map(c => `${c.chainId}:${c.inboxAddress}`)
    .sort()
    .join("|");
  if (configSignature !== loggedSdkConfigSignature) {
    loggedSdkConfigSignature = configSignature;
    logger.log("[PoD][trackRequest] SDK inbox config (logged once per session)", {
      encryptionNetwork: sdkConfig.encryptionNetwork,
      chains: summarizeSdkConfig(sdkConfig),
    });
  }

  logger.log("[PoD][trackRequest] status resolution", {
    sourceTxHash: request.sourceTxHash,
    requestId: request.requestId,
    kind: request.kind,
    token: request.token,
    amount: request.amount,
    previousStatus: request.status,
    resolution,
    resolvedMessage,
    pendingReason,
    explorerUrl,
    failedHex: failedHex && failedHex !== "0x" ? failedHex : null,
    tracking: serialized,
    nextExpected:
      resolution === "pod-pending" && !tracking.minedOnTarget
        ? "target-mined (minedOnTarget=true on COTI inbox)"
        : resolution === "target-mined"
          ? "callback-generated (tracking.response populated)"
          : resolution === "callback-generated"
            ? "succeeded (tracking.response.minedOnTarget=true on Sepolia)"
            : undefined,
  });
};
