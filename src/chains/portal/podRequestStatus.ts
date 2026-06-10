import { ethers } from "ethers";
import { PodRequest, type RequestTrackingResponse } from "@coti/pod-sdk";
import { getPrivateTokensForChain, getRpcUrlForChain } from "../index";
import { CONTRACT_ADDRESSES } from "../../contracts/config";
import { POD_PTOKEN_ABI, PRIVACY_PORTAL_ABI, SEPOLIA_CHAIN_ID, type PodPortalRequest } from "../../contracts/pod";
import { getPodSdkConfig } from "./executePodPortalTransaction";

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
  if (!request.requestId) return "0x";
  const pToken = new ethers.Contract(pTokenAddress, POD_PTOKEN_ABI, provider);
  const failedRaw = await pToken.failedRequests(request.requestId).catch(() => "0x");
  return typeof failedRaw === "string" ? failedRaw : ethers.hexlify(failedRaw);
};

export async function resolvePodRequestStatus(request: PodPortalRequest) {
  if (!request.requestId || request.chainId !== SEPOLIA_CHAIN_ID) return null;

  const addresses = CONTRACT_ADDRESSES[SEPOLIA_CHAIN_ID];
  if (!addresses) return null;

  const rpcUrl = getRpcUrlForChain(SEPOLIA_CHAIN_ID);
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const sym = request.token.replace(/^p\./, "");
  const privCfg = getPrivateTokensForChain(SEPOLIA_CHAIN_ID).find(t => t.symbol === `p.${sym}`);
  const pTokenAddress = privCfg?.addressKey ? addresses[privCfg.addressKey] : undefined;
  const portalAddress = addresses.PrivacyPortalMTT;
  if (!pTokenAddress || !portalAddress) return null;

  const failedHex = await getFailedRequestHex(provider, request, pTokenAddress);
  if (failedHex !== "0x") {
    return {
      status: "callback-errored" as const,
      message: "PoD callback failed. Balance is untrusted until the callback is replayed.",
      refreshPrivateBalances: false,
    };
  }

  const tracker = new PodRequest(getPodSdkConfig());
  const tracking = await tracker.trackRequest(SEPOLIA_CHAIN_ID, request.requestId);

  if (hasPodExecutionError(tracking.execution)) {
    return {
      status: "failed" as const,
      message: tracking.execution?.errorMessage || "PoD request execution failed.",
      refreshPrivateBalances: false,
    };
  }

  if (request.kind === "deposit" && tracking.response?.minedOnTarget) {
    return {
      status: "succeeded" as const,
      message: "PoD mint callback completed on Sepolia.",
      refreshPrivateBalances: true,
    };
  }

  if (request.kind === "withdraw" && request.withdrawalId) {
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
      return {
        status: "succeeded" as const,
        message: "Withdraw released on Sepolia.",
        refreshPrivateBalances: true,
      };
    }
  }

  if (tracking.response) {
    return {
      status: "callback-generated" as const,
      message: "PoD callback was generated and is waiting to complete on Sepolia.",
      refreshPrivateBalances: false,
    };
  }

  if (tracking.minedOnTarget) {
    return {
      status: "target-mined" as const,
      message: "PoD request was mined on COTI and is waiting for callback generation.",
      refreshPrivateBalances: false,
    };
  }

  return null;
}
