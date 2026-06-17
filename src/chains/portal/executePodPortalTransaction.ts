import { ethers } from "ethers";
import { DataType, PodContract, type PodSdkConfig } from "@coti/pod-sdk";
import { COTI_TESTNET_CHAIN_ID, PRIVACY_PORTAL_ABI, POD_PTOKEN_ABI, SEPOLIA_CHAIN_ID, type PodPortalRequest } from "../../contracts/pod";
import type { SwapProgressStage } from "../../hooks/usePrivacyBridge";
import { getPluginConfig, type CotiPluginConfig } from "../../config/plugin";
import { AVALANCHE_FUJI_CHAIN_ID, getChainConfig, getRpcUrlForChain } from "../index";

/** Source/target chains registered for PoD portal cross-chain tracking. */
const POD_TRACKING_CHAIN_ORDER = [
  SEPOLIA_CHAIN_ID,
  AVALANCHE_FUJI_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
] as const;

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
  const podContract = new PodContract(portalAddress, PRIVACY_PORTAL_ABI, runner, {
    config: getPodSdkConfig(),
    inboxAddress: getPodInboxAddress(chainId),
    encryptionNetwork: "testnet",
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

/** Newer MpcCore pTokens expose flat ctUint256 balances in status helpers. */
const POD_PTOKEN_FLAT_STATE_ABI = [
  "function balanceWithState(address account) view returns (tuple(uint256 ciphertextHigh,uint256 ciphertextLow) balance,bool pending,bool callbackErrored)",
] as const;

const POD_PTOKEN_FLAT_STATUS_ABI = [
  "function balanceOfWithStatus(address account) view returns (tuple(uint256 ciphertextHigh,uint256 ciphertextLow),bool)",
] as const;

/** Native / WETH-style pTokens may expose plain uint256 balances in status helpers. */
const POD_PTOKEN_PLAIN_STATUS_ABI = [
  "function balanceOfWithStatus(address account) view returns (uint256,bool)",
] as const;

const readPodPTokenPendingState = async (
  pToken: ethers.Contract,
  account: string,
): Promise<{ pending: boolean; callbackErrored: boolean }> => {
  try {
    const [, pending, callbackErrored] = await pToken.balanceWithState(account);
    return { pending: Boolean(pending), callbackErrored: Boolean(callbackErrored) };
  } catch {
    /* fall through to flat balanceWithState */
  }

  const pTokenAddress = await pToken.getAddress();
  const runner = pToken.runner as ethers.ContractRunner;

  try {
    const flatStateToken = new ethers.Contract(pTokenAddress, POD_PTOKEN_FLAT_STATE_ABI, runner);
    const [, pending, callbackErrored] = await flatStateToken.balanceWithState(account);
    return { pending: Boolean(pending), callbackErrored: Boolean(callbackErrored) };
  } catch {
    /* fall through to balanceOfWithStatus variants */
  }

  try {
    const [, pending] = await pToken.balanceOfWithStatus(account);
    return { pending: Boolean(pending), callbackErrored: false };
  } catch {
    /* fall through to flat status ABI */
  }

  try {
    const flatStatusToken = new ethers.Contract(pTokenAddress, POD_PTOKEN_FLAT_STATUS_ABI, runner);
    const [, pending] = await flatStatusToken.balanceOfWithStatus(account);
    return { pending: Boolean(pending), callbackErrored: false };
  } catch {
    /* fall through to plain pToken ABI */
  }

  const plainToken = new ethers.Contract(pTokenAddress, POD_PTOKEN_PLAIN_STATUS_ABI, runner);
  const [, pending] = await plainToken.balanceOfWithStatus(account);
  return { pending: Boolean(pending), callbackErrored: false };
};

const assertPodPTokenReady = async (
  pToken: ethers.Contract,
  account: string,
  action: "deposit" | "withdraw",
) => {
  try {
    const { pending, callbackErrored } = await readPodPTokenPendingState(pToken, account);

    if (callbackErrored) {
      throw new Error("This pToken balance is untrusted because a previous PoD callback failed. Replay the callback before using this token.");
    }
    if (pending) {
      throw new Error(`A PoD request is already pending for this wallet. Wait for it to complete before starting another ${action}.`);
    }
  } catch (stateError: unknown) {
    const message = getErrorMessage(stateError);
    if (message.includes("pending") || message.includes("untrusted") || message.includes("callback")) {
      throw stateError;
    }
    throw new Error("Could not verify the pToken request state. Please refresh and try again.");
  }
};

export async function signPodWithdrawPermit(params: {
  signer: ethers.JsonRpcSigner;
  pTokenAddress: string;
  portalAddress: string;
  amountWei: bigint;
  deadline?: bigint;
  chainId?: number;
}): Promise<PodWithdrawPermit> {
  const { signer, pTokenAddress, portalAddress, amountWei } = params;
  const wallet = await signer.getAddress();
  const pToken = new ethers.Contract(pTokenAddress, POD_PTOKEN_ABI, signer);
  const signingChainId = params.chainId ?? Number((await signer.provider!.getNetwork()).chainId);

  await assertPodPTokenReady(pToken, wallet, "withdraw");

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
    await assertPodPTokenReady(pToken, wallet, "deposit");

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

  await assertPodPTokenReady(pToken, wallet, "withdraw");

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
