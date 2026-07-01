import { ethers } from "ethers";
import { DataType, PodContract, type PodSdkConfig } from "@coti/pod-sdk";
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
import {
  getChainConfig,
  getPodTrackingChainIds,
  getRpcUrlForChain,
} from "../index";
import { resolveCotiSnapEnvironment } from "../resolveTargetCotiChainId";

const POD_CALLBACK_GAS_LIMIT = 1_000_000n;
const POD_CALLBACK_DATA_SIZE = 1_024n;
const POD_FORWARD_GAS_LIMIT = 8_000_000n;
const POD_FORWARD_DATA_SIZE = 4_096n;
const POD_REMOTE_FEE_BUFFER_BPS = 20_000n;

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

export const getPodSdkConfig = (hostChainId?: number): PodSdkConfig => {
  const pluginConfig = getPluginConfig();
  return {
    encryptionNetwork: hostChainId != null ? resolveCotiSnapEnvironment(hostChainId) : "testnet",
    chains: getPodTrackingChainIds().map(chainId => ({
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

export const quotePortalPodRequest = async (
  runner: ethers.ContractRunner,
  portalAddress: string,
  method: "deposit" | "depositNative" | "requestWithdrawWithPermit",
  args: Array<{ value: string; isCallBackFee?: boolean }>,
  gasPrice?: bigint,
  chainId = SEPOLIA_CHAIN_ID,
) => {
  const provider = "provider" in runner && runner.provider
    ? runner.provider as ethers.BrowserProvider
    : runner as ethers.BrowserProvider;
  const resolvedGasPrice = gasPrice ?? await getSepoliaGasPrice(provider);
  const encryptionNetwork = resolveCotiSnapEnvironment(chainId);
  const podContract = new PodContract(portalAddress, PRIVACY_PORTAL_ABI, runner, {
    config: getPodSdkConfig(chainId),
    inboxAddress: getPodInboxAddress(chainId),
    encryptionNetwork,
  });
  const fee = await podContract.estimateFee(
    method,
    args.map(arg => ({
      type: DataType.String,
      value: arg.value,
      isCallBackFee: !!arg.isCallBackFee,
    })),
    {
      forwardDataSize: POD_FORWARD_DATA_SIZE,
      forwardGasLimit: POD_FORWARD_GAS_LIMIT,
      gasPrice: resolvedGasPrice,
      callBackGasLimit: POD_CALLBACK_GAS_LIMIT,
      callBackDataSize: POD_CALLBACK_DATA_SIZE,
    },
  );

  const bufferedRemoteFee = (fee.remoteFee * POD_REMOTE_FEE_BUFFER_BPS) / 10_000n;

  return {
    totalFeeWei: bufferedRemoteFee + fee.callBackFee,
    remoteFeeWei: bufferedRemoteFee,
    callbackFeeWei: fee.callBackFee,
    gasPrice: resolvedGasPrice,
  };
};

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
    probeErrors.push(`balanceOfWithStatus: ${getErrorMessage(error) || String(error)}`);
  }

  const plainToken = new ethers.Contract(
    pTokenAddress,
    POD_PTOKEN_PLAIN_STATUS_ABI,
    pToken.runner as ethers.ContractRunner,
  );
  const response = await plainToken.balanceOfWithStatus(account);
  const pending = readContractResultField(response as EthersContractResult, "pending", 1);
  return {
    pending: Boolean(pending),
    callbackErrored: false,
    source: "plainBalanceOfWithStatus",
    probeErrors,
    rawResponse: buildBalanceOfWithStatusRaw(response as EthersContractResult),
  };
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
    const blockingRequestId = diagnostics.blockingRequest?.requestId;
    throw new Error(
      blockingRequestId
        ? `This pToken balance is untrusted because PoD callback failed for request ${blockingRequestId}. Replay the callback before using this token.`
        : "This pToken balance is untrusted because a previous PoD callback failed. Replay the callback before using this token.",
    );
  }

  if (probe.pending) {
    const diagnostics = await logPodPTokenReadinessBlocked(pToken, account, pTokenAddress, action, probe, "pending", debugContext);
    const blockingRequestId = diagnostics.blockingRequest?.requestId;
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
    const quote = await quotePortalPodRequest(
      signer,
      portalAddress,
      depositMethod,
      [
        { value: wallet },
        { value: amountWei.toString() },
        { value: "0", isCallBackFee: true },
      ],
      undefined,
      chainId,
    );
    onProgress?.("transfer-start");

    const depositValue = isNativeDeposit ? amountWei + quote.totalFeeWei : quote.totalFeeWei;
    const tx = isNativeDeposit
      ? await portal.depositNative(wallet, amountWei, quote.callbackFeeWei, {
          value: depositValue,
          gasPrice: quote.gasPrice,
        })
      : await portal.deposit(wallet, amountWei, quote.callbackFeeWei, {
          value: quote.totalFeeWei,
          gasPrice: quote.gasPrice,
        });

    const receipt = await tx.wait();
    if (!receipt || receipt.status !== 1) {
      throw new Error("PoD deposit transaction failed");
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
  const transferQuote = await quotePortalPodRequest(
    signer,
    portalAddress,
    "requestWithdrawWithPermit",
    [
      { value: wallet },
      { value: amountWei.toString() },
      { value: "0" },
      { value: "0", isCallBackFee: true },
      { value: "0" },
      { value: "0" },
      { value: deadline.toString() },
      { value: "0" },
      { value: ethers.ZeroHash },
      { value: ethers.ZeroHash },
    ],
    sharedGasPrice,
    chainId,
  );
  const burnQuote = await quotePortalPodRequest(
    signer,
    portalAddress,
    "requestWithdrawWithPermit",
    [
      { value: wallet },
      { value: amountWei.toString() },
      { value: "0" },
      { value: "0" },
      { value: "0" },
      { value: "0", isCallBackFee: true },
      { value: deadline.toString() },
      { value: "0" },
      { value: ethers.ZeroHash },
      { value: ethers.ZeroHash },
    ],
    sharedGasPrice,
    chainId,
  );
  onProgress?.("transfer-start");
  const totalValue = transferQuote.totalFeeWei + burnQuote.totalFeeWei;
  const tx = await portal.requestWithdrawWithPermit(
    wallet,
    amountWei,
    transferQuote.totalFeeWei,
    transferQuote.callbackFeeWei,
    burnQuote.totalFeeWei,
    burnQuote.callbackFeeWei,
    deadline,
    withdrawPermit.v,
    withdrawPermit.r,
    withdrawPermit.s,
    { value: totalValue, gasPrice: sharedGasPrice },
  );

  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error("Sepolia withdraw transaction failed");
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
