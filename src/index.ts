// Configuration
export {
  configureCotiPlugin,
  getPluginConfig,
  getSnapRequestParams,
  isSnapEnabled,
  isAutoInitTokensEnabled,
  resolvePluginFeatures,
  COTI_PLUGIN_FEATURES,
} from './config/plugin';
export type {
  CotiPluginConfig,
  CotiPluginFeature,
  AesKeyChainId,
  EncryptedAesBackup,
  GrantResult,
  OnboardingServiceRequest,
  OnboardingServices,
  SaveEncryptedAesBackupRequest,
} from './config/plugin';

// Errors
export { CotiPluginError, CotiErrorCode, isCotiPluginError, hasCotiErrorCode, createRpcRateLimitedError, reportPluginError, PLUGIN_ERROR_EVENT } from './errors';

// Chain definitions (viem + chain ids). Default RPC URL constants stay internal.
export {
  cotiMainnet,
  cotiTestnet,
  sepolia,
  ethereumMainnet,
  COTI_MAINNET_CHAIN_ID,
  COTI_TESTNET_CHAIN_ID,
  COTI_TESTNET_POD_INBOX,
  POD_INBOX_ADDRESS,
  SEPOLIA_CHAIN_ID,
  ETHEREUM_MAINNET_CHAIN_ID,
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
} from './contracts/pod';
export type { PodPortalRequest, PodPortalRequestStatus, PodBalanceState, PodBalanceTrustState } from './contracts/pod';
export { estimateCotiBridgeGasFeeDisplay } from './chains/cotiBridgeGasEstimate';
export { quoteCotiBridgeFees } from './chains/coti-bridge/fees';
export type { CotiBridgeFeeQuote } from './chains/coti-bridge/fees';
export { resolvePodRequestStatus } from './chains/portal/podRequestStatus';
export {
  executePodPortalTransaction,
  signPodWithdrawPermit,
  assertPodPTokenReady,
  getPodInboxAddress,
  getPodSdkConfig,
  getPodGasPrice,
  resolvePodTxGasPrice,
  quotePortalFeeOnly,
  quotePodPortalTransactionFees,
  estimatePodPortalFees,
  formatPortalFeeDisplay,
  formatPodFeeDisplay,
} from './chains/portal/executePodPortalTransaction';
export type { PodWithdrawPermit, PodPortalFeeQuote } from './chains/portal/executePodPortalTransaction';
export {
  executePodPrivateTokenTransfer,
  quotePodPrivateTokenTransferFees,
  quotePodTransferFees,
  buildPodTransferMethodArgs,
} from './chains/portal/executePodPrivateTokenTransfer';
export type { PodTransferFeeQuote } from './chains/portal/executePodPrivateTokenTransfer';
export { usePodTransferFees } from './hooks/bridge/usePodTransferFees';
export { fetchPodOracleTokenUsdPrice } from './chains/podPriceOracle';
export { fetchPodBridgeData, simulatePodPortalFee } from './chains/portal/podPortalAdminData';

// Contracts (ABIs stay internal)
export { CONTRACT_ADDRESSES, SUPPORTED_TOKENS, MINIMUM_PORTAL_IN_AMOUNTS, getPublicTokensForChain, getPrivateTokensForChain } from './contracts/config';
export type { TokenConfig } from './contracts/config';
export { LIMITS } from './contracts/limits';

// Hooks — Wallet Manager
export { useMetamask } from './hooks/useMetamask';

// Hooks — Balance Manager
export { usePrivateTokenBalance } from './hooks/usePrivateTokenBalance';
// NOTE: `useBalanceUpdater` is internal to CotiPluginProvider.

// Hooks — Bridge Operations
// NOTE: `usePluginBridge` (and its `getInitialPublicTokens`/`getInitialPrivateTokens`
// helpers + `Token`/`SwapProgressStage` types) are intentionally NOT exported. They are
// internal to `CotiPluginProvider`; consumers should use the provider + context instead.
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
} from './hooks/bridge';

// Hooks — Network
export { useNetworkEnforcer } from './hooks/useNetworkEnforcer';
export type { NetworkEnforcerResult } from './hooks/useNetworkEnforcer';

// Context — plugin provider + bounded slice hooks
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
} from './context/plugin';
export type {
  CotiPluginContextType,
  CotiPluginProviderProps,
  CotiWalletContextValue,
  CotiNetworkContextValue,
  CotiUnlockContextValue,
  CotiTokensContextValue,
  CotiSwapContextValue,
  CotiPodContextValue,
  CotiModalsContextValue,
  RefreshPrivateBalancesOptions,
  AccountStateResult,
  AccountStateFailureReason,
} from './context/plugin';
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
export {
  mobileZerionWallet,
  WALLET_CONNECT_FAILURE_EVENT,
  type WalletConnectFailureDetail,
} from './providers/mobileZerionWallet';

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
export { OnboardModal, onboardModalDefaultStyles, ONBOARD_MODAL_STYLE_KEYS } from './components/OnboardModal';
export type { OnboardModalProps, OnboardModalTheme, OnboardModalPage, OnboardModalWarnings } from './components/OnboardModal';

// Components — Network
export { NetworkGuard } from './components/NetworkGuard';
export type { NetworkGuardProps } from './components/NetworkGuard';

// Re-export from RainbowKit for consuming apps
export { useConnectModal } from '@rainbow-me/rainbowkit';

export {
  encryptAesKeyBackup,
  decryptAesKeyBackup,
  backupFromChainTuple,
  OUTDATED_AES_BACKUP_ERROR,
  AES_BACKUP_WALLET_NOT_SUPPORTED,
  AES_BACKUP_SIGNING_WARNING,
} from './crypto/aesKeyBackupVault';
export type {
  AesBackupSigner,
  AesBackupVaultContext,
} from './crypto/aesKeyBackupVault';

export {
  AES_BACKUP_STORAGE_AUTH_DOMAIN_NAME,
  AES_BACKUP_STORAGE_AUTH_DOMAIN_VERSION,
  AES_BACKUP_STORAGE_AUTH_DOMAIN_SALT,
  getAesBackupStorageAuthDomain,
  buildAesBackupStorageAuthMessage,
  buildAesBackupStorageAuthTypedData,
  signAesBackupStorageAuthChallenge,
  assertAesBackupStorageAuthChallengeFresh,
} from './crypto/aesBackupStorageAuth';
export type {
  AesBackupStorageOperation,
  AesBackupStorageAuthChallenge,
  AesBackupStorageAuthSigner,
} from './crypto/aesBackupStorageAuth';

export type {
  PersistEncryptedAesBackupResult,
  AesBackupPersistFailureCode,
} from './lib/persistEncryptedAesBackup';

// Utilities
export { isMultipleWalletsError, isUnsupportedRpcMethodError, MULTIPLE_WALLETS_ERROR_SUBSTRING } from './utils/walletErrors';
export { formatTokenBalanceDisplay, truncateDecimalValue, formatBalanceWithNotation, addThousandsSeparators, expandExponentialNumber, formatPlainDecimal, formatAmountLimitDisplay, isDustAmount, DUST_AMOUNT_THRESHOLD } from './lib/utils';
export { isTransientRpcError, isRateLimitedRpcError } from './lib/rpcProvider';
export {
  getEthereumProvider,
  getEip6963MetaMaskProvider,
  getEip6963RabbyProvider,
  resolveMetaMaskInjectedTarget,
  resolveRabbyInjectedTarget,
  resolveConnectedProvider,
} from './lib/ethereum';
export type { EIP1193Provider, ConnectorProviderSource } from './lib/ethereum';

// NOTE: logger, muteChainUpdates, ABIs, default RPC URL constants, PoD localStorage
// helpers, getSepoliaGasPrice, and useBalanceUpdater are intentionally not exported.
