import { createContext, useContext } from 'react';
import type {
  PrivacyBridgeContextType,
  PrivacyBridgeModalsContextValue,
  PrivacyBridgeNetworkContextValue,
  PrivacyBridgePodContextValue,
  PrivacyBridgeSwapContextValue,
  PrivacyBridgeTokensContextValue,
  PrivacyBridgeUnlockContextValue,
  PrivacyBridgeWalletContextValue,
} from './types';

const missingProvider = (name: string): never => {
  throw new Error(`${name} must be used within a PrivacyBridgeProvider`);
};

/** @deprecated Prefer bounded hooks; kept for existing consumers. */
export const PrivacyBridgeContext = createContext<PrivacyBridgeContextType | undefined>(undefined);

export const PrivacyBridgeWalletContext = createContext<PrivacyBridgeWalletContextValue | undefined>(
  undefined,
);
export const PrivacyBridgeNetworkContext = createContext<PrivacyBridgeNetworkContextValue | undefined>(
  undefined,
);
export const PrivacyBridgeUnlockContext = createContext<PrivacyBridgeUnlockContextValue | undefined>(
  undefined,
);
export const PrivacyBridgeTokensContext = createContext<PrivacyBridgeTokensContextValue | undefined>(
  undefined,
);
export const PrivacyBridgeSwapContext = createContext<PrivacyBridgeSwapContextValue | undefined>(
  undefined,
);
export const PrivacyBridgePodContext = createContext<PrivacyBridgePodContextValue | undefined>(
  undefined,
);
export const PrivacyBridgeModalsContext = createContext<PrivacyBridgeModalsContextValue | undefined>(
  undefined,
);

/** Legacy flat accessor — unchanged API for existing apps. */
export const usePrivacyBridgeContext = (): PrivacyBridgeContextType => {
  const context = useContext(PrivacyBridgeContext);
  if (context === undefined) missingProvider('usePrivacyBridgeContext');
  return context!;
};

/** Wallet connection (connect, disconnect, address). */
export const usePrivacyBridgeWallet = (): PrivacyBridgeWalletContextValue => {
  const context = useContext(PrivacyBridgeWalletContext);
  if (context === undefined) missingProvider('usePrivacyBridgeWallet');
  return context!;
};

/** Network switching and enforcer state. */
export const usePrivacyBridgeNetwork = (): PrivacyBridgeNetworkContextValue => {
  const context = useContext(PrivacyBridgeNetworkContext);
  if (context === undefined) missingProvider('usePrivacyBridgeNetwork');
  return context!;
};

/** Snap, AES key, and private balance unlock flows. */
export const usePrivacyBridgeUnlock = (): PrivacyBridgeUnlockContextValue => {
  const context = useContext(PrivacyBridgeUnlockContext);
  if (context === undefined) missingProvider('usePrivacyBridgeUnlock');
  return context!;
};

/** Public and private token lists. */
export const usePrivacyBridgeTokens = (): PrivacyBridgeTokensContextValue => {
  const context = useContext(PrivacyBridgeTokensContext);
  if (context === undefined) missingProvider('usePrivacyBridgeTokens');
  return context!;
};

/** Swap form, bridge execution, gas, and approvals. */
export const usePrivacyBridgeSwap = (): PrivacyBridgeSwapContextValue => {
  const context = useContext(PrivacyBridgeSwapContext);
  if (context === undefined) missingProvider('usePrivacyBridgeSwap');
  return context!;
};

/** Sepolia PoD portal request tracker. */
export const usePrivacyBridgePod = (): PrivacyBridgePodContextValue => {
  const context = useContext(PrivacyBridgePodContext);
  if (context === undefined) missingProvider('usePrivacyBridgePod');
  return context!;
};

/** MetaMask install and multi-wallet conflict modals. */
export const usePrivacyBridgeModals = (): PrivacyBridgeModalsContextValue => {
  const context = useContext(PrivacyBridgeModalsContext);
  if (context === undefined) missingProvider('usePrivacyBridgeModals');
  return context!;
};
