# @coti-io/coti-wallet-plugin

**Important:** This library is a **plugin for existing dApps and wallets**, not a standalone wallet application. It is designed to be injected into your existing React/wagmi stack to seamlessly enhance standard wallets with COTI network privacy capabilities.

 Provides React hooks, multi-wallet support (via wagmi v2 and RainbowKit), and token detection for any EIP-1193 wallet. 

## Installation

```bash
npm install @coti-io/coti-wallet-plugin
```

## Peer Dependencies

```bash
npm install react react-dom ethers viem @coti-io/coti-ethers @coti-io/coti-sdk-typescript @metamask/providers @rainbow-me/rainbowkit wagmi @tanstack/react-query
```

## Build

```bash
npm run build    # Produces dist/index.js (CJS) + dist/index.mjs (ESM) + dist/index.d.ts
npm run lint     # TypeScript type check (tsc --noEmit)
npm run test     # Run test suite (vitest)
npm run clean    # Remove dist/
```

[Documentation](https://docs.coti.io/coti-v2-documentation/build-on-coti/tools/coti-wallet-plugin)


