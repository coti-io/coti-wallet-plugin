import { ethers } from "ethers";
import { type PodSdkConfig } from "@coti/pod-sdk";
import { COTI_TESTNET_CHAIN_ID, PRIVACY_PORTAL_ABI, POD_PTOKEN_ABI, SEPOLIA_CHAIN_ID, type PodPortalRequest } from "../../contracts/pod";
import type { SwapProgressStage } from "../../hooks/usePrivacyBridge";
import { getPluginConfig, type CotiPluginConfig } from "../../config/plugin";
import { logger } from "../../lib/logger";
import {
  diagnoseBlockingPodRequest,
  formatBlockingPodLogSummary,
  summarizeInFlightLocalPodRequests,
  type BlockingPodRequestDiagnostics,
} from "./podPTokenBlockingDiagnostics";
import { AVALANCHE_FUJI_CHAIN_ID, getChainConfig, getRpcUrlForChain } from "../index";

/** Source/target chains registered for PoD portal cross-chain tracking. */
const POD_TRACKING_CHAIN_ORDER = [
  SEPOLIA_CHAIN_ID,
  AVALANCHE_FUJI_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
] as const;

export type PortalDepositFeeQuote = {
  portalFee: bigint;
  usedDynamicPricing: boolean;
  mintTotalFee: bigint;
  mintCallbackFee: bigint;
  msgValue: bigint;
  gasPrice: bigint;
};

export type PortalWithdrawFeeQuote = {
  portalFee: bigint;
  usedDynamicPricing: boolean;
  transferTotalFee: bigint;
  transferCallbackFee: bigint;
  msgValue: bigint;
  gasPrice: bigint;
};

const resolveFeeRunnerProvider = (runner: ethers.ContractRunner): ethers.BrowserProvider =>
  "provider" in runner && runner.provider
    ? runner.provider as ethers.BrowserProvider
    : runner as ethers.BrowserProvider;

export const quotePortalDepositFees = async (
  runner: ethers.ContractRunner,
  portalAddress: string,
  amount: bigint,
  gasPrice?: bigint,
): Promise<PortalDepositFeeQuote> => {
  const provider = resolveFeeRunnerProvider(runner);
  const resolvedGasPrice = gasPrice ?? await getSepoliaGasPrice(provider);
  const portal = new ethers.Contract(portalAddress, PRIVACY_PORTAL_ABI, runner);
  const [portalFee, usedDynamicPricing, mintTotalFee, mintCallbackFee] = await portal.estimateDepositFees(amount);
  const portalFeeWei = BigInt(portalFee.toString());
  const mintTotalFeeWei = BigInt(mintTotalFee.toString());
  return {
    portalFee: portalFeeWei,
    usedDynamicPricing: Boolean(usedDynamicPricing),
    mintTotalFee: mintTotalFeeWei,
    mintCallbackFee: BigInt(mintCallbackFee.toString()),
    msgValue: portalFeeWei + mintTotalFeeWei,
    gasPrice: resolvedGasPrice,
  };
};

export const quotePortalWithdrawFees = async (
  runner: ethers.ContractRunner,
  portalAddress: string,
  amount: bigint,
  gasPrice?: bigint,
): Promise<PortalWithdrawFeeQuote> => {
  const provider = resolveFeeRunnerProvider(runner);
  const resolvedGasPrice = gasPrice ?? await getSepoliaGasPrice(provider);
  const portal = new ethers.Contract(portalAddress, PRIVACY_PORTAL_ABI, runner);
  const [portalFee, usedDynamicPricing, transferTotalFee, transferCallbackFee] =
    await portal.estimateWithdrawFees(amount);
  const portalFeeWei = BigInt(portalFee.toString());
  const transferTotalFeeWei = BigInt(transferTotalFee.toString());
  return {
    portalFee: portalFeeWei,
    usedDynamicPricing: Boolean(usedDynamicPricing),
    transferTotalFee: transferTotalFeeWei,
    transferCallbackFee: BigInt(transferCallbackFee.toString()),
    msgValue: portalFeeWei + transferTotalFeeWei,
    gasPrice: resolvedGasPrice,
  };
};

export const getPodInboxAddress = (chainId: number): string => {
  const inbox = getChainConfig(chainId)?.podInboxAddress?.trim();
  if (!inbox) {
    throw new Error(`PoD inbox address is not configured for chain ${chainId}`);
  }
  return inbox;
};

const resolvePodChainRpcUrl = (chainId: number, pluginConfig: CotiPluginConfig): string => {
  if (chainId === SEPOLIA_CHAIN_ID && pluginConfig.sepoliaRpcUrl) {
    return pluginConfig.sepoliaRpcUrl;
  }
  if (chainId === COTI_TESTNET_CHAIN_ID && pluginConfig.cotiTestnetRpcUrl) {
    return pluginConfig.cotiTestnetRpcUrl;
  }
  return getRpcUrlForChain(chainId);
};

export const getPodSdkConfig = (): PodSdkConfig => {
  const pluginConfig = getPluginConfig();
  return {
    encryptionNetwork: "testnet",
    chains: POD_TRACKING_CHAIN_ORDER.map(chainId => ({
      chainId,
      inboxAddress: getPodInboxAddress(chainId),
      rpcUrl: resolvePodChainRpcUrl(chainId, pluginConfig),
    })),
  };
};

/** @deprecated Use getPodSdkConfig() for fresh RPC URLs from plugin config. */
export const podSdkConfig: PodSdkConfig = getPodSdkConfig();

const getErrorMessage = (error: unknown) =>
  error && typeof error === "object" && "message" in error && typeof error.message === "string"
    ? error.message
    : "";

const pTokenErrorIface = new ethers.Interface(POD_PTOKEN_ABI);

const extractRevertData = (error: unknown): string | null => {
  if (!error || typeof error !== "object") return null;
  const err = error as Record<string, unknown>;
  const candidates = [
    err.data,
    (err.error as Record<string, unknown> | undefined)?.data,
    (err.info as { error?: { data?: unknown } } | undefined)?.error?.data,
  ];
  for (const raw of candidates) {
    if (typeof raw === "string" && raw.startsWith("0x")) return raw;
    if (raw && typeof raw === "object" && "data" in raw) {
      const nested = (raw as { data: unknown }).data;
      if (typeof nested === "string" && nested.startsWith("0x")) return nested;
    }
  }
  return null;
};

const parseTransferAlreadyPendingRevert = (
  error: unknown,
): { requestId: string } | null => {
  const revertData = extractRevertData(error);
  if (!revertData?.startsWith("0xbd8a45bc")) return null;
  try {
    const parsed = pTokenErrorIface.parseError(revertData);
    if (parsed?.name !== "TransferAlreadyPending") return null;
    const requestId = parsed.args[2];
    return typeof requestId === "string" ? { requestId } : null;
  } catch {
    return null;
  }
};

const pendingProbeFromRevert = (
  error: unknown,
  source: PodPTokenPendingSource,
  probeErrors: string[],
): PodPTokenPendingProbe | null => {
  const pendingRevert = parseTransferAlreadyPendingRevert(error);
  if (!pendingRevert) return null;
  return {
    pending: true,
    callbackErrored: false,
    source,
    probeErrors,
    pendingRequestId: pendingRevert.requestId,
    rawResponse: {
      transferAlreadyPending: true,
      requestId: pendingRevert.requestId,
    },
  };
};

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

const splitSignature = (signature: string) => {
  const parsed = ethers.Signature.from(signature);
  return { v: parsed.v, r: parsed.r, s: parsed.s };
};

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

export const getSepoliaGasPrice = async (provider: ethers.BrowserProvider | ethers.JsonRpcProvider) => {
  const gasPriceHex = await provider.send("eth_gasPrice", []);
  return BigInt(gasPriceHex);
};

/** @deprecated Use quotePortalDepositFees or quotePortalWithdrawFees for upgraded portal contracts. */
export const quotePortalPodRequest = quotePortalDepositFees;

/** Sepolia ERC-20 pTokens (e.g. p.MTT): flat 2-limb ciphertext + pending flag. */
const POD_PTOKEN_FLAT_STATUS_ABI = [
  "function balanceOfWithStatus(address account) view returns (tuple(uint256 ciphertextHigh, uint256 ciphertextLow),bool)",
] as const;

/** Native / WETH-style pTokens expose plain uint256 balances in status helpers. */
const POD_PTOKEN_PLAIN_STATUS_ABI = [
  "function balanceOfWithStatus(address account) view returns (uint256,bool)",
] as const;

type PodPTokenPendingSource =
  | "balanceWithState"
  | "flatBalanceOfWithStatus"
  | "balanceOfWithStatus"
  | "plainBalanceOfWithStatus";

type PodPTokenPendingProbe = {
  pending: boolean;
  callbackErrored: boolean;
  source: PodPTokenPendingSource;
  probeErrors: string[];
  /** Decoded from TransferAlreadyPending when the status view reverts instead of returning. */
  pendingRequestId?: string;
  /** Full contract return value from the successful status probe (JSON-safe). */
  rawResponse?: unknown;
};

const serializePodBalanceStatusResponse = (value: unknown): unknown => {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(serializePodBalanceStatusResponse);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializePodBalanceStatusResponse(entry)]),
    );
  }
  return value;
};

type EthersContractResult = Record<string | number, unknown>;

const readContractResultField = (result: EthersContractResult, name: string, index: number): unknown =>
  result[name] ?? result[index];

const buildBalanceWithStateRaw = (response: EthersContractResult) => ({
  balance: serializePodBalanceStatusResponse(readContractResultField(response, "balance", 0)),
  pending: readContractResultField(response, "pending", 1),
  callbackErrored: readContractResultField(response, "callbackErrored", 2),
});

const buildBalanceOfWithStatusRaw = (response: EthersContractResult) => ({
  balance: serializePodBalanceStatusResponse(
    readContractResultField(response, "balance", 0) ?? readContractResultField(response, "0", 0),
  ),
  pending: readContractResultField(response, "pending", 1) ?? readContractResultField(response, "1", 1),
});

const formatBalanceStatusRawForLog = (source: PodPTokenPendingSource, rawResponse: unknown): string | undefined => {
  if (rawResponse === undefined) return undefined;
  try {
    return JSON.stringify(rawResponse);
  } catch {
    return String(rawResponse);
  }
};

const logBalanceStatusRawResponse = (
  level: "debug" | "warn",
  source: PodPTokenPendingSource,
  rawResponse: unknown,
) => {
  const formatted = formatBalanceStatusRawForLog(source, rawResponse);
  if (!formatted) return;
  const message = `[PoD][pToken readiness] ${source} raw contract response: ${formatted}`;
  if (level === "warn") {
    logger.warn(message);
    return;
  }
  logger.debug(message);
};

type PodPTokenReadinessDebugContext = {
  portalAddress?: string;
  tokenSymbol?: string;
  chainId?: number;
  provider?: ethers.Provider | null;
};

const getContractProvider = (contract: ethers.Contract): ethers.Provider | null => {
  const runner = contract.runner;
  if (runner && typeof runner === "object" && "provider" in runner && runner.provider) {
    const provider = runner.provider as ethers.Provider;
    if (typeof provider.getBlockNumber === "function" && typeof provider.getLogs === "function") {
      return provider;
    }
  }
  return null;
};

const logPodPTokenReadinessProbe = async (
  pToken: ethers.Contract,
  account: string,
  pTokenAddress: string,
  action: "deposit" | "withdraw",
  probe: PodPTokenPendingProbe,
  debugContext?: PodPTokenReadinessDebugContext,
) => {
  logger.debug("[PoD][pToken readiness] on-chain probe", {
    action,
    account,
    pTokenAddress,
    pending: probe.pending,
    callbackErrored: probe.callbackErrored,
    source: probe.source,
    probeErrors: probe.probeErrors,
    balanceStatusRawResponse: probe.rawResponse,
    ...debugContext,
    inFlightLocalPodRequests: summarizeInFlightLocalPodRequests(account),
  });
  logBalanceStatusRawResponse("debug", probe.source, probe.rawResponse);
};

const logPodPTokenReadinessBlocked = async (
  pToken: ethers.Contract,
  account: string,
  pTokenAddress: string,
  action: "deposit" | "withdraw",
  probe: PodPTokenPendingProbe,
  reason: "pending" | "callback-errored",
  debugContext?: PodPTokenReadinessDebugContext,
) => {
  let diagnostics: BlockingPodRequestDiagnostics = {
    blockingRequest: null,
    candidateRequests: [],
    inFlightLocalPodRequests: summarizeInFlightLocalPodRequests(account),
  };

  try {
    diagnostics = await diagnoseBlockingPodRequest({
      account,
      pTokenAddress,
      blockedAction: action,
      portalAddress: debugContext?.portalAddress,
      tokenSymbol: debugContext?.tokenSymbol,
      chainId: debugContext?.chainId,
      provider: debugContext?.provider ?? getContractProvider(pToken),
      callbackErrored: reason === "callback-errored",
    });
  } catch (error) {
    logger.debug("[PoD][pToken readiness] blocking-request diagnostics failed", {
      action,
      account,
      pTokenAddress,
      error: getErrorMessage(error) || String(error),
    });
  }

  const { blockingRequest, candidateRequests, inFlightLocalPodRequests, eventScan } = diagnostics;
  const summary = formatBlockingPodLogSummary(blockingRequest, action);

  logger.warn(`[PoD][pToken readiness] ${summary}`);
  logBalanceStatusRawResponse("warn", probe.source, probe.rawResponse);
  logger.warn("[PoD][pToken readiness] blocked new request", {
    reason,
    action,
    account,
    pTokenAddress,
    balanceStatusRawResponse: probe.rawResponse,
    onChain: {
      pending: probe.pending,
      callbackErrored: probe.callbackErrored,
      source: probe.source,
      probeErrors: probe.probeErrors,
    },
    ...debugContext,
    blockingRequest,
    candidateRequests,
    inFlightLocalPodRequests,
    eventScan,
    hint:
      reason === "pending"
        ? blockingRequest?.requestId
          ? `Blocked by PoD request ${blockingRequest.requestId}. Wait for it to complete or inspect blockingRequest.explorerUrl.`
          : "The pToken contract reports an in-flight PoD callback for this wallet. Inspect candidateRequests / inFlightLocalPodRequests."
        : blockingRequest?.requestId
          ? `Blocked by failed PoD callback for request ${blockingRequest.requestId}. Replay the callback before trying again.`
          : "A prior PoD callback failed on-chain; replay the callback before depositing or withdrawing again.",
  });

  return diagnostics;
};

const resolveBlockingRequestId = (
  account: string,
  probe: PodPTokenPendingProbe,
  diagnostics: BlockingPodRequestDiagnostics,
): string | undefined =>
  probe.pendingRequestId
  ?? diagnostics.blockingRequest?.requestId
  ?? summarizeInFlightLocalPodRequests(account).find(entry => entry.requestId)?.requestId;

const readPodPTokenPendingState = async (
  pToken: ethers.Contract,
  account: string,
): Promise<PodPTokenPendingProbe> => {
  const probeErrors: string[] = [];
  const pTokenAddress = await pToken.getAddress();

  try {
    const response = await pToken.balanceWithState(account);
    const [, pending, callbackErrored] = response;
    return {
      pending: Boolean(pending),
      callbackErrored: Boolean(callbackErrored),
      source: "balanceWithState",
      probeErrors,
      rawResponse: buildBalanceWithStateRaw(response as EthersContractResult),
    };
  } catch (error) {
    const pendingFromRevert = pendingProbeFromRevert(error, "balanceWithState", probeErrors);
    if (pendingFromRevert) return pendingFromRevert;
    probeErrors.push(`balanceWithState: ${getErrorMessage(error) || String(error)}`);
  }

  const flatStatusToken = new ethers.Contract(
    pTokenAddress,
    POD_PTOKEN_FLAT_STATUS_ABI,
    pToken.runner as ethers.ContractRunner,
  );
  try {
    const response = await flatStatusToken.balanceOfWithStatus(account);
    const pending = readContractResultField(response as EthersContractResult, "pending", 1);
    return {
      pending: Boolean(pending),
      callbackErrored: false,
      source: "flatBalanceOfWithStatus",
      probeErrors,
      rawResponse: buildBalanceOfWithStatusRaw(response as EthersContractResult),
    };
  } catch (error) {
    const pendingFromRevert = pendingProbeFromRevert(error, "flatBalanceOfWithStatus", probeErrors);
    if (pendingFromRevert) return pendingFromRevert;
    probeErrors.push(`flatBalanceOfWithStatus: ${getErrorMessage(error) || String(error)}`);
  }

  try {
    const response = await pToken.balanceOfWithStatus(account);
    const pending = readContractResultField(response as EthersContractResult, "pending", 1);
    return {
      pending: Boolean(pending),
      callbackErrored: false,
      source: "balanceOfWithStatus",
      probeErrors,
      rawResponse: buildBalanceOfWithStatusRaw(response as EthersContractResult),
    };
  } catch (error) {
    const pendingFromRevert = pendingProbeFromRevert(error, "balanceOfWithStatus", probeErrors);
    if (pendingFromRevert) return pendingFromRevert;
    probeErrors.push(`balanceOfWithStatus: ${getErrorMessage(error) || String(error)}`);
  }

  const plainToken = new ethers.Contract(
    pTokenAddress,
    POD_PTOKEN_PLAIN_STATUS_ABI,
    pToken.runner as ethers.ContractRunner,
  );
  try {
    const response = await plainToken.balanceOfWithStatus(account);
    const pending = readContractResultField(response as EthersContractResult, "pending", 1);
    return {
      pending: Boolean(pending),
      callbackErrored: false,
      source: "plainBalanceOfWithStatus",
      probeErrors,
      rawResponse: buildBalanceOfWithStatusRaw(response as EthersContractResult),
    };
  } catch (error) {
    const pendingFromRevert = pendingProbeFromRevert(error, "plainBalanceOfWithStatus", probeErrors);
    if (pendingFromRevert) return pendingFromRevert;
    throw error;
  }
};

const assertPodPTokenReady = async (
  pToken: ethers.Contract,
  account: string,
  action: "deposit" | "withdraw",
  debugContext?: PodPTokenReadinessDebugContext,
) => {
  const pTokenAddress = await pToken.getAddress();
  let probe: PodPTokenPendingProbe;

  try {
    probe = await readPodPTokenPendingState(pToken, account);
  } catch (stateError: unknown) {
    const message = getErrorMessage(stateError);
    logger.warn("[PoD][pToken readiness] could not verify on-chain state", {
      action,
      account,
      pTokenAddress,
      ...debugContext,
      error: message || String(stateError),
      inFlightLocalPodRequests: summarizeInFlightLocalPodRequests(account),
    });
    throw new Error("Could not verify the pToken request state. Please refresh and try again.");
  }

  await logPodPTokenReadinessProbe(pToken, account, pTokenAddress, action, probe, debugContext);

  if (probe.callbackErrored) {
    const diagnostics = await logPodPTokenReadinessBlocked(pToken, account, pTokenAddress, action, probe, "callback-errored", debugContext);
    const blockingRequestId = resolveBlockingRequestId(account, probe, diagnostics);
    throw new Error(
      blockingRequestId
        ? `This pToken balance is untrusted because PoD callback failed for request ${blockingRequestId}. Replay the callback before using this token.`
        : "This pToken balance is untrusted because a previous PoD callback failed. Replay the callback before using this token.",
    );
  }

  if (probe.pending) {
    const diagnostics = await logPodPTokenReadinessBlocked(pToken, account, pTokenAddress, action, probe, "pending", debugContext);
    const blockingRequestId = resolveBlockingRequestId(account, probe, diagnostics);
    throw new Error(
      blockingRequestId
        ? `A PoD request is already pending for this wallet (request ${blockingRequestId}). Wait for it to complete before starting another ${action}.`
        : `A PoD request is already pending for this wallet. Wait for it to complete before starting another ${action}.`,
    );
  }
};

export async function signPodWithdrawPermit(params: {
  signer: ethers.JsonRpcSigner;
  pTokenAddress: string;
  portalAddress: string;
  amountWei: bigint;
  deadline?: bigint;
  chainId?: number;
  tokenSymbol?: string;
}): Promise<PodWithdrawPermit> {
  const { signer, pTokenAddress, portalAddress, amountWei } = params;
  const wallet = await signer.getAddress();
  const pToken = new ethers.Contract(pTokenAddress, POD_PTOKEN_ABI, signer);
  const signingChainId = params.chainId ?? Number((await signer.provider!.getNetwork()).chainId);
  const resolvedTokenSymbol = params.tokenSymbol ?? await pToken.symbol().catch(() => undefined);

  await assertPodPTokenReady(pToken, wallet, "withdraw", {
    portalAddress,
    chainId: signingChainId,
    tokenSymbol: resolvedTokenSymbol,
    provider: signer.provider ?? null,
  });

  const name = await pToken.name();
  const nonce = await pToken.nonces(wallet);
  const deadline = params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 60 * 30);
  const signature = await signer.signTypedData(
    {
      name,
      version: "1",
      chainId: signingChainId,
      verifyingContract: pTokenAddress,
    },
    {
      TransferPermit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    {
      owner: wallet,
      spender: portalAddress,
      to: portalAddress,
      value: amountWei,
      nonce,
      deadline,
    },
  );
  const { v, r, s } = splitSignature(signature);

  return {
    wallet,
    pTokenAddress,
    portalAddress,
    amountWei: amountWei.toString(),
    deadline: deadline.toString(),
    v,
    r,
    s,
  };
}

export async function executePodPortalTransaction(params: {
  txAmount: string;
  txDirection: "to-private" | "to-public";
  signer: ethers.JsonRpcSigner;
  provider: ethers.BrowserProvider;
  portalAddress: string;
  underlyingAddress: string;
  pTokenAddress: string;
  tokenSymbol: string;
  decimals: number;
  chainId?: number;
  isNativeDeposit?: boolean;
  withdrawPermit?: PodWithdrawPermit;
  onProgress?: (stage: SwapProgressStage, txHash?: string) => void;
}): Promise<{ txHash: string; request: PodPortalRequest; receipt: ethers.TransactionReceipt }> {
  const {
    txAmount,
    txDirection,
    signer,
    provider,
    portalAddress,
    underlyingAddress,
    pTokenAddress,
    tokenSymbol,
    decimals,
    chainId = SEPOLIA_CHAIN_ID,
    isNativeDeposit = false,
    withdrawPermit,
    onProgress,
  } = params;

  if (!portalAddress || !underlyingAddress || !pTokenAddress) {
    throw new Error("PoD portal is not configured for this token");
  }

  const wallet = await signer.getAddress();
  const amountWei = ethers.parseUnits(txAmount, decimals);
  const portal = new ethers.Contract(portalAddress, PRIVACY_PORTAL_ABI, signer);
  const pToken = new ethers.Contract(pTokenAddress, POD_PTOKEN_ABI, signer);
  const portalIface = new ethers.Interface(PRIVACY_PORTAL_ABI);

  if (txDirection === "to-private") {
    await assertPodPTokenReady(pToken, wallet, "deposit", {
      portalAddress,
      tokenSymbol,
      chainId,
      provider: provider ?? signer.provider ?? null,
    });

    const depositMethod = isNativeDeposit ? "depositNative" : "deposit";
    const quote = await quotePortalDepositFees(signer, portalAddress, amountWei, undefined);
    const depositValue = isNativeDeposit ? amountWei + quote.msgValue : quote.msgValue;
    const depositArgs = [wallet, amountWei, quote.portalFee, quote.mintCallbackFee] as const;
    const depositOverrides: { value: bigint; gasPrice: bigint; gasLimit?: bigint } = {
      value: depositValue,
      gasPrice: quote.gasPrice,
    };
    try {
      const estimated = await portal[depositMethod].estimateGas(
        ...depositArgs, depositOverrides,
      );
      depositOverrides.gasLimit = (estimated * 130n) / 100n;
    } catch (estErr: unknown) {
      // Estimation reverting means the tx would fail — but aborting here leaves the
      // user with no tx hash to inspect. Broadcast with a fixed limit instead so the
      // revert lands on-chain and the explorer link can show the actual reason.
      logger.warn(
        `⚠️ PoD ${depositMethod} gas estimation reverted — broadcasting with fallback gas limit so the revert is inspectable on-chain`,
        (estErr as Error)?.message,
      );
      depositOverrides.gasLimit = 2_000_000n;
    }
    const tx = await portal[depositMethod](...depositArgs, depositOverrides);

    onProgress?.("transfer-start", tx.hash);

    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      const failed = new Error("PoD deposit transaction failed") as Error & { txHash?: string };
      failed.txHash = tx.hash;
      throw failed;
    }

    const event = findParsedEvent(receipt, portalIface, "DepositRequested");
    const requestId = event?.args?.mintRequestId as string | undefined;

    return {
      txHash: tx.hash,
      receipt,
      request: {
        id: tx.hash,
        kind: "deposit",
        chainId,
        sourceTxHash: tx.hash,
        requestId,
        wallet,
        token: tokenSymbol,
        amount: txAmount,
        status: "source-mined",
        message: requestId ? "PoD mint request submitted." : "Source transaction mined; request id not found.",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        fromBlock: receipt.blockNumber,
      },
    };
  }

  await assertPodPTokenReady(pToken, wallet, "withdraw", {
    portalAddress,
    tokenSymbol,
    chainId,
    provider: provider ?? signer.provider ?? null,
  });

  const sharedGasPrice = await getSepoliaGasPrice(provider);
  if (
    !withdrawPermit ||
    withdrawPermit.wallet.toLowerCase() !== wallet.toLowerCase() ||
    withdrawPermit.pTokenAddress.toLowerCase() !== pTokenAddress.toLowerCase() ||
    withdrawPermit.portalAddress.toLowerCase() !== portalAddress.toLowerCase() ||
    withdrawPermit.amountWei !== amountWei.toString()
  ) {
    throw new Error("PoD withdraw approval signature is missing or stale. Please approve again.");
  }
  const deadline = BigInt(withdrawPermit.deadline);
  const withdrawQuote = await quotePortalWithdrawFees(
    signer,
    portalAddress,
    amountWei,
    sharedGasPrice,
  );
  const withdrawArgs = [
    wallet,
    amountWei,
    withdrawQuote.portalFee,
    withdrawQuote.transferTotalFee,
    withdrawQuote.transferCallbackFee,
    deadline,
    withdrawPermit.v,
    withdrawPermit.r,
    withdrawPermit.s,
  ] as const;
  const withdrawOverrides: { value: bigint; gasPrice: bigint; gasLimit?: bigint } = {
    value: withdrawQuote.msgValue,
    gasPrice: sharedGasPrice,
  };
  try {
    const estimated = await portal.requestWithdrawWithPermit.estimateGas(
      ...withdrawArgs, withdrawOverrides,
    );
    withdrawOverrides.gasLimit = (estimated * 130n) / 100n;
  } catch (estErr: unknown) {
    // Estimation reverting means the tx would fail — but aborting here leaves the
    // user with no tx hash to inspect. Broadcast with a fixed limit instead so the
    // revert lands on-chain and the explorer link can show the actual reason.
    logger.warn(
      "⚠️ PoD withdraw gas estimation reverted — broadcasting with fallback gas limit so the revert is inspectable on-chain",
      (estErr as Error)?.message,
    );
    withdrawOverrides.gasLimit = 3_000_000n;
  }
  const tx = await portal.requestWithdrawWithPermit(...withdrawArgs, withdrawOverrides);

  onProgress?.("transfer-start", tx.hash);

  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    const failed = new Error("Sepolia withdraw transaction failed") as Error & { txHash?: string };
    failed.txHash = tx.hash;
    throw failed;
  }

  const event = findParsedEvent(receipt, portalIface, "WithdrawalRequested");
  return {
    txHash: tx.hash,
    receipt,
    request: {
      id: tx.hash,
      kind: "withdraw",
      chainId,
      sourceTxHash: tx.hash,
      requestId: event?.args?.transferRequestId as string | undefined,
      withdrawalId: event?.args?.withdrawalId as string | undefined,
      wallet,
      token: tokenSymbol,
      amount: txAmount,
      status: "source-mined",
      message: "PoD withdraw request submitted.",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      fromBlock: receipt.blockNumber,
    },
  };
}
