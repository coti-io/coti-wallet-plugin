// Configuration
export { configureCotiPlugin, getPluginConfig } from './config/plugin';
export type { CotiPluginConfig } from './config/plugin';

// Chain definitions
export { cotiMainnet, cotiTestnet, COTI_MAINNET_CHAIN_ID, COTI_TESTNET_CHAIN_ID, COTI_MAINNET_RPC, COTI_TESTNET_RPC, getRpcUrlForChainId } from './config/chains';

// Contracts
export { CONTRACT_ADDRESSES, SUPPORTED_TOKENS, MINIMUM_PORTAL_IN_AMOUNTS, ERC20_ABI } from './contracts/config';
export type { TokenConfig } from './contracts/config';
export { TOKEN_ABI, BRIDGE_ABI, BRIDGE_ERC20_ABI, COTI_PRICE_CONSUMER_ABI } from './contracts/abis';
export { LIMITS } from './contracts/limits';

// Hooks — Key & Onboarding Manager
export { useSnap, signIT256ViaSnap, onboardUser } from './hooks/useSnap';
export { useMetamask } from './hooks/useMetamask';

// Hooks — Unified Wallet Abstraction
export { useWallet } from './hooks/useWallet';
export type { UseWalletResult } from './hooks/useWallet';

// Hooks — Balance Manager
export { usePrivateTokenBalance } from './hooks/usePrivateTokenBalance';
export { useBalanceUpdater } from './hooks/useBalanceUpdater';

// Hooks — Bridge Operations
export { usePrivacyBridge, getInitialPublicTokens, getInitialPrivateTokens } from './hooks/usePrivacyBridge';
export type { Token, SwapProgressStage } from './hooks/usePrivacyBridge';
export { useBridgeData } from './hooks/useBridgeData';
export type { BridgeData } from './hooks/useBridgeData';
export { useBridgeStatus } from './hooks/useBridgeStatus';
export type { BridgeStatus } from './hooks/useBridgeStatus';
export { estimateBridgeFee } from './hooks/useEstimateBridgeFees';
export type { FeeEstimate } from './hooks/useEstimateBridgeFees';
export { fetchBridgeFees, fetchTokenUsdPrice, computeCotiFee, computeErc20Fee, simulateFeeOnChain, getTokenSimulationMeta, getRpcUrlForChainId as getBridgeRpcUrl } from './hooks/useBridgeFees';
export type { BridgeFees, SimulationResult } from './hooks/useBridgeFees';

// Hooks — Network
export { useNetworkEnforcer } from './hooks/useNetworkEnforcer';
export type { NetworkEnforcerResult } from './hooks/useNetworkEnforcer';

// Context
export { PrivacyBridgeProvider, usePrivacyBridgeContext } from './context/PrivacyBridgeContext';

// Providers — Multi-Wallet Support
export { WagmiRainbowKitProvider, wagmiConfig } from './providers/WagmiRainbowKitProvider';

// Hooks — Wallet Type Detection
export { useWalletType } from './hooks/useWalletType';
export type { WalletTypeInfo, WalletType } from './hooks/useWalletType';

// Hooks — AES Key Provider Abstraction
export { useAesKeyProvider } from './hooks/useAesKeyProvider';
export type { AesKeyProviderResult } from './hooks/useAesKeyProvider';

// Components — Onboarding
export { OnboardModal } from './components/OnboardModal';
export type { OnboardModalProps } from './components/OnboardModal';

// Re-export from RainbowKit for consuming apps
export { useConnectModal } from '@rainbow-me/rainbowkit';

// Utilities
export { isMultipleWalletsError, MULTIPLE_WALLETS_ERROR_SUBSTRING } from './utils/walletErrors';
export { formatTokenBalanceDisplay, truncateDecimalValue, formatBalanceWithNotation, addThousandsSeparators } from './lib/utils';
export { getEthereumProvider } from './lib/ethereum';
export type { EIP1193Provider } from './lib/ethereum';


