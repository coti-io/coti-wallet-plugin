import type { PodSdkConfig } from "@coti-io/pod-sdk";
import { getPluginConfig, type CotiPluginConfig } from "../../config/plugin";
import { AVALANCHE_C_CHAIN_ID } from "../avalanche";
import { AVALANCHE_FUJI_CHAIN_ID } from "../avalancheFuji";
import { COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID } from "../coti";
import { getRpcUrlForChain } from "../index";
import {
  getPodInboxAddress,
  isPodMainnetChain,
} from "../podInbox";
import { SEPOLIA_CHAIN_ID } from "../sepolia";

export {
  getPodInboxAddress,
  isPodMainnetChain,
  isPodTrackingChain,
} from "../podInbox";

/** Live mainnet encryption-service gateway (nginx `/es` on gw.pod.mainnet.coti.io). */
export const POD_MAINNET_ENCRYPTION_SERVICE_URL =
  "https://gw.pod.mainnet.coti.io/es";

/** Source/target chains for testnet PoD tracking (shared testnet inbox). */
const POD_TESTNET_TRACKING_CHAIN_ORDER = [
  SEPOLIA_CHAIN_ID,
  AVALANCHE_FUJI_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
] as const;

/** Source/target chains for mainnet PoD tracking (shared mainnet inbox). */
const POD_MAINNET_TRACKING_CHAIN_ORDER = [
  AVALANCHE_C_CHAIN_ID,
  COTI_MAINNET_CHAIN_ID,
] as const;

/** Encryption service target for `encodePodMethodArguments` / `PodContract`. */
export const getPodEncryptionNetwork = (chainId?: number): string => {
  if (chainId != null && isPodMainnetChain(chainId)) {
    return POD_MAINNET_ENCRYPTION_SERVICE_URL;
  }
  return "testnet";
};

const resolvePodChainRpcUrl = (chainId: number, pluginConfig: CotiPluginConfig): string => {
  if (chainId === SEPOLIA_CHAIN_ID && pluginConfig.sepoliaRpcUrl) {
    return pluginConfig.sepoliaRpcUrl;
  }
  if (chainId === COTI_TESTNET_CHAIN_ID && pluginConfig.cotiTestnetRpcUrl) {
    return pluginConfig.cotiTestnetRpcUrl;
  }
  if (chainId === COTI_MAINNET_CHAIN_ID && pluginConfig.cotiMainnetRpcUrl) {
    return pluginConfig.cotiMainnetRpcUrl;
  }
  return getRpcUrlForChain(chainId);
};

/**
 * SDK config for fee estimate, encrypt, and `PodRequest` tracking.
 *
 * `chainId` selects the testnet or mainnet family. Omitted / unknown PoD chains
 * keep the historical testnet config (Sepolia, Fuji, COTI testnet).
 */
export const getPodSdkConfig = (chainId?: number): PodSdkConfig => {
  const pluginConfig = getPluginConfig();
  const mainnet = chainId != null && isPodMainnetChain(chainId);
  const order = mainnet ? POD_MAINNET_TRACKING_CHAIN_ORDER : POD_TESTNET_TRACKING_CHAIN_ORDER;
  return {
    encryptionNetwork: getPodEncryptionNetwork(chainId),
    trustedEncryptionServiceUrls: mainnet ? [POD_MAINNET_ENCRYPTION_SERVICE_URL] : undefined,
    chains: order.map(id => ({
      chainId: id,
      inboxAddress: getPodInboxAddress(id),
      rpcUrl: resolvePodChainRpcUrl(id, pluginConfig),
    })),
  };
};

/**
 * Allowlist + network for `encodePodMethodArguments`.
 * `PodContract` already reads this from {@link getPodSdkConfig}; standalone
 * encode calls must pass it or custom mainnet ES URLs are rejected.
 */
export const getPodEncodeEncryptionOptions = (chainId?: number) => {
  const config = getPodSdkConfig(chainId);
  return {
    encryptionNetwork: config.encryptionNetwork ?? getPodEncryptionNetwork(chainId),
    security: {
      trustedEncryptionServiceUrls: config.trustedEncryptionServiceUrls,
      allowUnlistedEncryptionUrl: config.allowUnlistedEncryptionUrl,
    },
  };
};

/** @deprecated Use getPodSdkConfig() for fresh RPC URLs from plugin config. */
export const podSdkConfig: PodSdkConfig = getPodSdkConfig();
