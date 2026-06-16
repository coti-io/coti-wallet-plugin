import { getChainConfig, getPublicTokensForChain } from "../index";
import type { TokenConfig } from "../types";

/** Treat blank config entries as unset (factory placeholders are often `""`). */
export function resolveConfiguredAddress(
  addresses: Record<string, string> | undefined,
  key: string | undefined,
): string | undefined {
  if (!addresses || !key) return undefined;
  const value = addresses[key]?.trim();
  return value || undefined;
}

/** PoD Privacy Portal public token (not the legacy COTI bridge). */
export function isPodPortalPublicToken(
  chainId: number,
  token: TokenConfig | undefined,
): boolean {
  if (!token || token.isPrivate) return false;
  if (getChainConfig(chainId)?.portalStrategy !== "pod-privacy-portal") return false;
  return !!token.bridgeAddressKey?.startsWith("PrivacyPortal");
}

/** Show chain native balance even though config stores the wrapped ERC-20 address. */
export function usesNativePublicBalance(token: TokenConfig): boolean {
  return !!token.isNative;
}

/** Portal In skips ERC-20 approve for native deposits (and legacy native COTI). */
export function skipsPublicDepositApproval(
  token: TokenConfig | undefined,
  direction: "to-private" | "to-public",
): boolean {
  if (direction !== "to-private" || !token) return false;
  if (token.isNative) return true;
  return token.symbol === "COTI" && !token.addressKey;
}

export function findPublicTokenConfig(
  chainId: number,
  symbol: string,
): TokenConfig | undefined {
  return getPublicTokensForChain(chainId).find(t => t.symbol === symbol && !t.isPrivate);
}

export function resolvePodPortalAddresses(params: {
  addresses: Record<string, string>;
  pubCfg: TokenConfig;
  privCfg: TokenConfig | undefined;
}) {
  const { addresses, pubCfg, privCfg } = params;
  const portalAddress = resolveConfiguredAddress(addresses, pubCfg.bridgeAddressKey);
  const underlyingAddress = resolveConfiguredAddress(addresses, pubCfg.addressKey);
  const pTokenAddress = privCfg?.addressKey
    ? resolveConfiguredAddress(addresses, privCfg.addressKey)
    : undefined;
  if (!portalAddress || !underlyingAddress || !pTokenAddress) return null;
  return { portalAddress, underlyingAddress, pTokenAddress };
}

export function podPortalNotConfiguredError(chainId: number, symbol: string): string {
  const chainName = getChainConfig(chainId)?.name ?? "this network";
  return `PoD portal is not configured for ${symbol} on ${chainName}. Deploy the portal and set PrivacyPortal* / p.* addresses in chain config.`;
}
