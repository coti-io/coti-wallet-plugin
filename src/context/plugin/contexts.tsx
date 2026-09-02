import { createContext, useContext } from 'react';
import type {
  CotiPluginContextType,
  CotiModalsContextValue,
  CotiNetworkContextValue,
  CotiPodContextValue,
  CotiSwapContextValue,
  CotiTokensContextValue,
  CotiUnlockContextValue,
  CotiWalletContextValue,
} from './types';

const missingProvider = (name: string): never => {
  throw new Error(`${name} must be used within a CotiPluginProvider`);
};

/** @deprecated Prefer bounded hooks; kept for existing consumers. */
export const CotiPluginContext = createContext<CotiPluginContextType | undefined>(undefined);

export const CotiWalletContext = createContext<CotiWalletContextValue | undefined>(
  undefined,
);
export const CotiNetworkContext = createContext<CotiNetworkContextValue | undefined>(
  undefined,
);
export const CotiUnlockContext = createContext<CotiUnlockContextValue | undefined>(
  undefined,
);
export const CotiTokensContext = createContext<CotiTokensContextValue | undefined>(
  undefined,
);
export const CotiSwapContext = createContext<CotiSwapContextValue | undefined>(
  undefined,
);
export const CotiPodContext = createContext<CotiPodContextValue | undefined>(
  undefined,
);
export const CotiModalsContext = createContext<CotiModalsContextValue | undefined>(
  undefined,
);

/** Legacy flat accessor — unchanged API for existing apps. */
export const useCotiPluginContext = (): CotiPluginContextType => {
  const context = useContext(CotiPluginContext);
  if (context === undefined) missingProvider('useCotiPluginContext');
  return context!;
};

/** Wallet connection (connect, disconnect, address). */
export const useCotiWallet = (): CotiWalletContextValue => {
  const context = useContext(CotiWalletContext);
  if (context === undefined) missingProvider('useCotiWallet');
  return context!;
};

/** Network switching and enforcer state. */
export const useCotiNetwork = (): CotiNetworkContextValue => {
  const context = useContext(CotiNetworkContext);
  if (context === undefined) missingProvider('useCotiNetwork');
  return context!;
};

/** Snap, onboarding, and private balance unlock flows. */
export const useCotiUnlock = (): CotiUnlockContextValue => {
  const context = useContext(CotiUnlockContext);
  if (context === undefined) missingProvider('useCotiUnlock');
  return context!;
};

/** Public and private token lists. */
export const useCotiTokens = (): CotiTokensContextValue => {
  const context = useContext(CotiTokensContext);
  if (context === undefined) missingProvider('useCotiTokens');
  return context!;
};

/** Swap form, bridge execution, gas, and approvals. */
export const useCotiSwap = (): CotiSwapContextValue => {
  const context = useContext(CotiSwapContext);
  if (context === undefined) missingProvider('useCotiSwap');
  return context!;
};

/** Sepolia PoD portal request tracker. */
export const useCotiPod = (): CotiPodContextValue => {
  const context = useContext(CotiPodContext);
  if (context === undefined) missingProvider('useCotiPod');
  return context!;
};

/** MetaMask install and multi-wallet conflict modals. */
export const useCotiModals = (): CotiModalsContextValue => {
  const context = useContext(CotiModalsContext);
  if (context === undefined) missingProvider('useCotiModals');
  return context!;
};
