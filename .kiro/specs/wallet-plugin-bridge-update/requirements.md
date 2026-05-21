# Requirements Document

## Introduction

This document specifies the requirements for updating `@coti-io/coti-wallet-plugin` to support the new portal-bridge architecture. The update adds RainbowKit + wagmi v2 as a wallet connection layer, enabling any EIP-1193 wallet (Rainbow, Coinbase, WalletConnect, etc.) to connect and interact with the COTI Privacy Bridge. For non-MetaMask wallets, AES key retrieval uses the `@coti-io/coti-ethers` onboarding contract flow (`signer.generateOrRecoverAes()`) instead of the MetaMask Snap. The existing MetaMask + Snap path is preserved unchanged.

## Glossary

- **Plugin**: The `@coti-io/coti-wallet-plugin` TypeScript library that provides React hooks for wallet connection, AES key management, balance decryption, and bridge operations
- **Wagmi_Provider**: The wagmi v2 `WagmiProvider` React component that provides wallet connection state and EIP-1193 provider access to child components
- **RainbowKit_Provider**: The `@rainbow-me/rainbowkit` React component that provides a wallet picker modal UI and connection management
- **Wallet_Type_Detector**: The `useWalletType` hook that identifies the connected wallet as MetaMask-with-Snap or a non-Snap wallet using wagmi's `connector.id`
- **AES_Key_Provider**: The `useAesKeyProvider` hook that routes AES key retrieval to either the Snap path or the onboarding contract path based on wallet type
- **Onboard_Contract**: The COTI AccountOnboard smart contract that generates or recovers a user's AES key via an ephemeral RSA key pair exchange
- **Snap_Path**: The existing AES key retrieval flow using MetaMask's `wallet_invokeSnap` → `get-aes-key` method via the COTI Snap
- **Onboard_Path**: The AES key retrieval flow using `@coti-io/coti-ethers` `BrowserProvider` + `signer.generateOrRecoverAes()` for non-MetaMask wallets
- **Session_AES_Key**: The decrypted AES-256 key held exclusively in React component state for the duration of a browser session
- **Privacy_Bridge_Context**: The `PrivacyBridgeContext` React context that manages wallet connection state, AES key lifecycle, and bridge operation state
- **Oracle_Timestamp**: The `cotiOracleTimestamp` and `tokenOracleTimestamp` parameters required by updated bridge contract deposit/withdraw functions
- **Connector_ID**: The stable wallet identifier provided by wagmi (e.g., `metaMask`, `coinbaseWallet`, `walletConnect`) used for wallet type detection

## Requirements

### Requirement 1: Wagmi and RainbowKit Provider Integration

**User Story:** As a developer consuming the plugin, I want a `WagmiRainbowKitProvider` wrapper component exported from the library, so that I can enable multi-wallet support by wrapping my application with a single provider.

#### Acceptance Criteria

1. THE Plugin SHALL export a `WagmiRainbowKitProvider` React component that wraps children with wagmi `WagmiProvider`, `@tanstack/react-query` `QueryClientProvider`, and `RainbowKitProvider`
2. WHEN the `WagmiRainbowKitProvider` is rendered, THE Plugin SHALL configure wagmi with COTI Mainnet (chain ID 2632500) and COTI Testnet (chain ID 7082400) as supported chains
3. WHEN the `WagmiRainbowKitProvider` is rendered, THE Plugin SHALL configure wagmi with `injected()`, `coinbaseWallet()`, and `walletConnect()` connectors
4. WHEN the `walletConnect` connector is configured, THE Plugin SHALL read the WalletConnect project ID from the `VITE_WALLETCONNECT_PROJECT_ID` environment variable
5. THE Plugin SHALL configure HTTP transports for both COTI chains using their respective RPC URLs (`https://mainnet.coti.io/rpc` and `https://testnet.coti.io/rpc`)

### Requirement 2: Wallet Type Detection

**User Story:** As the plugin internals, I want to detect whether the connected wallet is MetaMask with COTI Snap capability or another EIP-1193 wallet, so that AES key retrieval can be routed to the correct path.

#### Acceptance Criteria

1. THE Wallet_Type_Detector SHALL return a `WalletTypeInfo` object containing `isMetaMaskWithSnap` (boolean), `walletType` (union of `metamask`, `coinbase`, `walletconnect`, `rainbow`, `unknown`), and `connectorId` (string or undefined)
2. WHEN the wagmi connector's `connector.id` contains `metaMask`, THE Wallet_Type_Detector SHALL set `walletType` to `metamask` and perform an asynchronous Snap installation check using `wallet_getSnaps`
3. WHEN the Snap installation check confirms the COTI Snap is installed, THE Wallet_Type_Detector SHALL set `isMetaMaskWithSnap` to `true`
4. WHEN the wagmi connector's `connector.id` does not contain `metaMask`, THE Wallet_Type_Detector SHALL set `isMetaMaskWithSnap` to `false`
5. IF the Snap installation check fails or times out, THEN THE Wallet_Type_Detector SHALL set `isMetaMaskWithSnap` to `false` and `walletType` to `metamask`
6. IF no connector is available, THEN THE Wallet_Type_Detector SHALL return `{ isMetaMaskWithSnap: false, walletType: 'unknown', connectorId: undefined }`

### Requirement 3: AES Key Provider Abstraction

**User Story:** As the plugin internals, I want a unified AES key retrieval interface that routes to the Snap or onboarding contract based on wallet type, so that downstream consumers receive the AES key without knowing the retrieval mechanism.

#### Acceptance Criteria

1. THE AES_Key_Provider SHALL expose a `getAesKey(address: string): Promise<string | null>` function that returns a 64-character hexadecimal AES key or null
2. WHEN `isMetaMaskWithSnap` is `true`, THE AES_Key_Provider SHALL delegate to the existing `getAESKeyFromSnap(address)` function without modification
3. WHEN `isMetaMaskWithSnap` is `false`, THE AES_Key_Provider SHALL create a `@coti-io/coti-ethers` `BrowserProvider` from the wagmi connector's EIP-1193 provider, obtain a signer, and call `signer.generateOrRecoverAes()`
4. WHEN the onboarding contract flow completes, THE AES_Key_Provider SHALL retrieve the AES key from `signer.getUserOnboardInfo().aesKey`
5. THE AES_Key_Provider SHALL expose an `isOnboarding` boolean state that is `true` only during the asynchronous `generateOrRecoverAes()` call
6. THE AES_Key_Provider SHALL expose an `onboardingError` string state that captures error messages from failed onboarding attempts and clears on the next retrieval attempt
7. IF the user rejects the wallet signature request (EIP-1193 error code 4001), THEN THE AES_Key_Provider SHALL return `null` without throwing

### Requirement 4: Privacy Bridge Context Wagmi Integration

**User Story:** As a developer consuming the plugin, I want the `PrivacyBridgeContext` to derive connection state from wagmi's `useAccount` hook, so that wallet connection works with any EIP-1193 wallet connected via RainbowKit.

#### Acceptance Criteria

1. WHEN a wallet connects via RainbowKit, THE Privacy_Bridge_Context SHALL update `isConnected` to `true` and `walletAddress` to the connected address using wagmi's `useAccount` hook
2. WHEN a wallet disconnects via RainbowKit, THE Privacy_Bridge_Context SHALL set `isConnected` to `false`, `walletAddress` to empty string, and `sessionAesKey` to `null`
3. WHEN the connected account changes (wagmi `useAccount` address changes), THE Privacy_Bridge_Context SHALL clear `sessionAesKey` to `null` and set `arePrivateBalancesHidden` to `true`
4. THE Privacy_Bridge_Context SHALL delegate AES key retrieval to the AES_Key_Provider instead of calling `getAESKeyFromSnap` directly
5. THE Privacy_Bridge_Context SHALL continue to expose `handleConnect` for backward-compatible MetaMask-only connection alongside the RainbowKit path

### Requirement 5: AES Key Security — Memory-Only Storage

**User Story:** As a security-conscious user, I want my AES key to exist only in React component state and never be persisted to browser storage, so that my private balance decryption key cannot be extracted by malicious scripts or extensions.

#### Acceptance Criteria

1. THE Plugin SHALL store the Session_AES_Key exclusively in React component state (`useState`)
2. THE Plugin SHALL NOT write the Session_AES_Key to `localStorage`, `sessionStorage`, `IndexedDB`, or browser cookies
3. WHEN the user disconnects the wallet, THE Plugin SHALL set Session_AES_Key to `null`
4. WHEN the connected account address changes, THE Plugin SHALL set Session_AES_Key to `null`
5. WHEN the user manually locks private balances, THE Plugin SHALL set Session_AES_Key to `null` and clear the Snap AES key cache
6. WHEN the browser page is refreshed or the tab is closed, THE Plugin SHALL lose the Session_AES_Key automatically through React state destruction

### Requirement 6: Connector Identity Security

**User Story:** As a security-conscious user, I want wallet type detection to use wagmi's stable `connector.id` rather than `window.ethereum.isMetaMask`, so that malicious wallets cannot spoof MetaMask identity to hijack the Snap path.

#### Acceptance Criteria

1. THE Wallet_Type_Detector SHALL use the `connector.id` property from wagmi's `useAccount` hook for wallet identification
2. THE Wallet_Type_Detector SHALL NOT use `window.ethereum.isMetaMask` or any other self-reported provider property for wallet type determination
3. WHEN multiple injected wallets are present, THE Wallet_Type_Detector SHALL rely on wagmi's connector resolution to identify the active wallet

### Requirement 7: Existing MetaMask + Snap Path Preservation

**User Story:** As an existing MetaMask user, I want the current Snap-based AES key retrieval flow to remain unchanged, so that my existing workflow is not disrupted by the multi-wallet update.

#### Acceptance Criteria

1. WHEN a MetaMask wallet with COTI Snap is connected, THE Plugin SHALL retrieve the AES key via `wallet_invokeSnap` → `get-aes-key` using the existing `useSnap` hook logic
2. THE Plugin SHALL NOT modify the `useSnap` hook's internal implementation (retry logic, cache, environment sync, error handling)
3. WHEN the Snap path is used, THE Plugin SHALL continue to support `saveAESKeyToSnap`, `clearSnapCache`, and `syncEnvironment` operations unchanged
4. THE Plugin SHALL continue to export `useSnap`, `useMetamask`, `signIT256ViaSnap`, and `onboardUser` for backward compatibility

### Requirement 8: Onboard Modal for Non-MetaMask Wallets

**User Story:** As a user connecting with a non-MetaMask wallet (Rainbow, Coinbase, WalletConnect), I want a clear explanation of the onboarding signature request, so that I understand why my wallet is asking me to sign a message.

#### Acceptance Criteria

1. WHEN a non-MetaMask wallet user triggers private balance unlock, THE Plugin SHALL display an `OnboardModal` component explaining that a signature is needed to retrieve the AES key via the COTI onboarding contract
2. WHILE the `generateOrRecoverAes()` call is in progress, THE OnboardModal SHALL display a loading state
3. IF the onboarding contract call fails, THEN THE OnboardModal SHALL display the error message and provide a retry option
4. WHEN the user closes the OnboardModal without completing onboarding, THE Plugin SHALL leave `sessionAesKey` as `null`

### Requirement 9: Updated Bridge Contract Interface

**User Story:** As the plugin internals, I want bridge operations to pass oracle timestamp parameters to the updated bridge contracts, so that deposits and withdrawals work with the new dynamic fee system.

#### Acceptance Criteria

1. WHEN a deposit operation is executed on the native COTI bridge, THE Plugin SHALL call `deposit(cotiOracleTimestamp, tokenOracleTimestamp)` with the oracle timestamps obtained from `estimateDepositFee`
2. WHEN a deposit operation is executed on an ERC20 bridge, THE Plugin SHALL call `deposit(amount, cotiOracleTimestamp, tokenOracleTimestamp)` with the oracle timestamps obtained from `estimateDepositFee`
3. WHEN a withdraw operation is executed, THE Plugin SHALL call `withdraw(amount, cotiOracleTimestamp, tokenOracleTimestamp)` with the oracle timestamps obtained from `estimateWithdrawFee`
4. THE Plugin SHALL use the `estimateDepositFee(amount)` and `estimateWithdrawFee(amount)` view functions to obtain both the fee estimate and the oracle timestamps before executing bridge transactions

### Requirement 10: Updated Contract Addresses

**User Story:** As a developer consuming the plugin, I want the contract addresses to match the latest deployed bridge contracts, so that bridge operations interact with the correct on-chain contracts.

#### Acceptance Criteria

1. THE Plugin SHALL use the updated contract addresses for COTI Testnet (chain ID 7082400) as specified in the portal-bridge-scripts deployment configuration
2. THE Plugin SHALL use the updated contract addresses for COTI Mainnet (chain ID 2632500) as specified in the portal-bridge-scripts deployment configuration
3. THE Plugin SHALL include the `CotiPriceConsumer` oracle contract address for both Testnet and Mainnet in the `CONTRACT_ADDRESSES` configuration

### Requirement 11: Dual Connection UI Support

**User Story:** As a user of the COTI Privacy Bridge dApp, I want two distinct connection options — one for MetaMask and one for other wallets via RainbowKit — so that I can choose the wallet that suits me.

#### Acceptance Criteria

1. WHEN the user is not connected, THE Plugin SHALL support rendering both a "Connect MetaMask" button (existing flow) and a "Connect COTI Wallet" button (RainbowKit modal)
2. WHEN the "Connect COTI Wallet" button is activated, THE Plugin SHALL open the RainbowKit wallet picker modal showing available wallets (Coinbase, WalletConnect, Rainbow)
3. WHEN a wallet is connected via either path, THE Plugin SHALL hide both connection buttons and display the connected wallet address
4. THE Plugin SHALL export the `useConnectModal` hook from RainbowKit for consuming applications to trigger the wallet picker

### Requirement 12: Network Enforcement for Multi-Wallet

**User Story:** As a user connecting with a non-MetaMask wallet, I want the plugin to enforce COTI network selection using wagmi's chain switching, so that I am always on the correct network for bridge operations.

#### Acceptance Criteria

1. WHEN a non-MetaMask wallet is connected to an unsupported chain, THE Plugin SHALL use wagmi's `useSwitchChain` hook to prompt the user to switch to a COTI chain
2. THE Plugin SHALL continue to use the existing `useNetworkEnforcer` hook for MetaMask wallets connected via the direct path
3. WHEN the network switch is rejected by the user, THE Plugin SHALL display a network mismatch warning

### Requirement 13: New Dependencies Configuration

**User Story:** As a developer consuming the plugin, I want the plugin to declare its new peer dependencies (`@rainbow-me/rainbowkit`, `wagmi`, `viem`, `@tanstack/react-query`), so that I can install the correct versions.

#### Acceptance Criteria

1. THE Plugin SHALL declare `@rainbow-me/rainbowkit`, `wagmi` v2, `viem`, and `@tanstack/react-query` v5 as peer dependencies
2. THE Plugin SHALL export COTI chain definitions (`cotiMainnet`, `cotiTestnet`) as viem-compatible `Chain` objects for use in wagmi configuration
3. THE Plugin SHALL export the wagmi configuration factory or the pre-built config for consuming applications that need direct wagmi access
