# @coti-io/coti-wallet-plugin

**Important:** This library is a **plugin for existing dApps and wallets**, not a standalone wallet application. It is designed to be injected into your existing React/wagmi stack to seamlessly enhance standard wallets with COTI network privacy capabilities.

 Provides React hooks, multi-wallet support (via wagmi v2 and RainbowKit), and token detection for any EIP-1193 wallet. 

## dApp API contract

dApps should not handle AES keys in the normal integration path. Use the plugin provider/context APIs to connect wallets, onboard/unlock private balances, and execute private operations. The plugin owns AES retrieval, backup restore, Snap storage, and Snap-backed decrypt/encrypt calls internally.

For MetaMask Snap wallets, runtime private operations use Snap RPCs such as decrypt/encrypt/build private values without extracting the AES key from Snap. For non-Snap wallets, the plugin keeps any recovered key in plugin session state only as needed.

## Installation

```bash
npm install @coti-io/coti-wallet-plugin
```

## Peer Dependencies

```bash
npm install react react-dom ethers viem @coti-io/coti-sdk-typescript @metamask/providers @rainbow-me/rainbowkit wagmi @tanstack/react-query
```

## Build

```bash
npm run build    # Produces dist/index.js (CJS) + dist/index.mjs (ESM) + dist/index.d.ts
npm run lint     # TypeScript type check (tsc --noEmit)
npm run test     # Run test suite (vitest)
npm run clean    # Remove dist/
```

[Documentation](https://docs.coti.io/coti-v2-documentation/build-on-coti/tools/coti-wallet-plugin)


