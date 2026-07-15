import { ethers } from "ethers";
import { PodRequest } from "@coti-io/pod-sdk";
import {
  COTI_TESTNET_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  buildPodExplorerRequestUrl,
  POD_PTOKEN_ABI,
  PRIVACY_PORTAL_ABI,
  type PodPortalRequest,
} from "../../contracts/pod";
import { loadPodRequests } from "../../pod/podPortalRequestsStorage";
import { AVALANCHE_FUJI_CHAIN_ID } from "../index";
import type { PodSdkConfig } from "@coti-io/pod-sdk";

const TERMINAL_POD_REQUEST_STATUSES = new Set<PodPortalRequest["status"]>([
  "succeeded",
  "failed",
  "callback-errored",
  "burn-debt",
]);

const pTokenIface = new ethers.Interface(POD_PTOKEN_ABI);
const portalIface = new ethers.Interface(PRIVACY_PORTAL_ABI);

export type BlockingPodRequestCandidate = {
  source: "local-storage" | "pToken-transfer-event" | "portal-deposit-event" | "portal-withdraw-event" | "pToken-callback-failed-event";
  confidence: "high" | "medium" | "low";
  kind?: PodPortalRequest["kind"];
  requestId?: string;
  withdrawalId?: string;
  sourceTxHash?: string;
  status?: PodPortalRequest["status"];
  token?: string;
  amount?: string;
  chainId?: number;
  blockNumber?: number;
  explorerUrl?: string;
  podTracking?: {
    minedOnTarget: boolean;
    hasResponse: boolean;
    responseMinedOnTarget: boolean;
    executionError?: string;
    stillInFlight: boolean;
  };
};

export type BlockingPodRequestDiagnostics = {
  blockingRequest: BlockingPodRequestCandidate | null;
  candidateRequests: BlockingPodRequestCandidate[];
  inFlightLocalPodRequests: ReturnType<typeof summarizeInFlightLocalPodRequests>;
  eventScan?: {
    providerAvailable: boolean;
    lookbackBlocks: number;
    portalDeposits: number;
    portalWithdraws: number;
    pTokenTransfers: number;
    pTokenCallbackFailures: number;
    errors: string[];
  };
};

export const formatBlockingPodLogSummary = (
  blockingRequest: BlockingPodRequestCandidate | null,
  action: "deposit" | "withdraw" | "transfer",
) => {
  if (!blockingRequest?.requestId) {
    return `PoD ${action} blocked: wallet has on-chain pending=true but no requestId was resolved (check eventScan / candidateRequests in the log object below).`;
  }

  const parts = [
    `PoD ${action} blocked by request ${blockingRequest.requestId}`,
    blockingRequest.kind ? `kind=${blockingRequest.kind}` : null,
    blockingRequest.source ? `source=${blockingRequest.source}` : null,
    blockingRequest.token ? `token=${blockingRequest.token}` : null,
    blockingRequest.amount ? `amount=${blockingRequest.amount}` : null,
    blockingRequest.withdrawalId ? `withdrawalId=${blockingRequest.withdrawalId}` : null,
    blockingRequest.sourceTxHash ? `sourceTx=${blockingRequest.sourceTxHash}` : null,
    blockingRequest.explorerUrl ? `explorer=${blockingRequest.explorerUrl}` : null,
  ].filter(Boolean);

  return parts.join(" | ");
};

const chainIdToExplorerSlug = (chainId: number) => {
  if (chainId === SEPOLIA_CHAIN_ID) return "sepolia";
  if (chainId === COTI_TESTNET_CHAIN_ID) return "coti";
  if (chainId === AVALANCHE_FUJI_CHAIN_ID) return "fuji";
  return String(chainId);
};

const withExplorerUrl = (candidate: BlockingPodRequestCandidate): BlockingPodRequestCandidate => {
  if (!candidate.requestId || !candidate.chainId) return candidate;
  return {
    ...candidate,
    explorerUrl: buildPodExplorerRequestUrl(
      candidate.requestId,
      chainIdToExplorerSlug(candidate.chainId),
    ),
  };
};

const tokenMatchesContext = (requestToken: string | undefined, tokenSymbol: string | undefined) => {
  if (!tokenSymbol || !requestToken) return true;
  const normalizedContext = tokenSymbol.replace(/^p\./, "");
  const normalizedRequest = requestToken.replace(/^p\./, "");
  return normalizedContext === normalizedRequest;
};

export const summarizeInFlightLocalPodRequests = (wallet: string) => {
  const merged = [...loadPodRequests(wallet), ...loadPodRequests("")];
  const seen = new Set<string>();

  return merged
    .filter(request => !TERMINAL_POD_REQUEST_STATUSES.has(request.status))
    .filter(request => {
      if (seen.has(request.id)) return false;
      seen.add(request.id);
      return true;
    })
    .map(request => ({
      id: request.id,
      kind: request.kind,
      status: request.status,
      requestId: request.requestId,
      withdrawalId: request.withdrawalId,
      token: request.token,
      amount: request.amount,
      chainId: request.chainId,
      sourceTxHash: request.sourceTxHash,
      message: request.message,
      updatedAt: request.updatedAt,
    }));
};

const summarizeLocalCandidates = (
  wallet: string,
  chainId?: number,
  tokenSymbol?: string,
): BlockingPodRequestCandidate[] => {
  const merged = [...loadPodRequests(wallet), ...loadPodRequests("")];
  const seen = new Set<string>();

  return merged
    .filter(request => !TERMINAL_POD_REQUEST_STATUSES.has(request.status))
    .filter(request => {
      if (seen.has(request.id)) return false;
      seen.add(request.id);
      return true;
    })
    .filter(request => (chainId === undefined ? true : request.chainId === chainId))
    .filter(request => tokenMatchesContext(request.token, tokenSymbol))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(request => withExplorerUrl({
      source: "local-storage",
      confidence: request.requestId ? "high" : "medium",
      kind: request.kind,
      requestId: request.requestId,
      withdrawalId: request.withdrawalId,
      sourceTxHash: request.sourceTxHash,
      status: request.status,
      token: request.token,
      amount: request.amount,
      chainId: request.chainId,
    }));
};

const isPodRequestStillInFlight = (
  kind: PodPortalRequest["kind"] | undefined,
  tracking: Awaited<ReturnType<PodRequest["trackRequest"]>>,
) => {
  if (tracking.execution?.errorCode && BigInt(tracking.execution.errorCode) !== 0n) {
    return false;
  }
  if (kind === "deposit" || kind === "transfer") {
    return !tracking.response?.minedOnTarget;
  }
  if (kind === "withdraw") {
    return !tracking.response?.minedOnTarget;
  }
  return !tracking.minedOnTarget || !tracking.response?.minedOnTarget;
};

const enrichWithPodTracking = async (
  candidate: BlockingPodRequestCandidate,
): Promise<BlockingPodRequestCandidate> => {
  if (!candidate.requestId || !candidate.chainId) return candidate;

  try {
    const { getPodSdkConfig } = await import("./podSdkConfig");
    const tracker = new PodRequest(getPodSdkConfig() as PodSdkConfig);
    const tracking = await tracker.trackRequest(candidate.chainId, candidate.requestId);
    const stillInFlight = isPodRequestStillInFlight(candidate.kind, tracking);
    return {
      ...candidate,
      confidence: stillInFlight ? "high" : "low",
      podTracking: {
        minedOnTarget: tracking.minedOnTarget,
        hasResponse: tracking.response !== null,
        responseMinedOnTarget: tracking.response?.minedOnTarget ?? false,
        executionError: tracking.execution?.errorMessage,
        stillInFlight,
      },
    };
  } catch {
    return candidate;
  }
};

const POD_EVENT_LOOKBACK_STEPS = [10_000n, 50_000n, 100_000n] as const;

const fetchLogsWithLookback = async (
  provider: ethers.Provider,
  query: ethers.Filter,
  lookbackSteps: readonly bigint[] = POD_EVENT_LOOKBACK_STEPS,
) => {
  const latest = BigInt(await provider.getBlockNumber());
  const errors: string[] = [];

  for (const lookback of lookbackSteps) {
    const fromBlock = latest > lookback ? latest - lookback : 0n;
    try {
      const logs = await provider.getLogs({ ...query, fromBlock, toBlock: latest });
      return { logs, lookbackBlocks: Number(lookback), errors };
    } catch (error) {
      errors.push(`${lookback} blocks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { logs: [] as ethers.Log[], lookbackBlocks: Number(lookbackSteps[lookbackSteps.length - 1]), errors };
};

const paddedAddressTopic = (address: string) =>
  ethers.zeroPadValue(ethers.getAddress(address), 32);

const fetchRecentPTokenEvents = async (
  provider: ethers.Provider,
  pTokenAddress: string,
  account: string,
): Promise<{ candidates: BlockingPodRequestCandidate[]; errors: string[]; lookbackBlocks: number }> => {
  const accountTopic = paddedAddressTopic(account);
  const errors: string[] = [];

  const [transferFrom, transferTo, callbackFailed] = await Promise.all([
    fetchLogsWithLookback(provider, {
      address: pTokenAddress,
      topics: [pTokenIface.getEvent("TransferRequestSubmitted")!.topicHash, accountTopic],
    }),
    fetchLogsWithLookback(provider, {
      address: pTokenAddress,
      topics: [pTokenIface.getEvent("TransferRequestSubmitted")!.topicHash, null, accountTopic],
    }),
    fetchLogsWithLookback(provider, {
      address: pTokenAddress,
      topics: [pTokenIface.getEvent("RequestCallbackFailed")!.topicHash, accountTopic],
    }),
  ]);

  errors.push(...transferFrom.errors, ...transferTo.errors, ...callbackFailed.errors);
  const lookbackBlocks = Math.max(
    transferFrom.lookbackBlocks,
    transferTo.lookbackBlocks,
    callbackFailed.lookbackBlocks,
  );

  const transferLogs = [...transferFrom.logs, ...transferTo.logs]
    .sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber));

  const transferCandidates = transferLogs.map(log => {
    const parsed = pTokenIface.parseLog({ topics: log.topics as string[], data: log.data });
    return withExplorerUrl({
      source: "pToken-transfer-event",
      confidence: "medium",
                  kind: "transfer",
                  requestId: parsed?.args?.requestId as string | undefined,
      blockNumber: log.blockNumber,
      sourceTxHash: log.transactionHash,
    });
  });

  const callbackCandidates = callbackFailed.logs.map(log => {
    const parsed = pTokenIface.parseLog({ topics: log.topics as string[], data: log.data });
    return withExplorerUrl({
      source: "pToken-callback-failed-event",
      confidence: "high",
      requestId: parsed?.args?.requestId as string | undefined,
      blockNumber: log.blockNumber,
      sourceTxHash: log.transactionHash,
    });
  });

  return {
    candidates: [...callbackCandidates, ...transferCandidates],
    errors,
    lookbackBlocks,
  };
};

const fetchRecentPortalEvents = async (
  provider: ethers.Provider,
  portalAddress: string,
  account: string,
  chainId: number,
): Promise<{ candidates: BlockingPodRequestCandidate[]; errors: string[]; lookbackBlocks: number }> => {
  const accountTopic = paddedAddressTopic(account);
  const errors: string[] = [];

  const [depositScan, withdrawScan] = await Promise.all([
    fetchLogsWithLookback(provider, {
      address: portalAddress,
      topics: [portalIface.getEvent("DepositRequested")!.topicHash, accountTopic],
    }),
    fetchLogsWithLookback(provider, {
      address: portalAddress,
      topics: [portalIface.getEvent("WithdrawalRequested")!.topicHash, null, accountTopic],
    }),
  ]);

  errors.push(...depositScan.errors, ...withdrawScan.errors);
  const lookbackBlocks = Math.max(depositScan.lookbackBlocks, withdrawScan.lookbackBlocks);

  const depositCandidates = depositScan.logs.map(log => {
    const parsed = portalIface.parseLog({ topics: log.topics as string[], data: log.data });
    return withExplorerUrl({
      source: "portal-deposit-event",
      confidence: "medium",
      kind: "deposit",
      requestId: parsed?.args?.mintRequestId as string | undefined,
      amount: parsed?.args?.amount?.toString(),
      chainId,
      blockNumber: log.blockNumber,
      sourceTxHash: log.transactionHash,
    });
  });

  const withdrawCandidates = withdrawScan.logs.map(log => {
    const parsed = portalIface.parseLog({ topics: log.topics as string[], data: log.data });
    return withExplorerUrl({
      source: "portal-withdraw-event",
      confidence: "medium",
      kind: "withdraw",
      requestId: parsed?.args?.transferRequestId as string | undefined,
      withdrawalId: parsed?.args?.withdrawalId as string | undefined,
      amount: parsed?.args?.amount?.toString(),
      chainId,
      blockNumber: log.blockNumber,
      sourceTxHash: log.transactionHash,
    });
  });

  return {
    candidates: [...depositCandidates, ...withdrawCandidates]
      .sort((a, b) => (b.blockNumber ?? 0) - (a.blockNumber ?? 0)),
    errors,
    lookbackBlocks,
  };
};

const dedupeCandidates = (candidates: BlockingPodRequestCandidate[]) => {
  const seen = new Set<string>();
  return candidates.filter(candidate => {
    const key = [
      candidate.requestId ?? "",
      candidate.withdrawalId ?? "",
      candidate.sourceTxHash ?? "",
      candidate.source,
    ].join(":");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const pickBlockingRequest = (
  candidates: BlockingPodRequestCandidate[],
  blockedAction: "deposit" | "withdraw" | "transfer",
): BlockingPodRequestCandidate | null => {
  if (candidates.length === 0) return null;

  const localMatches = candidates
    .filter(candidate => candidate.source === "local-storage" && candidate.requestId)
    .sort((a, b) => (b.chainId ?? 0) - (a.chainId ?? 0));
  if (localMatches[0]) return localMatches[0];

  const stillInFlight = candidates.filter(candidate => candidate.podTracking?.stillInFlight !== false);
  const pool = stillInFlight.length > 0 ? stillInFlight : candidates;

  const callbackFailure = pool.find(candidate => candidate.source === "pToken-callback-failed-event");
  if (callbackFailure) return callbackFailure;

  const actionKind = blockedAction;
  const actionMatch = pool
    .filter(candidate => candidate.kind === actionKind && candidate.requestId)
    .sort((a, b) => (b.blockNumber ?? 0) - (a.blockNumber ?? 0))[0];
  if (actionMatch) return actionMatch;

  return pool
    .filter(candidate => candidate.requestId)
    .sort((a, b) => (b.blockNumber ?? 0) - (a.blockNumber ?? 0))[0] ?? pool[0] ?? null;
};

export async function diagnoseBlockingPodRequest(params: {
  account: string;
  pTokenAddress: string;
  blockedAction: "deposit" | "withdraw" | "transfer";
  portalAddress?: string;
  tokenSymbol?: string;
  chainId?: number;
  provider?: ethers.Provider | null;
  callbackErrored?: boolean;
}): Promise<BlockingPodRequestDiagnostics> {
  const {
    account,
    pTokenAddress,
    blockedAction,
    portalAddress,
    tokenSymbol,
    chainId,
    provider,
    callbackErrored = false,
  } = params;

  const inFlightLocalPodRequests = summarizeInFlightLocalPodRequests(account);
  let candidates = summarizeLocalCandidates(account, chainId, tokenSymbol);
  const eventScan: BlockingPodRequestDiagnostics["eventScan"] = {
    providerAvailable: !!provider,
    lookbackBlocks: 0,
    portalDeposits: 0,
    portalWithdraws: 0,
    pTokenTransfers: 0,
    pTokenCallbackFailures: 0,
    errors: [],
  };

  if (provider) {
    const pTokenScan = await fetchRecentPTokenEvents(provider, pTokenAddress, account);
    eventScan.errors.push(...pTokenScan.errors);
    eventScan.lookbackBlocks = Math.max(eventScan.lookbackBlocks, pTokenScan.lookbackBlocks);
    eventScan.pTokenTransfers = pTokenScan.candidates.filter(candidate => candidate.source === "pToken-transfer-event").length;
    eventScan.pTokenCallbackFailures = pTokenScan.candidates.filter(candidate => candidate.source === "pToken-callback-failed-event").length;

    const onChainCandidates = pTokenScan.candidates.map(event => withExplorerUrl({
      ...event,
      chainId: chainId ?? event.chainId,
    }));

    candidates = dedupeCandidates([...candidates, ...onChainCandidates]);

    if (portalAddress && chainId !== undefined) {
      const portalScan = await fetchRecentPortalEvents(provider, portalAddress, account, chainId);
      eventScan.errors.push(...portalScan.errors);
      eventScan.lookbackBlocks = Math.max(eventScan.lookbackBlocks, portalScan.lookbackBlocks);
      eventScan.portalDeposits = portalScan.candidates.filter(candidate => candidate.source === "portal-deposit-event").length;
      eventScan.portalWithdraws = portalScan.candidates.filter(candidate => candidate.source === "portal-withdraw-event").length;
      candidates = dedupeCandidates([...candidates, ...portalScan.candidates]);
    }
  }

  const enrichedCandidates = provider
    ? await Promise.all(
        candidates
          .filter(candidate => candidate.requestId && candidate.chainId !== undefined)
          .map(candidate => enrichWithPodTracking(candidate).catch(() => candidate)),
      )
    : [];

  const enrichedByKey = new Map(
    enrichedCandidates.map(candidate => [
      `${candidate.requestId}:${candidate.source}`,
      candidate,
    ]),
  );

  candidates = candidates.map(candidate => {
    const enriched = enrichedByKey.get(`${candidate.requestId}:${candidate.source}`);
    return enriched ?? candidate;
  });

  if (callbackErrored) {
    candidates = candidates.map(candidate =>
      candidate.source === "pToken-callback-failed-event"
        ? { ...candidate, confidence: "high" as const }
        : candidate,
    );
  }

  const blockingRequest = pickBlockingRequest(candidates, blockedAction);

  return {
    blockingRequest,
    candidateRequests: candidates,
    inFlightLocalPodRequests,
    eventScan,
  };
}
