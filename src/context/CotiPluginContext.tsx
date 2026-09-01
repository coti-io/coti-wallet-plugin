/**
 * Import from `./plugin` for new code.
 * Re-exported so existing `context/CotiPluginContext` import paths keep working.
 */
export {
  CotiPluginProvider,
  useCotiPluginContext,
  useCotiWallet,
  useCotiNetwork,
  useCotiUnlock,
  useCotiTokens,
  useCotiSwap,
  useCotiPod,
  useCotiModals,
} from './plugin';

export type {
  CotiPluginContextType,
  CotiWalletContextValue,
  CotiNetworkContextValue,
  CotiUnlockContextValue,
  CotiTokensContextValue,
  CotiSwapContextValue,
  CotiPodContextValue,
  CotiModalsContextValue,
} from './plugin';
