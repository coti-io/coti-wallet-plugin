# @coti-io/coti-wallet-plugin

High-level abstraction for **Private Token (pToken) operations** across EIP-1193 wallets on the COTI network.

## Overview

This library sits as middleware between your React/wagmi application and the low-level COTI SDKs (`@coti-io/coti-ethers`, `@coti-io/coti-sdk-typescript`), providing:

- **Key & Onboarding Manager** — Automatic AES key resolution via MetaMask Snap or Onboarding Contract
- **Balance Manager** — Encrypted balance fetching and client-side decryption
- **Transfer Manager** — Encrypted transfer payload construction
- **Bridge Operations** — Privacy Bridge deposit/withdraw with fee estimation

## Installation

```bash
npm install @coti-io/coti-wallet-plugin
```

### Peer Dependencies

```bash
npm install react ethers viem @coti-io/coti-sdk-typescript @metamask/providers
```

## Quick Start

```tsx
import { configureCotiPlugin, PrivacyBridgeProvider } from '@coti-io/coti-wallet-plugin';

// Configure before rendering (optional — defaults work for mainnet)
configureCotiPlugin({
  snapId: 'npm:@coti-io/coti-snap',
  defaultNetworkId: '0x282b34', // COTI Mainnet
});

function App() {
  return (
    <PrivacyBridgeProvider>
      <YourApp />
    </PrivacyBridgeProvider>
  );
}
```

## Core Hooks

### `useSnap`
Manages MetaMask Snap lifecycle — installation check, connection, AES key retrieval.

### `usePrivateERC20`
Fetches and decrypts private ERC20 token balances.

### `useFetchPrivateBalance`
256-bit ciphertext balance decryption for COTI V2 private tokens.

### `usePrivacyBridge`
Full bridge orchestration — deposit (Portal In), withdraw (Portal Out), allowance management.

### `useBridgeData`
Fetches on-chain bridge state (fees, limits, paused status, balances).

### `useEstimateBridgeFees`
On-chain fee estimation for deposit/withdraw operations.

## Security

- **No Persistent Storage** — AES keys are never written to localStorage, sessionStorage, IndexedDB, or cookies
- **Ephemeral State** — Keys exist only in React memory and are discarded on page refresh or account change
- **Multi-Wallet Compatible** — Works with MetaMask Snap path and generic EIP-1193 onboarding

## Architecture

See [docs/architecture.md](./docs/architecture.md) for the full design document.

## License

Apache-2.0
