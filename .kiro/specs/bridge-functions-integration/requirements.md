# Requirements Document

## Introduction

This feature integrates cross-chain bridge functionality from the `coti-bridge` application into the `coti-wallet-plugin` library. The cross-chain bridge enables token transfers between COTI and Ethereum networks (COTI ↔ Ethereum), which is fundamentally different from the existing privacy bridge that moves tokens between public and private states on the same COTI chain. The integration exposes reusable React hooks and utility functions for cross-chain bridge operations, transaction tracking, limits management, wallet status, and network management.

## Glossary

- **Cross_Chain_Bridge**: The system responsible for transferring tokens between COTI and Ethereum networks via native token transfers and ERC20 transfers to designated recipient addresses
- **Privacy_Bridge**: The existing system that moves tokens between public and private states on the same COTI chain (already implemented in coti-wallet-plugin)
- **Tracking_Service**: An external API that provides real-time progress updates for cross-chain bridge transactions through defined stages (Detect → Cap → Build → Dispatch)
- **Cap_Meter_API**: An external API that provides user-specific daily limits and global daily limits for cross-chain bridge operations
- **Bridge_Token_Config**: A configuration object defining token addresses, decimals, and recipient addresses for each supported token on both COTI and Ethereum chains
- **Chain_Pair**: A combination of source and destination chains (e.g., COTI Testnet ↔ Ethereum Sepolia, COTI Mainnet ↔ Ethereum Mainnet) resolved dynamically based on environment
- **Transaction_Step**: A discrete stage in the cross-chain bridge process: Detect, Cap, Build, or Dispatch
- **Wallet_Status**: A composite state representing wallet connection, chain validity, and network switching capability
- **Plugin_Consumer**: A React application that imports and uses the coti-wallet-plugin library

## Requirements

### Requirement 1: Cross-Chain Bridge Transaction Execution

**User Story:** As a Plugin_Consumer developer, I want to execute cross-chain bridge transactions through the plugin, so that I can transfer tokens between COTI and Ethereum networks without implementing low-level transaction logic.

#### Acceptance Criteria

1. WHEN a Plugin_Consumer initiates a native token bridge transfer, THE Cross_Chain_Bridge SHALL send the specified amount to the configured recipient address on the source chain using wagmi's `useSendTransaction` hook
2. WHEN a Plugin_Consumer initiates an ERC20 token bridge transfer, THE Cross_Chain_Bridge SHALL execute a transfer to the configured recipient address on the source chain using wagmi's `useWriteContract` hook
3. IF a bridge transfer amount exceeds the user's remaining daily limit as reported by the Cap_Meter_API, THEN THE Cross_Chain_Bridge SHALL reject the transaction without submitting it on-chain and return an error indicating the daily limit violation and the remaining allowance
4. IF a bridge transfer amount is below the minimum allowed amount defined in the Bridge_Token_Config for that token, THEN THE Cross_Chain_Bridge SHALL reject the transaction without submitting it on-chain and return an error indicating the minimum threshold and the required minimum value
5. IF the user's wallet balance on the source chain is less than the specified transfer amount plus estimated gas cost, THEN THE Cross_Chain_Bridge SHALL reject the transaction without submitting it on-chain and return an error indicating insufficient balance
6. WHEN a bridge transaction is submitted, THE Cross_Chain_Bridge SHALL estimate gas for the transaction before execution and apply a gas buffer multiplier of 1.2x (120%) to the estimated gas value
7. IF gas estimation fails, THEN THE Cross_Chain_Bridge SHALL fall back to a gas limit of 12,000,000 units and proceed with the transaction
8. THE Cross_Chain_Bridge SHALL expose a React hook (`useCrossChainBridge`) that returns: a `bridgeNative` function, a `bridgeERC20` function, an `isLoading` boolean, an `error` object (or null), and a `txHash` string (or null) representing the submitted transaction hash

### Requirement 2: Bridge Transaction Tracking

**User Story:** As a Plugin_Consumer developer, I want to track the progress of cross-chain bridge transactions, so that I can display real-time status updates to users.

#### Acceptance Criteria

1. WHEN a transaction hash, source network ID, and destination network ID are provided, THE Tracking_Service client SHALL poll the tracking endpoint at a configurable interval (default: 10 seconds) and return the current Transaction_Step, where COTI-source transactions progress through 4 steps (Detect, Cap, Build, Dispatch) and Ethereum-source transactions progress through 3 steps (Detect, Build, Dispatch)
2. WHEN the Tracking_Service returns a completed status with a destination transaction hash, THE Tracking_Service client SHALL include the destination chain transaction hash in the response and stop polling
3. IF the Tracking_Service returns a terminal failure status (failed or refunded), THEN THE Tracking_Service client SHALL include the failure reason in the response, indicate the failed step number, and stop polling
4. WHEN polling is active, THE Tracking_Service client SHALL continue polling until the transaction reaches a terminal state (done, failed, or refunded)
5. IF the Tracking_Service endpoint returns a network error or non-success HTTP status during polling, THEN THE Tracking_Service client SHALL propagate the error to the caller without stopping the polling cycle
6. THE Tracking_Service client SHALL expose a React hook (`useTransactionTracking`) that accepts a transaction hash, source network ID, and destination network ID, and returns current step number, destination hash, failure reason, failed step number, fee, loading state, and error state

### Requirement 3: Bridge Transaction History

**User Story:** As a Plugin_Consumer developer, I want to fetch paginated bridge transaction history, so that I can display past cross-chain bridge operations to users.

#### Acceptance Criteria

1. WHEN a wallet address and pagination parameters (page number and page size between 1 and 50) are provided, THE Cross_Chain_Bridge SHALL fetch the corresponding page of transaction history from the tracking API for that address and return the results ordered by most recent first
2. WHEN transaction history is fetched successfully, THE Cross_Chain_Bridge SHALL enrich each transaction record with its current Transaction_Step (Detect, Cap, Build, or Dispatch), completion status, and destination chain transaction hash if available from the Tracking_Service
3. WHEN cached transaction data exists and was retrieved less than 30 seconds ago, THE Cross_Chain_Bridge SHALL return cached data without making a network request
4. IF the tracking API request fails or returns a non-success response, THEN THE Cross_Chain_Bridge SHALL return an error state with a descriptive error message and preserve any previously cached data
5. THE Cross_Chain_Bridge SHALL expose a React hook (`useBridgeTransactions`) that accepts a wallet address, page size, and page number, and returns transaction records, total count, loading state, and error state
6. IF the provided wallet address is empty or undefined, THEN THE Cross_Chain_Bridge SHALL not make a network request and SHALL return an empty transaction list with a total count of zero

### Requirement 4: Bridge Limits Management

**User Story:** As a Plugin_Consumer developer, I want to query user-specific and global daily bridge limits, so that I can validate transfer amounts and display remaining capacity to users.

#### Acceptance Criteria

1. WHEN a wallet address and token identifier are provided, THE Cap_Meter_API client SHALL fetch the user's remaining daily limit for that token and return the value as a numeric string in human-readable token units
2. WHEN a token identifier is provided, THE Cap_Meter_API client SHALL fetch the global remaining daily limit for that token and return the value as a numeric string in human-readable token units
3. WHILE the limits hook is mounted, THE Cap_Meter_API client SHALL auto-refresh limit data at a configurable polling interval that defaults to 30 seconds
4. IF the Cap_Meter_API request fails or the service is unreachable, THEN THE Cap_Meter_API client SHALL set the error state with a descriptive message and retain the last successfully fetched limit values
5. IF the provided token identifier does not match a supported cross-chain bridge token, THEN THE Cap_Meter_API client SHALL return zero for both user and global limits and set the error state indicating an unsupported token
6. THE Cap_Meter_API client SHALL expose a React hook (`useBridgeLimits`) that accepts a wallet address and token identifier, and returns user daily limit, global daily limit, loading state, and error state

### Requirement 5: Wallet Status Management

**User Story:** As a Plugin_Consumer developer, I want comprehensive wallet status information including chain validation and network switching, so that I can guide users to the correct network before initiating bridge operations.

#### Acceptance Criteria

1. THE Wallet_Status hook SHALL report whether the connected wallet's current chain ID matches one of the valid chains for cross-chain bridge operations as determined by the active Chain_Pair for the current environment (testnet: COTI Testnet and Ethereum Sepolia; mainnet: COTI Mainnet and Ethereum Mainnet)
2. WHEN the connected wallet is on an invalid chain, THE Wallet_Status hook SHALL provide a function to switch to a specified valid chain using wagmi's `useSwitchChain` hook
3. IF the chain switch function is invoked and the switch fails or is rejected by the user, THEN THE Wallet_Status hook SHALL return an error state indicating the failure reason without altering the current chain ID or connection status
4. THE Wallet_Status hook SHALL report the current connection status as a boolean, the connected address as a hex string or empty string when disconnected, and the current chain ID as a number or null when disconnected
5. WHEN the wallet disconnects, THE Wallet_Status hook SHALL reset connection status to false, address to empty string, chain ID to null, and chain validity to false
6. THE Wallet_Status hook SHALL expose a React hook (`useWalletStatus`) that returns connection status, address, chain ID, chain validity, switch chain function, switch error state, and disconnect function

### Requirement 6: Cross-Chain Token Configuration

**User Story:** As a Plugin_Consumer developer, I want access to cross-chain token configurations with per-network addresses and recipient addresses, so that I can correctly construct bridge transactions for supported tokens.

#### Acceptance Criteria

1. THE Cross_Chain_Bridge SHALL provide token configuration objects for COTI and gCOTI tokens on both COTI and Ethereum chains, where each configuration includes: token ID, symbol, name, contract address (or native token sentinel address 0x0000...0000 for native COTI), decimals, and bridge recipient address
2. THE Cross_Chain_Bridge SHALL differentiate token configurations by environment (testnet vs mainnet) and resolve the correct addresses based on the active Chain_Pair, where testnet uses COTI Testnet (chain ID 7082400) paired with Ethereum Sepolia (chain ID 11155111) and mainnet uses COTI Mainnet (chain ID 2632500) paired with Ethereum Mainnet (chain ID 1)
3. WHEN a Plugin_Consumer requests token configuration for an unsupported token ID or an unsupported chain ID, THE Cross_Chain_Bridge SHALL return undefined and not throw an error
4. THE Cross_Chain_Bridge SHALL provide a function (`getCrossChainTokenConfig`) that accepts a token ID and chain ID, and returns the token configuration object or undefined

### Requirement 7: Network Management

**User Story:** As a Plugin_Consumer developer, I want utility functions for dynamic chain pair resolution and validation, so that I can determine valid source/destination chain combinations based on the current environment.

#### Acceptance Criteria

1. THE Cross_Chain_Bridge SHALL provide a function (`getActiveChains`) that returns all valid Chain_Pair combinations for the current environment, where the environment is determined by the connected wallet's chain ID (testnet if connected to COTI Testnet chain ID 7082400 or Ethereum Sepolia chain ID 11155111; mainnet if connected to COTI Mainnet chain ID 2632500 or Ethereum Mainnet chain ID 1)
2. THE Cross_Chain_Bridge SHALL provide a function (`isValidChain`) that accepts a chain ID (number) and returns a boolean indicating whether the chain is valid for cross-chain bridge operations in the current environment; the function SHALL return `false` for any chain ID not belonging to the active environment's Chain_Pair
3. THE Cross_Chain_Bridge SHALL provide a function (`getActiveChainById`) that accepts a chain ID (number) and returns the chain configuration object containing chain ID, network name, RPC URL, block explorer URL, and testnet flag, or `undefined` if the chain ID does not match any chain in the current environment's active Chain_Pair
4. THE Cross_Chain_Bridge SHALL provide a function (`getActiveNetworks`) that returns all active network configurations for the current environment only, where each configuration includes chain ID, network name, RPC URL, block explorer URL, and testnet flag
5. WHEN the environment changes between testnet and mainnet, THE Cross_Chain_Bridge SHALL resolve different chain pairs: COTI Testnet (chain ID 7082400) paired with Ethereum Sepolia (chain ID 11155111) for testnet, and COTI Mainnet (chain ID 2632500) paired with Ethereum Mainnet (chain ID 1) for mainnet
6. IF `getActiveChains`, `isValidChain`, `getActiveChainById`, or `getActiveNetworks` is called when no wallet is connected, THEN THE Cross_Chain_Bridge SHALL default to the testnet environment

### Requirement 8: Ongoing Transactions Monitoring

**User Story:** As a Plugin_Consumer developer, I want to monitor all in-progress bridge operations, so that I can display active transaction status across all token and network combinations.

#### Acceptance Criteria

1. WHEN a bridge transaction is initiated, THE Cross_Chain_Bridge SHALL register the transaction in the ongoing transactions registry with its token identifier, source chain ID, destination chain ID, transaction hash, and a timestamp of initiation
2. WHILE a transaction is in progress (not yet reached terminal state), THE Cross_Chain_Bridge SHALL poll the Tracking_Service for status updates at a configurable interval with a default of 10 seconds and a minimum of 5 seconds
3. IF the Tracking_Service is unreachable or returns an error during polling for an ongoing transaction, THEN THE Cross_Chain_Bridge SHALL retain the transaction in the registry, preserve its last known status, and retry at the next polling interval
4. WHEN a transaction reaches a terminal state (completed or failed), THE Cross_Chain_Bridge SHALL remove the transaction from the ongoing registry
5. THE Cross_Chain_Bridge SHALL expose a React hook (`useOngoingTransactions`) that returns a list of all in-progress transactions, where each entry includes the token identifier, source chain ID, destination chain ID, transaction hash, current Transaction_Step (Detect, Cap, Build, or Dispatch), destination transaction hash (if available), failure reason (if failed), and loading state
6. WHEN the `useOngoingTransactions` hook is unmounted and remounted, THE Cross_Chain_Bridge SHALL restore previously registered ongoing transactions that have not yet reached a terminal state

### Requirement 9: Token Amount Utilities

**User Story:** As a Plugin_Consumer developer, I want utility functions for formatting and parsing token amounts with proper decimal handling, so that I can correctly display and submit bridge amounts using viem's bigint-based arithmetic.

#### Acceptance Criteria

1. THE Cross_Chain_Bridge SHALL provide a `formatTokenAmount` function that accepts a bigint value and a decimal count between 0 and 18 inclusive, and returns a decimal string without trailing zeros and without thousands separators (e.g., bigint 1500000 with 6 decimals returns "1.5")
2. THE Cross_Chain_Bridge SHALL provide a `parseTokenAmount` function that accepts a non-negative decimal string containing only digits and at most one decimal point, and a decimal count between 0 and 18 inclusive, and returns the corresponding bigint value
3. IF `parseTokenAmount` receives an empty string, a string containing non-numeric characters other than a single decimal point, or a negative value, THEN THE Cross_Chain_Bridge SHALL throw an error indicating the input is invalid
4. THE Cross_Chain_Bridge SHALL provide a `truncateDecimals` function that accepts a numeric string and a maximum decimal places value between 0 and 18 inclusive, and returns the string truncated to at most that many decimal places without rounding; if the input contains no decimal point, the function SHALL return the input unchanged
5. THE Cross_Chain_Bridge SHALL ensure that for any non-negative bigint value and decimal count between 0 and 18, calling `parseTokenAmount(formatTokenAmount(value, decimals), decimals)` returns the original bigint value (round-trip property)

### Requirement 10: Integration with Existing Plugin Architecture

**User Story:** As a Plugin_Consumer developer, I want the cross-chain bridge functionality to integrate seamlessly with the existing coti-wallet-plugin exports and provider structure, so that I can use both privacy bridge and cross-chain bridge features from a single package.

#### Acceptance Criteria

1. THE Cross_Chain_Bridge SHALL export all new cross-chain bridge hooks, types, utilities, and configuration from the plugin's main entry point (`src/index.ts`), such that every public module added for cross-chain bridge functionality has a corresponding export statement in `src/index.ts`
2. THE Cross_Chain_Bridge SHALL reuse the existing `WagmiRainbowKitProvider` for wallet connectivity by extending its wagmi configuration to include Ethereum Mainnet chain and transport, rather than introducing a separate provider component
3. THE Cross_Chain_Bridge SHALL use wagmi and viem for all cross-chain bridge contract interactions, consistent with the wallet connection layer already present in the plugin, and SHALL NOT introduce additional web3 libraries for contract calls
4. THE Cross_Chain_Bridge SHALL not introduce breaking changes to existing plugin exports or behavior, where a breaking change is defined as: removal of any previously exported symbol, modification of an exported function's parameter signature, or alteration of an exported type's required fields
5. THE Cross_Chain_Bridge SHALL add Ethereum Mainnet (chain ID 1) chain definition alongside the existing COTI Mainnet, COTI Testnet, and Sepolia chain definitions in the chains configuration, and SHALL update the `getRpcUrlForChainId` utility to return the Ethereum Mainnet RPC URL when provided chain ID 1
6. WHEN the `WagmiRainbowKitProvider` is rendered, THE Cross_Chain_Bridge SHALL include Ethereum Mainnet in the wagmi config's `chains` array and provide an HTTP transport mapping for Ethereum Mainnet, enabling cross-chain bridge operations without requiring consumers to configure an additional provider
