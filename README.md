# @coti-io/coti-wallet-plugin

React library for adding COTI private token (pToken) support to wagmi v2 + RainbowKit dApps.

**Important:** This is a **plugin for existing dApps and wallets**, not a standalone wallet application. It provides React hooks, multi-wallet support, and token detection for any EIP-1193 wallet.

## Documentation

Full documentation lives in the [COTI documentation](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin) repository:

| Topic | Link |
| --- | --- |
| Overview and quickstart | [COTI Wallet Plugin](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin) |
| Integration guide | [Integration Guide](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/integration-guide) |
| Configuration | [Configuration](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/configuration) |
| API reference | [API Reference](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/api-reference) |
| AES key onboarding | [AES Key Onboarding](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/aes-key-onboarding) |
| Onboard modal theming | [Onboard Modal Theming](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/onboard-modal-theme) |
| Example app | [Example App](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/example-app) |

## Installation

```bash
npm install @coti-io/coti-wallet-plugin
```

### Peer dependencies

```bash
npm install react react-dom ethers viem @coti-io/coti-sdk-typescript @metamask/providers @rainbow-me/rainbowkit wagmi @tanstack/react-query
```

This release is validated with `@rainbow-me/rainbowkit@2.2.0` and `wagmi@2.14.0`.

## Quickstart

```tsx
import {
  PrivacyBridgeProvider,
  WagmiRainbowKitProvider,
  usePrivateUnlock,
} from '@coti-io/coti-wallet-plugin';

export function Root() {
  return (
    <WagmiRainbowKitProvider walletConnectProjectId={walletConnectProjectId}>
      <PrivacyBridgeProvider>
        <App />
      </PrivacyBridgeProvider>
    </WagmiRainbowKitProvider>
  );
}
```

See the [integration guide](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/integration-guide) for provider setup, unlock flow, and private operations.

## Development

```bash
npm run build      # dist/index.js (CJS) + dist/index.mjs (ESM) + dist/index.d.ts
npm run typecheck  # TypeScript check
npm run test       # Vitest suite
npm run lint       # ESLint
```

### Example app

```bash
cd examples && npm run dev
```

See [Example App](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/example-app) for setup details.

## License

Apache 2.0
