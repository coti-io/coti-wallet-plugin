import { useState, useEffect, useMemo } from 'react';
import { useAccount } from 'wagmi';
import { getPluginConfig } from '../config/plugin';

/**
 * Normalized wallet type derived from wagmi's stable `connector.id`.
 * Uses connector.id (wagmi-controlled) — NOT window.ethereum.isMetaMask.
 */
export type WalletType = 'metamask' | 'coinbase' | 'walletconnect' | 'rainbow' | 'phantom' | 'trust' | 'rabby' | 'ledger' | 'unknown';

/**
 * Information about the connected wallet type and its capabilities.
 */
export interface WalletTypeInfo {
  /** True only when connector is MetaMask AND COTI Snap is installed */
  isMetaMaskWithSnap: boolean;
  /** Normalized wallet identifier derived from connector.id */
  walletType: WalletType;
  /** Raw wagmi connector.id value */
  connectorId: string | undefined;
}

/**
 * Static mapping from wagmi connector.id to normalized WalletType.
 * This mapping is deterministic and does not rely on self-reported provider properties.
 * Includes both standard wagmi connector IDs and EIP-6963 rdns-based IDs.
 */
const CONNECTOR_ID_TO_WALLET_TYPE: Record<string, WalletType> = {
  // Standard wagmi connector IDs
  metaMask: 'metamask',
  coinbaseWalletSDK: 'coinbase',
  walletConnect: 'walletconnect',
  rainbow: 'rainbow',
  // EIP-6963 rdns-based connector IDs
  'io.metamask': 'metamask',
  'io.metamask.flask': 'metamask',
  metamask: 'metamask',
  phantom: 'phantom',
  'trust-extension': 'trust',
  trustWallet: 'trust',
  rabby: 'rabby',
  ledger: 'ledger',
};

/**
 * Maps a wagmi connector.id to a normalized WalletType.
 * Performs exact match first, then case-insensitive partial match for MetaMask variants.
 * Falls back to 'unknown' for unrecognized connector IDs.
 */
export function mapConnectorIdToWalletType(connectorId: string | undefined): WalletType {
  if (!connectorId) return 'unknown';
  // Exact match
  if (CONNECTOR_ID_TO_WALLET_TYPE[connectorId]) {
    return CONNECTOR_ID_TO_WALLET_TYPE[connectorId];
  }
  // Case-insensitive partial match for MetaMask variants (e.g. "io.metamask.flask")
  const lower = connectorId.toLowerCase();
  if (lower.includes('metamask')) return 'metamask';
  if (lower.includes('coinbase')) return 'coinbase';
  if (lower.includes('walletconnect')) return 'walletconnect';
  if (lower.includes('phantom')) return 'phantom';
  if (lower.includes('trust')) return 'trust';
  if (lower.includes('rabby')) return 'rabby';
  if (lower.includes('rainbow')) return 'rainbow';
  if (lower.includes('ledger')) return 'ledger';
  return 'unknown';
}

/** Default state when no connector is available */
const DISCONNECTED_STATE: WalletTypeInfo = {
  isMetaMaskWithSnap: false,
  walletType: 'unknown',
  connectorId: undefined,
};

/**
 * Detects the connected wallet type using wagmi's stable `connector.id`.
 * Returns routing information for AES key retrieval.
 *
 * Security: Uses `connector.id` (wagmi-controlled, stable) rather than
 * `window.ethereum.isMetaMask` (self-reported, spoofable by any wallet).
 *
 * When the wallet type is 'metamask', performs an async Snap installation check
 * via `wallet_getSnaps` to determine if the COTI Snap is available.
 *
 * @returns WalletTypeInfo with wallet type, snap capability, and raw connector ID
 */
export function useWalletType(): WalletTypeInfo {
  const { connector } = useAccount();
  const [isMetaMaskWithSnap, setIsMetaMaskWithSnap] = useState(false);

  const connectorId = connector?.id;
  const walletType = mapConnectorIdToWalletType(connectorId);

  // Perform async Snap installation check when wallet type is 'metamask'
  useEffect(() => {
    let cancelled = false;

    if (walletType !== 'metamask' || !connector) {
      setIsMetaMaskWithSnap(false);
      return;
    }

    const checkSnapInstalled = async () => {
      try {
        const provider = await connector.getProvider();
        if (!provider || cancelled) return;

        const snapId = getPluginConfig().snapId;
        const snaps = (await (provider as any).request({
          method: 'wallet_getSnaps',
        })) as Record<string, any>;

        if (cancelled) return;

        // Check if the COTI Snap is among the installed snaps
        const snapFound = Object.values(snaps).some(
          (snap: any) => snap.id === snapId
        );

        setIsMetaMaskWithSnap(snapFound);
      } catch {
        // If the Snap check fails or times out, default to false
        // Requirement 2.5: isMetaMaskWithSnap = false on failure
        if (!cancelled) {
          setIsMetaMaskWithSnap(false);
        }
      }
    };

    checkSnapInstalled();

    return () => {
      cancelled = true;
    };
  }, [walletType, connector]);

  // Memoize result to avoid re-render loops
  return useMemo<WalletTypeInfo>(() => {
    if (!connectorId) {
      return DISCONNECTED_STATE;
    }

    return {
      isMetaMaskWithSnap,
      walletType,
      connectorId,
    };
  }, [isMetaMaskWithSnap, walletType, connectorId]);
}
