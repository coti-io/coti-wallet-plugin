export { PLUGIN_VERSION } from './version';

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
  DEFAULT_CHAIN_ID,
  getContractAddresses,
  getTokensForChain,
  getExplorerBaseUrlForChain,
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
export { resolvePodRequestStatus } from './chains/portal/podRequestStatus';
export {
  executePodPortalTransaction,
  signPodWithdrawPermit,
  assertPodPTokenReady,
  getPodInboxAddress,
  getPodSdkConfig,
  resolvePodTxGasPrice,
} from './chains/portal/executePodPortalTransaction';
export type { PodWithdrawPermit } from './chains/portal/executePodPortalTransaction';
export {
  executePodPrivateTokenTransfer,
  buildPodTransferMethodArgs,
} from './chains/portal/executePodPrivateTokenTransfer';

// Contracts (ABIs stay internal)
export { CONTRACT_ADDRESSES, SUPPORTED_TOKENS, MINIMUM_PORTAL_IN_AMOUNTS, getPublicTokensForChain, getPrivateTokensForChain } from './contracts/config';
export type { TokenConfig } from './contracts/config';
export { LIMITS } from './contracts/limits';

// Hooks — Wallet Manager
// NOTE: `useMetamask` is internal to CotiPluginProvider.

// Hooks — Balance Manager
export { usePrivateTokenBalance } from './hooks/usePrivateTokenBalance';
// NOTE: `useBalanceUpdater` is internal to CotiPluginProvider.

// Hooks — Bridge Operations
// NOTE: `usePluginBridge` (and its `getInitialPublicTokens`/`getInitialPrivateTokens`
// helpers + `Token`/`SwapProgressStage` types) are intentionally NOT exported. They are
// internal to `CotiPluginProvider`; consumers should use the provider + context instead.
// NOTE: bridge fee helpers (`estimateBridgeFee`, `useBridgeData`, `quoteCotiBridgeFees`,
// `usePodTransferFees`, …) stay internal. Hosts use `useCotiSwap`.
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

// NOTE: WagmiRainbowKitProvider, getWagmiConfig, mobileZerionWallet, and
// useConnectModal live on `@coti-io/coti-wallet-plugin/rainbowkit`.

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
// NOTE: `OnboardModal` is plugin-owned. Hosts theme it via `privateUnlock` /
// `usePrivateUnlock`, not by mounting the component.
export type { OnboardModalTheme, OnboardModalPage, OnboardModalWarnings } from './components/OnboardModal';

// Components — Network
export { NetworkGuard } from './components/NetworkGuard';
export type { NetworkGuardProps } from './components/NetworkGuard';

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
// helpers, getSepoliaGasPrice, useBalanceUpdater, useMetamask, OnboardModal,
// CHAIN_CONFIGS, and bridge fee helpers are intentionally not exported.
