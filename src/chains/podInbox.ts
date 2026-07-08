/**
 * PoD inbox contract — same deployment on Sepolia, Avalanche Fuji, and COTI testnet.
 * Single source of truth for {@link getPodSdkConfig}, {@link getPodInboxAddress}, and
 * {@link PodContract} fee estimation via `@coti-io/pod-sdk`.
 */
export const POD_INBOX_ADDRESS = "0xAb625bE229F603f6BBF964474AFf6d5487e364De";

/**
 * Default callback payload size (bytes) for inbox `estimateFee` when a chain config
 * omits `callBackDataSize`. Must be set together with `callBackGasLimit` per SDK rules.
 */
export const POD_DEFAULT_CALLBACK_DATA_SIZE = 1024n;

/** @deprecated Use {@link POD_INBOX_ADDRESS}. */
export const POD_TESTNET_INBOX_ADDRESS = POD_INBOX_ADDRESS;

/** @deprecated Use {@link POD_INBOX_ADDRESS}. */
export const COTI_TESTNET_POD_INBOX = POD_INBOX_ADDRESS;
