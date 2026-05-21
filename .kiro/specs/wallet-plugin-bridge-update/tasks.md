# Implementation Plan: Wallet Plugin Bridge Update

## Overview

This plan implements the multi-wallet support update for `@coti-io/coti-wallet-plugin`, adding RainbowKit + wagmi v2 as a wallet connection layer while preserving the existing MetaMask + Snap flow. The implementation follows a bottom-up approach: dependencies and configuration first, then core hooks, then context integration, then UI components, and finally bridge contract updates.

## Tasks

- [x] 1. Update dependencies and project configuration
  - [x] 1.1 Update package.json with new peer dependencies
    - Add `@rainbow-me/rainbowkit` ^2.0.0, `wagmi` ^2.0.0, `@tanstack/react-query` ^5.0.0 to peerDependencies
    - Add corresponding devDependencies for local development
    - Add `@coti-io/coti-ethers` as a dependency for the onboard contract flow
    - _Requirements: 13.1_

- [x] 2. Create WagmiRainbowKitProvider component
  - [x] 2.1 Create `src/providers/WagmiRainbowKitProvider.tsx`
    - Create wagmi config with `createConfig` using COTI Mainnet and Testnet chains
    - Configure `injected()`, `coinbaseWallet()`, and `walletConnect()` connectors
    - Read WalletConnect project ID from `VITE_WALLETCONNECT_PROJECT_ID` env variable
    - Configure HTTP transports for both COTI chains using their RPC URLs
    - Wrap children with `QueryClientProvider`, `WagmiProvider`, and `RainbowKitProvider`
    - Export the `wagmiConfig` for consuming apps that need direct wagmi access
    - Accept optional `walletConnectProjectId` prop as override
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 13.2, 13.3_

  - [ ]* 2.2 Write unit tests for WagmiRainbowKitProvider
    - Test that the component renders without error
    - Test that wagmi context is provided to children
    - Test that config contains both COTI chains and all three connectors
    - _Requirements: 1.2, 1.3_

- [x] 3. Implement useWalletType hook
  - [x] 3.1 Create `src/hooks/useWalletType.ts`
    - Import `useAccount` from wagmi
    - Define `WalletType` union type: `'metamask' | 'coinbase' | 'walletconnect' | 'rainbow' | 'unknown'`
    - Define `WalletTypeInfo` interface with `isMetaMaskWithSnap`, `walletType`, `connectorId`
    - Implement static mapping from `connector.id` to `WalletType`
    - When `walletType === 'metamask'`, perform async Snap installation check via `wallet_getSnaps`
    - Return `{ isMetaMaskWithSnap: false, walletType: 'unknown', connectorId: undefined }` when no connector
    - Memoize result to avoid re-render loops
    - Use `connector.id` (wagmi-controlled) — NOT `window.ethereum.isMetaMask`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 6.1, 6.2, 6.3_

  - [ ]* 3.2 Write property test for useWalletType — wallet type mapping determinism
    - **Property 1: Wallet type mapping determinism**
    - Generate random connector.id strings, verify deterministic mapping
    - If connector.id contains "metaMask", walletType must be 'metamask'
    - If connector.id does not contain "metaMask", isMetaMaskWithSnap must be false
    - For unknown connector.id values, walletType must be 'unknown'
    - **Validates: Requirements 2.2, 2.4**

  - [ ]* 3.3 Write unit tests for useWalletType
    - Test correct type for each known connector.id ('metaMask', 'coinbaseWalletSDK', 'walletConnect', 'rainbow')
    - Test handling of undefined connector
    - Test that isMetaMaskWithSnap defaults to false until async check resolves
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 4. Implement useAesKeyProvider hook
  - [x] 4.1 Create `src/hooks/useAesKeyProvider.ts`
    - Accept `WalletTypeInfo` as parameter
    - Implement `getAesKey(address: string): Promise<string | null>` function
    - When `isMetaMaskWithSnap === true`: delegate to existing `getAESKeyFromSnap(address)`
    - When `isMetaMaskWithSnap === false`: use wagmi `useConnectorClient()` to get EIP-1193 provider, create `@coti-io/coti-ethers` BrowserProvider, get signer, call `signer.generateOrRecoverAes()`
    - Retrieve AES key from `signer.getUserOnboardInfo()?.aesKey`
    - Expose `isOnboarding` boolean state (true during async generateOrRecoverAes call)
    - Expose `onboardingError` string state (cleared on next retrieval attempt)
    - On EIP-1193 error code 4001 (user rejected): return null without throwing
    - Validate AES key format: must be 64-char hex (`/^[0-9a-fA-F]{64}$/`)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 4.2 Write property test for useAesKeyProvider — AES key format invariant
    - **Property 2: AES key format invariant**
    - Mock key retrieval to return various strings
    - Verify all non-null returns are exactly 64 characters and match `/^[0-9a-fA-F]{64}$/`
    - **Validates: Requirements 3.1**

  - [ ]* 4.3 Write unit tests for useAesKeyProvider
    - Test routing to Snap when `isMetaMaskWithSnap=true`
    - Test routing to onboard contract when `isMetaMaskWithSnap=false`
    - Test that user rejection (code 4001) returns null
    - Test that `isOnboarding` is true during async call
    - Test that `onboardingError` is set on failure and cleared on next attempt
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 3.7_

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Modify PrivacyBridgeContext to integrate wagmi
  - [x] 6.1 Update `src/context/PrivacyBridgeContext.tsx` to use wagmi useAccount
    - Import `useAccount` from wagmi
    - Derive `isConnected` and `walletAddress` from wagmi `useAccount` when connected via RainbowKit
    - Integrate `useWalletType()` hook for wallet detection
    - Integrate `useAesKeyProvider()` for AES key retrieval (replaces direct `getAESKeyFromSnap` calls for non-MetaMask wallets)
    - Add `useEffect` on wagmi `address` changes to clear `sessionAesKey` and set `arePrivateBalancesHidden` to true
    - Preserve existing `handleConnect` for backward-compatible MetaMask-only connection
    - Maintain dual connection strategy: MetaMask path (existing) + RainbowKit path (wagmi useAccount)
    - Both paths converge at `sessionAesKey` management
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 5.3, 5.4_

  - [ ]* 6.2 Write property test for session key cleared on state change
    - **Property 3: Session key cleared on state-changing events**
    - Generate random sequences of connect/disconnect/account-change events
    - Verify sessionAesKey is always null after clearing events (disconnect, account change, manual lock)
    - Verify arePrivateBalancesHidden is true after clearing events
    - **Validates: Requirements 4.3, 5.3, 5.4, 5.5**

  - [ ]* 6.3 Write property test for AES key never persisted to browser storage
    - **Property 4: AES key never persisted to browser storage**
    - After any key retrieval operation, scan localStorage and sessionStorage for the key value
    - Verify the key does NOT appear in any browser storage mechanism
    - **Validates: Requirements 5.1, 5.2**

  - [ ]* 6.4 Write unit tests for PrivacyBridgeContext wagmi integration
    - Test that wagmi connection updates isConnected and walletAddress
    - Test that disconnect clears sessionAesKey
    - Test that account change clears sessionAesKey
    - Test backward compatibility of handleConnect
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 7. Create OnboardModal component
  - [x] 7.1 Create `src/components/OnboardModal.tsx`
    - Implement `OnboardModalProps` interface with `isOpen`, `onClose`, `onConfirm`, `isLoading`, `error`, `walletType`
    - Render idle state: explain that a signature is needed for AES key retrieval via COTI onboarding contract
    - Render loading state: show spinner while `generateOrRecoverAes()` is in progress
    - Render error state: show error message with retry button
    - Auto-close on success (when context has `sessionAesKey` set)
    - Leave `sessionAesKey` as null if user closes without completing onboarding
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 7.2 Write unit tests for OnboardModal
    - Test rendering of loading, error, and idle states
    - Test that onClose leaves sessionAesKey as null
    - Test that retry button triggers onConfirm
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 8. Update bridge contract interface with oracle timestamps
  - [x] 8.1 Update `src/hooks/usePrivacyBridge.ts` to pass oracle timestamps
    - Modify `executeTransaction` to call `estimateBridgeFee` before submitting transactions
    - Extract `cotiLastUpdated` and `tokenLastUpdated` from fee estimation result
    - For native COTI deposit: call `deposit(cotiOracleTimestamp, tokenOracleTimestamp)` with `{ value: amountWei + cotiFee }`
    - For ERC20 deposit: call `deposit(amount, cotiOracleTimestamp, tokenOracleTimestamp)` with `{ value: cotiFee }`
    - For withdraw: call `withdraw(amount, cotiOracleTimestamp, tokenOracleTimestamp)`
    - Handle `OracleTimestampMismatch` revert by re-fetching timestamps and retrying once
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ]* 8.2 Write property test for fee estimation precedes bridge transaction
    - **Property 5: Fee estimation precedes bridge transaction**
    - Mock bridge operations, verify estimation is always called before transaction submission
    - Verify timestamps passed to contract match those returned by estimation call
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**

  - [ ]* 8.3 Write unit tests for bridge contract interface
    - Test correct ABI encoding for native deposit with oracle timestamps
    - Test correct ABI encoding for ERC20 deposit with oracle timestamps
    - Test correct ABI encoding for withdraw with oracle timestamps
    - Test OracleTimestampMismatch retry logic
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 9. Update contract addresses configuration
  - [x] 9.1 Update `src/contracts/config.ts` with latest deployed addresses
    - Update bridge addresses for COTI Testnet (chain ID 7082400) to match portal-bridge-scripts deployment
    - Update bridge addresses for COTI Mainnet (chain ID 2632500) to match portal-bridge-scripts deployment
    - Ensure `CotiPriceConsumer` oracle address is present for both networks
    - Update private token addresses for Mainnet to match latest deployment
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 10. Extend network enforcement for multi-wallet
  - [x] 10.1 Update `src/hooks/useNetworkEnforcer.ts` to support wagmi useSwitchChain
    - Import `useSwitchChain` from wagmi
    - For MetaMask path: continue using existing `switchNetwork` via `wallet_switchEthereumChain`
    - For non-MetaMask path: use wagmi `useSwitchChain` hook for chain switching
    - Both paths enforce COTI Mainnet or Testnet only
    - _Requirements: 12.1, 12.2, 12.3_

  - [ ]* 10.2 Write unit tests for network enforcement
    - Test MetaMask uses existing enforcer
    - Test non-MetaMask uses wagmi useSwitchChain
    - Test network mismatch warning on rejection
    - _Requirements: 12.1, 12.2, 12.3_

- [x] 11. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Update exports and wire components together
  - [x] 12.1 Update `src/index.ts` with new exports
    - Export `WagmiRainbowKitProvider` from `./providers/WagmiRainbowKitProvider`
    - Export `useWalletType` and `WalletTypeInfo` type from `./hooks/useWalletType`
    - Export `useAesKeyProvider` and `AesKeyProviderResult` type from `./hooks/useAesKeyProvider`
    - Export `OnboardModal` and `OnboardModalProps` type from `./components/OnboardModal`
    - Export `wagmiConfig` for consuming apps needing direct wagmi access
    - Export `useConnectModal` re-export from `@rainbow-me/rainbowkit` for consuming apps
    - Continue exporting all existing symbols for backward compatibility
    - _Requirements: 7.4, 11.4, 13.3_

  - [x] 12.2 Verify backward compatibility of existing exports
    - Ensure `useSnap`, `useMetamask`, `signIT256ViaSnap`, `onboardUser` remain exported
    - Ensure `useWallet`, `usePrivacyBridge`, `PrivacyBridgeProvider` remain exported
    - Ensure all existing type exports are preserved
    - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- The implementation uses TypeScript throughout, matching the existing codebase
- The existing MetaMask + Snap flow is preserved unchanged (Requirement 7)
- AES keys are NEVER persisted to browser storage — React state only (Requirement 5)
- wagmi `connector.id` is used for wallet detection — NOT `window.ethereum.isMetaMask` (Requirement 6)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "9.1"] },
    { "id": 2, "tasks": ["2.2", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "7.1", "8.1"] },
    { "id": 5, "tasks": ["6.1", "7.2", "8.2", "8.3", "10.1"] },
    { "id": 6, "tasks": ["6.2", "6.3", "6.4", "10.2"] },
    { "id": 7, "tasks": ["12.1", "12.2"] }
  ]
}
```
