// Configuration
export {
  configureCotiPlugin,
  getPluginConfig,
  getSnapRequestParams,
  isSnapInstallEnabled,
} from './config/plugin';
export type {
  CotiPluginConfig,
  AesKeyChainId,
  EncryptedAesBackup,
  GrantResult,
  OnboardingServiceRequest,
  OnboardingServices,
  SaveEncryptedAesBackupRequest,
} from './config/plugin';

// Logging — silent by default, opt in via configureCotiPlugin({ debug: true })
export { logger, setDebugLogging } from './lib/logger';
export type { Logger } from './lib/logger';

// Errors
export { CotiPluginError, CotiErrorCode, isCotiPluginError, hasCotiErrorCode } from './errors';

// Chain definitions (viem + RPC — derived from CHAIN_CONFIGS)
export {
  cotiMainnet,
  cotiTestnet,
  sepolia,
  ethereumMainnet,
  COTI_MAINNET_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
  COTI_TESTNET_POD_INBOX,
  SEPOLIA_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
  COTI_MAINNET_RPC,
  COTI_TESTNET_RPC,
  SEPOLIA_RPC,
  SEPOLIA_RPC_FALLBACK,
  ETHEREUM_MAINNET_RPC,
  getRpcUrlForChainId,
} from './chains';

// Chain registry (multi-chain portal strategies)
export {
  CHAIN_CONFIGS,
  DEFAULT_CHAIN_ID,
  getChainConfig,
  requireChainConfig,
  getContractAddresses,
  getTokensForChain,
  getExplorerBaseUrlForChain,
  getRpcUrlForChain,
  getRpcUrlsForChain,
  getNetworkNameForChain,
  getUnlockStrategyForChain,
  getWalletNetworkConfigs,
  getWalletNetworkOptions,
  getChainIdConstants,
  resolveIndexPageUi,
} from './chains';
export type { ChainConfig as PortalChainConfig, ResolvedIndexPageUi, UnlockStrategy, PortalStrategy, WalletNetworkConfig, ChainIndexPageUi } from './chains/types';

// PoD portal
export {
  SEPOLIA_CHAIN_ID as POD_SEPOLIA_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID as POD_COTI_TESTNET_CHAIN_ID,
  DEFAULT_POD_EXPLORER_BASE_URL,
  buildPodExplorerRequestUrl,
  DEFAULT_POD_BALANCE_STATE,
  PRIVACY_PORTAL_ABI,
  POD_PTOKEN_ABI,
} from './contracts/pod';
export type { PodPortalRequest, PodPortalRequestStatus, PodBalanceState, PodBalanceTrustState } from './contracts/pod';
export { loadPodRequests, savePodRequests, podRequestsStorageKey } from './pod/podPortalRequestsStorage';
export { estimateCotiBridgeGasFeeDisplay } from './chains/cotiBridgeGasEstimate';
export { estimatePodPortalGasFeeDisplay } from './chains/portal/podGasEstimate';
export { resolvePodRequestStatus } from './chains/portal/podRequestStatus';
export { executePodPortalTransaction, signPodWithdrawPermit, getPodInboxAddress, getPodSdkConfig, getSepoliaGasPrice, quotePortalPodRequest } from './chains/portal/executePodPortalTransaction';
export type { PodWithdrawPermit } from './chains/portal/executePodPortalTransaction';

// Contracts
export { CONTRACT_ADDRESSES, SUPPORTED_TOKENS, MINIMUM_PORTAL_IN_AMOUNTS, ERC20_ABI, getPublicTokensForChain, getPrivateTokensForChain } from './contracts/config';
export type { TokenConfig } from './contracts/config';
export { TOKEN_ABI, BRIDGE_ABI, BRIDGE_ERC20_ABI, COTI_PRICE_CONSUMER_ABI } from './contracts/abis';
export { LIMITS } from './contracts/limits';

// Hooks — Wallet Manager
export { useMetamask } from './hooks/useMetamask';

// Hooks — Balance Manager
export { usePrivateTokenBalance } from './hooks/usePrivateTokenBalance';
export { useBalanceUpdater } from './hooks/useBalanceUpdater';

// Hooks — Bridge Operations
// NOTE: `usePrivacyBridge` (and its `getInitialPublicTokens`/`getInitialPrivateTokens`
// helpers + `Token`/`SwapProgressStage` types) are intentionally NOT exported. They are
// internal to `PrivacyBridgeProvider`; consumers should use the provider + context instead.
export { useBridgeData } from './hooks/useBridgeData';
export type { BridgeData } from './hooks/useBridgeData';
export { useBridgeStatus } from './hooks/useBridgeStatus';
export type { BridgeStatus } from './hooks/useBridgeStatus';
export { estimateBridgeFee } from './hooks/useEstimateBridgeFees';
export type { FeeEstimate } from './hooks/useEstimateBridgeFees';
export { fetchBridgeFees, fetchTokenUsdPrice, computeCotiFee, computeErc20Fee, simulateFeeOnChain, getTokenSimulationMeta } from './hooks/useBridgeFees';
export type { BridgeFees, SimulationResult } from './hooks/useBridgeFees';
export {
  resolvePrivateTokenContractAddress,
  resolvePrivateTokenTransferTarget,
  PRIVATE_ERC20_TRANSFER_256_SIG,
} from './hooks/privacyBridge';

// Hooks — Network
export { useNetworkEnforcer } from './hooks/useNetworkEnforcer';
export type { NetworkEnforcerResult } from './hooks/useNetworkEnforcer';

// Context — legacy flat API + bounded slice hooks
export {
  PrivacyBridgeProvider,
  usePrivacyBridgeContext,
  usePrivacyBridgeWallet,
  usePrivacyBridgeNetwork,
  usePrivacyBridgeUnlock,
  usePrivacyBridgeTokens,
  usePrivacyBridgeSwap,
  usePrivacyBridgePod,
  usePrivacyBridgeModals,
} from './context/privacyBridge';
export type {
  PrivacyBridgeContextType,
  PrivacyBridgeProviderProps,
  PrivacyBridgeWalletContextValue,
  PrivacyBridgeNetworkContextValue,
  PrivacyBridgeUnlockContextValue,
  PrivacyBridgeTokensContextValue,
  PrivacyBridgeSwapContextValue,
  PrivacyBridgePodContextValue,
  PrivacyBridgeModalsContextValue,
} from './context/privacyBridge';
export {
  PrivateUnlockProvider,
  usePrivateUnlock,
} from './context/privateUnlock';
export type {
  PrivateUnlockControllerValue,
  PrivateUnlockProviderOptions,
  PrivateUnlockProviderProps,
} from './context/privateUnlock';

// Providers — Multi-Wallet Support
export {
  WagmiRainbowKitProvider,
  getWagmiConfig,
  wagmiConfig,
  type WagmiConfigOptions,
} from './providers/WagmiRainbowKitProvider';

// Hooks — Wallet Type Detection
export { useWalletType } from './hooks/useWalletType';
export type { WalletTypeInfo, WalletType } from './hooks/useWalletType';

// Hooks — Onboarding progress types
export { ONBOARDING_STEPS } from './hooks/useAesKeyProvider';
export type {
  AesKeyProviderOptions,
  OnboardingStep,
  OnboardingStepInfo,
  OnboardingProgressCallback,
} from './hooks/useAesKeyProvider';
// Components — Onboarding
export { OnboardModal, onboardModalDefaultStyles } from './components/OnboardModal';
export type { OnboardModalProps, OnboardModalTheme } from './components/OnboardModal';

// Components — Network
export { NetworkGuard } from './components/NetworkGuard';
export type { NetworkGuardProps } from './components/NetworkGuard';

// Re-export from RainbowKit for consuming apps
export { useConnectModal } from '@rainbow-me/rainbowkit';

// Utilities
export { isMultipleWalletsError, MULTIPLE_WALLETS_ERROR_SUBSTRING } from './utils/walletErrors';
export { formatTokenBalanceDisplay, truncateDecimalValue, formatBalanceWithNotation, addThousandsSeparators } from './lib/utils';
export {
  getEthereumProvider,
  getEip6963MetaMaskProvider,
  getEip6963RabbyProvider,
  getEip6963TrustProvider,
  isTrustWalletInstalled,
  resolveMetaMaskInjectedTarget,
  resolveRabbyInjectedTarget,
  resolveTrustInjectedTarget,
} from './lib/ethereum';
export type { EIP1193Provider } from './lib/ethereum';

// Chain mute utilities (for suppressing UI reactions during cross-chain onboarding)
export { muteChainUpdates, unmuteChainUpdates, isChainUpdatesMuted } from './lib/chainMute';
