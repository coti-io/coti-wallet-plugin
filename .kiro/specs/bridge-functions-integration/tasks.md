# Implementation Plan: Cross-Chain Bridge Functions Integration

## Overview

This plan implements cross-chain bridge functionality (COTI ↔ Ethereum token transfers) into the existing `coti-wallet-plugin` library. The implementation adds new hooks, utility functions, token configurations, and extends the existing provider/chain infrastructure to support Ethereum Mainnet. All code uses TypeScript with wagmi/viem for contract interactions and React hooks for stateful logic.

## Tasks

- [x] 1. Extend chain configuration and provider infrastructure
  - [x] 1.1 Add Ethereum Mainnet chain definition and update `getRpcUrlForChainId`
    - Add `ethereumMainnet` chain definition using viem's `defineChain` in `src/config/chains.ts`
    - Export `ETHEREUM_MAINNET_CHAIN_ID` (1) and `ETHEREUM_MAINNET_RPC` constants
    - Update `getRpcUrlForChainId` to return Ethereum Mainnet RPC URL for chain ID 1
    - _Requirements: 10.5_

  - [x] 1.2 Extend `WagmiRainbowKitProvider` with Ethereum Mainnet support
    - Import `ethereumMainnet` and `ETHEREUM_MAINNET_RPC` in `src/providers/WagmiRainbowKitProvider.tsx`
    - Add `ethereumMainnet` to the `chains` array in `createWagmiConfig`
    - Add HTTP transport mapping for `ethereumMainnet.id` using `ETHEREUM_MAINNET_RPC`
    - _Requirements: 10.2, 10.6_

  - [x] 1.3 Extend `src/config/networks.ts` with Ethereum chains
    - Add Ethereum Mainnet (chain ID 1) and Sepolia (chain ID 11155111) entries to `NETWORK_CONFIGS`
    - Each entry includes chainId, networkName, rpcUrl, explorerUrl, and isTestnet flag
    - _Requirements: 7.3, 7.4_

- [x] 2. Implement cross-chain token configuration and utilities
  - [x] 2.1 Create `src/config/crossChainTokens.ts` with token configurations
    - Define `CrossChainTokenConfig` interface (tokenId, symbol, name, contractAddress, decimals, recipientAddress)
    - Define `CROSS_CHAIN_TOKENS` record keyed by environment (testnet/mainnet), then token ID, then chain ID
    - Include COTI and gCOTI token configs for all chain pairs (COTI Testnet/Sepolia, COTI Mainnet/Ethereum Mainnet)
    - Implement `getCrossChainTokenConfig(tokenId, chainId)` that returns config or `undefined`
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 2.2 Create `src/lib/crossChainUtils.ts` with token amount utilities
    - Implement `formatTokenAmount(value: bigint, decimals: number): string` — formats bigint to decimal string without trailing zeros
    - Implement `parseTokenAmount(value: string, decimals: number): bigint` — parses decimal string to bigint, throws on invalid input
    - Implement `truncateDecimals(value: string, maxDecimals: number): string` — truncates without rounding
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 2.3 Add network management functions to `src/lib/crossChainUtils.ts`
    - Define `ChainConfig` and `ChainPair` interfaces
    - Define `CHAIN_PAIRS` constant with testnet and mainnet chain pair configurations
    - Implement `getActiveChains(connectedChainId?)` — returns chain pairs for current environment, defaults to testnet
    - Implement `isValidChain(chainId, connectedChainId?)` — returns boolean for chain validity in current environment
    - Implement `getActiveChainById(chainId, connectedChainId?)` — returns ChainConfig or undefined
    - Implement `getActiveNetworks(connectedChainId?)` — returns all active ChainConfig objects
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 2.4 Write property tests for token amount round-trip
    - **Property 1: Token Amount Round-Trip**
    - For any non-negative bigint `v` and decimals `d` (0-18): `parseTokenAmount(formatTokenAmount(v, d), d) === v`
    - **Validates: Requirements 9.5**

  - [ ]* 2.5 Write property tests for chain pair consistency
    - **Property 2: Chain Pair Consistency**
    - For any chain in active pairs: `isValidChain(chainId) === true` and `getActiveChainById(chainId) !== undefined`
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [ ]* 2.6 Write unit tests for token configuration
    - **Property 3: Token Config Completeness**
    - Verify all returned configs have valid 0x-prefixed 42-char addresses and decimals 0-18
    - Test `getCrossChainTokenConfig` returns undefined for unsupported token/chain combinations
    - **Validates: Requirements 6.1, 6.3**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement bridge limits and wallet status hooks
  - [x] 4.1 Create `src/hooks/useBridgeLimits.ts`
    - Implement `useBridgeLimits(walletAddress: string, tokenId: string)` hook
    - Fetch user daily limit and global daily limit from Cap Meter API
    - Auto-refresh at configurable polling interval (default 30 seconds)
    - On API failure, retain last successful values and set error state
    - Return zero limits with error for unsupported token IDs
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

  - [x] 4.2 Create `src/hooks/useWalletStatus.ts`
    - Implement `useWalletStatus()` hook using wagmi's `useAccount`, `useSwitchChain`, `useDisconnect`
    - Report chain validity by checking if current chain ID is in active Chain_Pair
    - Provide `switchChain` function that wraps wagmi's switch and captures errors
    - Report connection status, address, chainId, and handle disconnect state reset
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 4.3 Write unit tests for `useBridgeLimits` and `useWalletStatus`
    - Test polling behavior, error retention, and unsupported token handling for limits
    - Test chain validation, switch error handling, and disconnect reset for wallet status
    - **Validates: Requirements 4.1-4.6, 5.1-5.6**

- [x] 5. Implement cross-chain bridge transaction execution
  - [x] 5.1 Create `src/hooks/useCrossChainBridge.ts`
    - Implement `useCrossChainBridge()` hook
    - Implement `bridgeNative(amount, tokenId)` using wagmi's `useSendTransaction` — sends native token to configured recipient
    - Implement `bridgeERC20(amount, tokenId, tokenAddress)` using wagmi's `useWriteContract` — calls ERC20 transfer to configured recipient
    - Pre-validate: check daily limit via Cap Meter API, check minimum amount from token config, check wallet balance vs amount + gas
    - Estimate gas with 1.2x buffer; fall back to 12,000,000 gas limit on estimation failure
    - Return `isLoading`, `error` (with typed error codes), and `txHash`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [ ]* 5.2 Write unit tests for `useCrossChainBridge`
    - Mock wagmi hooks to test native and ERC20 bridge flows
    - Test pre-validation rejections (daily limit, minimum amount, insufficient balance)
    - Test gas estimation fallback behavior
    - **Validates: Requirements 1.1-1.8**

- [x] 6. Implement transaction tracking and history hooks
  - [x] 6.1 Create `src/hooks/useTransactionTracking.ts`
    - Implement `useTransactionTracking(txHash, sourceNetworkId, destinationNetworkId)` hook
    - Poll tracking endpoint at configurable interval (default 10 seconds)
    - Handle COTI-source (4 steps) and Ethereum-source (3 steps) transaction flows
    - Stop polling on terminal states (done, failed, refunded)
    - Propagate network errors without stopping polling cycle
    - Return currentStep, destinationHash, failureReason, failedStep, fee, isLoading, error
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

  - [x] 6.2 Create `src/hooks/useBridgeTransactions.ts`
    - Implement `useBridgeTransactions(walletAddress, pageSize, pageNumber)` hook
    - Fetch paginated transaction history from tracking API (page size 1-50)
    - Enrich each transaction with current step, completion status, and destination hash
    - Cache results for 30 seconds; return cached data if fresh
    - Return empty list for empty/undefined wallet address without making network request
    - Preserve cached data on API failure
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 6.3 Write unit tests for transaction tracking and history
    - Test polling start/stop behavior, terminal state handling, error propagation
    - Test pagination, caching, enrichment, and empty address handling
    - **Property 5: Transaction Step Monotonicity** — verify steps never decrease across polls
    - **Validates: Requirements 2.1-2.6, 3.1-3.6**

- [x] 7. Implement ongoing transactions monitoring
  - [x] 7.1 Create `src/hooks/useOngoingTransactions.ts`
    - Implement module-level `ongoingRegistry` Map for persistence across mount/unmount
    - Implement `registerTransaction(tx)` to add transactions to registry
    - Implement `useOngoingTransactions()` hook that polls tracking service for all registered transactions
    - Remove transactions from registry when they reach terminal state (done, failed, refunded)
    - Restore previously registered transactions on remount
    - Configurable polling interval (default 10s, minimum 5s)
    - Retain last known status on tracking service errors
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 7.2 Write unit tests for ongoing transactions
    - Test registry add/remove lifecycle
    - Test persistence across hook unmount/remount
    - Test error handling and status retention
    - **Property 6: Ongoing Registry Terminal Removal** — verify terminal transactions are removed
    - **Validates: Requirements 8.1-8.6**

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Wire exports and final integration
  - [x] 9.1 Update `src/index.ts` with all new exports
    - Export `useCrossChainBridge` and `BridgeError` type from hooks
    - Export `useTransactionTracking` and `UseTransactionTrackingResult` type
    - Export `useBridgeTransactions`, `BridgeTransaction`, and `UseBridgeTransactionsResult` types
    - Export `useBridgeLimits` and `UseBridgeLimitsResult` type
    - Export `useWalletStatus` and `UseWalletStatusResult` type
    - Export `useOngoingTransactions`, `OngoingTransaction`, and `UseOngoingTransactionsResult` types
    - Export `formatTokenAmount`, `parseTokenAmount`, `truncateDecimals` from utilities
    - Export `getActiveChains`, `isValidChain`, `getActiveChainById`, `getActiveNetworks` from utilities
    - Export `getCrossChainTokenConfig` and `CrossChainTokenConfig` type from config
    - Export `ChainConfig`, `ChainPair` types
    - Export `ethereumMainnet`, `ETHEREUM_MAINNET_CHAIN_ID`, `ETHEREUM_MAINNET_RPC` from chains
    - _Requirements: 10.1, 10.4_

  - [x] 9.2 Verify no breaking changes to existing exports
    - Ensure all previously exported symbols remain unchanged
    - Verify existing function signatures and type definitions are unmodified
    - Run TypeScript compilation to confirm no type errors
    - _Requirements: 10.3, 10.4_

  - [ ]* 9.3 Write integration tests for cross-chain bridge flows
    - Test end-to-end bridge native flow with mocked wagmi hooks
    - Test end-to-end bridge ERC20 flow with mocked wagmi hooks
    - Test transaction tracking lifecycle from initiation to completion
    - Test ongoing transactions registry integration with tracking
    - **Validates: Requirements 1.1, 1.2, 2.1, 8.1, 10.1**

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All hooks use wagmi/viem consistent with existing plugin patterns
- The module-level ongoing transaction registry persists across hook mount/unmount within the same session
- Ethereum Mainnet is added to the existing provider without breaking current COTI-only functionality

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2"] },
    { "id": 2, "tasks": ["2.3", "2.4", "2.5", "2.6"] },
    { "id": 3, "tasks": ["4.1", "4.2"] },
    { "id": 4, "tasks": ["4.3", "5.1"] },
    { "id": 5, "tasks": ["5.2", "6.1", "6.2"] },
    { "id": 6, "tasks": ["6.3", "7.1"] },
    { "id": 7, "tasks": ["7.2"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["9.2", "9.3"] }
  ]
}
```
