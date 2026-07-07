# @coti-io/coti-wallet-plugin

**Important:** This library is a **plugin for existing dApps and wallets**, not a standalone wallet application. It is designed to be injected into your existing React/wagmi stack to seamlessly enhance standard wallets with COTI network privacy capabilities.

 Provides React hooks, multi-wallet support (via wagmi v2 and RainbowKit), and token detection for any EIP-1193 wallet. 

## dApp API contract

dApps should not handle AES keys in the normal integration path. Use the plugin provider/context APIs to connect wallets, onboard/unlock private balances, and execute private operations. The plugin owns AES retrieval, backup restore, Snap storage, and Snap-backed decrypt/encrypt calls internally.

For MetaMask Snap wallets, runtime private operations use Snap RPCs such as decrypt/encrypt/build private values without extracting the AES key from Snap. For non-Snap wallets, the plugin keeps any recovered key in plugin session state only as needed.

## dApp integration guide

Provider owns unlock flow. App pages call commands. Do not build custom unlock routing.

### 1. Wrap app once

```tsx
import {
  PrivacyBridgeProvider,
  WagmiRainbowKitProvider,
  type OnboardModalTheme,
} from '@coti-io/coti-wallet-plugin';

const onboardTheme: OnboardModalTheme = {
  checkboxText: { color: 'rgba(255, 255, 255, 0.86)' },
  tooltipButton: { color: 'rgba(255, 255, 255, 0.86)' },
};

export function Root() {
  return (
    <WagmiRainbowKitProvider walletConnectProjectId={walletConnectProjectId}>
      <PrivacyBridgeProvider
        privateUnlock={{
          theme: onboardTheme,
          warning:
            'This dApp never stores or receives the AES key. Unlock stays inside the plugin.',
          onRestoreCancelled: () => {
            // Optional: show "User canceled" toast.
          },
        }}
      >
        <App />
      </PrivacyBridgeProvider>
    </WagmiRainbowKitProvider>
  );
}
```

No `{onboardModal}` render in app. Provider mounts modal once.

### 2. Use unlock controller in pages

```tsx
import { usePrivateUnlock } from '@coti-io/coti-wallet-plugin';

export function HeaderUnlockButton() {
  const privateUnlock = usePrivateUnlock();

  return (
    <button
      onClick={() => privateUnlock.toggleLock()}
      disabled={privateUnlock.isUnlocking}
    >
      {privateUnlock.isUnlocked ? 'Lock Private Balances' : 'Unlock Private Balances'}
    </button>
  );
}
```

### 3. Guard private actions

Use `requireUnlock(action)` for actions needing private balance/key access. It tries cached session key first, then restore backup/Snap, then onboarding modal only if needed.

```tsx
import {
  usePrivateUnlock,
  usePrivacyBridgeUnlock,
} from '@coti-io/coti-wallet-plugin';

export function EncryptButton() {
  const privateUnlock = usePrivateUnlock();
  const unlock = usePrivacyBridgeUnlock();

  const encrypt = async () => {
    const result = await unlock.encryptPrivateValue({
      amount: '1.0',
      decimals: 18,
    });
    console.log(result.ciphertext);
  };

  return (
    <button
      disabled={privateUnlock.isUnlocking}
      onClick={() => void privateUnlock.requireUnlock(encrypt)}
    >
      Encrypt
    </button>
  );
}
```

### 4. Know lock semantics

Lock hides private balances. Lock does **not** clear session AES key. Same browser session can unlock silently:

```txt
lock()
  -> balances hidden
  -> session AES key kept in memory

unlock()
  -> try cached session key
  -> try restore backup / Snap
  -> open onboarding modal only if restore fails
```

Contract onboarding always ends on plugin success screen. User can reveal/copy raw AES key, then click Done. Pending action runs after Done.

### Do

- Use `PrivacyBridgeProvider privateUnlock={...}` once near app root.
- Use `usePrivateUnlock()` for unlock orchestration: `unlock()`, `lock()`, `toggleLock()`, `requireUnlock(action)`.
- Use `usePrivacyBridgeUnlock()` inside/after that guard for private operations: `sendPrivateToken`, `encryptPrivateValue`, `decryptPrivateValue`.
- Let plugin own `OnboardModal`, Snap install, restore-only flow, contract onboarding, AES key success screen.

### Do not

- Do not render `OnboardModal` for unlock in app pages.
- Do not call `unlockCachedAesKey()` directly from app UI.
- Do not call `refreshPrivateBalances({ restoreOnly: true })` as custom unlock flow.
- Do not infer key existence from `isPrivateUnlocked`; it only means private balances visible.
- Do not clear/recreate unlock state on every lock. Lock is UI hide, not key wipe.

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


