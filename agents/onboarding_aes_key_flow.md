# User Onboarding: AES Key Retrieval from COTI Contract

## Overview

The user onboarding process retrieves (or generates) a per-user AES encryption key from the COTI onboarding smart contract. This key is required to decrypt private token balances on the COTI network. The onboarding is a **one-time signature flow** per session — the AES key lives only in React state and is never persisted to browser storage.

---

## Entry Points

There are **two routing paths** depending on the connected wallet type, both handled by `useAesKeyProvider` (`src/hooks/useAesKeyProvider.ts`):

| Wallet Type | Path | Method |
|---|---|---|
| MetaMask (with Snap) | Route 1: Snap-based retrieval | `getAESKeyFromSnap(address)` via MetaMask Snaps API |
| Non-MetaMask / MetaMask without Snap | Route 2: Contract onboarding | `@coti-io/coti-ethers` → `signer.generateOrRecoverAes()` |

---

## Detailed Flow (Route 2: Contract Onboarding)

This is the primary path for non-MetaMask wallets (WalletConnect, Coinbase Wallet, etc.) and the fallback for MetaMask when the Snap is unavailable or empty.

### Step-by-Step

```
User clicks "Sign & Onboard" in OnboardModal
          │
          ▼
┌─────────────────────────────────────────┐
│  useAesKeyProvider.getAesKey(address)   │
│  (src/hooks/useAesKeyProvider.ts)       │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  1. Get EIP-1193 provider from wagmi    │
│     connector.getProvider()             │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  2. Check if wallet is on COTI chain    │
│     (Mainnet 0x27D1 or Testnet 0x27DA) │
│     If NOT:                             │
│       - Mute UI chain-change events     │
│       - wallet_switchEthereumChain      │
│         to COTI Testnet                 │
│       - (Or wallet_addEthereumChain     │
│         if chain 4902 not found)        │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  3. Create @coti-io/coti-ethers         │
│     BrowserProvider(walletProvider)      │
│     → provider.getSigner(address)       │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  4. signer.generateOrRecoverAes()       │
│     ─────────────────────────────────── │
│     This calls the COTI onboarding      │
│     contract. The wallet prompts the    │
│     user to sign a message. The         │
│     contract either:                    │
│       - Generates a NEW AES key         │
│         (first-time onboard)            │
│       - Recovers the EXISTING AES key   │
│         (repeat onboard, same account)  │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  5. signer.getUserOnboardInfo()         │
│     → { aesKey: string }               │
│     Returns 32-char hex (128-bit key)   │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  6. Validate key format                 │
│     /^[0-9a-fA-F]{32}$|               │
│      ^[0-9a-fA-F]{64}$/               │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  7. Switch wallet back to original      │
│     chain (if chain was switched)       │
│     Unmute chain-change events          │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  8. (MetaMask only) Persist key to      │
│     Snap via saveAESKeyToSnap()         │
│     if origin is authorized             │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  9. Return aesKey to caller             │
└─────────────────────────────────────────┘
```

### After Key Retrieval

```
┌─────────────────────────────────────────┐
│  usePrivacyBridgeUnlockSession          │
│  .handleOnboard()                       │
│  → calls handleManualOnboarding()       │
│  → stores key: setSessionAesKey(key, w) │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  usePrivacyBridgeSessionKey             │
│  Binds key to wallet address in         │
│  React state (in-memory only)           │
│  Prevents cross-account key bleed       │
└────────────────────┬────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────┐
│  usePrivacyBridgeAccountSync            │
│  Detects sessionAesKey change →         │
│  triggers updateAccountState()          │
│  → fetches private token balances       │
│  → sets arePrivateBalancesHidden=false  │
└─────────────────────────────────────────┘
```

---

## Detailed Flow (Route 1: MetaMask Snap)

For MetaMask users with the COTI Snap installed:

1. `getAESKeyFromSnap(address)` — calls the MetaMask Snap to retrieve a stored 64-char (256-bit) AES key
2. If Snap is empty or unavailable, **falls back to Route 2** (contract onboarding)
3. After Route 2 succeeds for MetaMask, the key is persisted to the Snap via `saveAESKeyToSnap()` for future sessions

---

## Key Components

| File | Role |
|---|---|
| `src/hooks/useAesKeyProvider.ts` | Core dual-route AES key retrieval logic |
| `src/components/OnboardModal.tsx` | UI explaining the signature to non-MetaMask users |
| `src/hooks/useSnap.ts` | MetaMask Snap interaction (get/save key, `handleManualOnboarding`) |
| `src/context/privacyBridge/usePrivacyBridgeSessionKey.ts` | Wallet-bound in-memory key state |
| `src/context/privacyBridge/usePrivacyBridgeUnlockSession.ts` | Orchestrates onboard/unlock lifecycle |
| `src/context/privacyBridge/usePrivacyBridgeAccountSync.ts` | Triggers balance refresh on key change |
| `src/context/privacyBridge/usePrivacyBridgeSessionCore.ts` | Wires all hooks together |
| `src/lib/chainMute.ts` | Mutes spurious chain-switch UI events during onboarding |

---

## Contract Details

- **Library**: `@coti-io/coti-ethers` (external dependency)
- **Contract**: The onboarding contract address is embedded inside `@coti-io/coti-ethers` — it is NOT configured within this plugin
- **Network**: Onboarding executes on **COTI Testnet** (chain ID `0x27DA` / `10202`)
- **Key method**: `signer.generateOrRecoverAes()` — triggers a wallet signature request
- **Key retrieval**: `signer.getUserOnboardInfo().aesKey` — returns the hex AES key

---

## Key Format

| Source | Length | Bits |
|---|---|---|
| Onboard contract | 32 hex chars | 128-bit AES |
| MetaMask Snap | 64 hex chars | 256-bit AES |

Both formats are accepted by the validation regex: `/^[0-9a-fA-F]{32}$|^[0-9a-fA-F]{64}$/`

---

## Security Properties

1. **Session-only**: The AES key is stored exclusively in React state — never in localStorage or cookies
2. **Wallet-bound**: The key is bound to a specific wallet address to prevent cross-account leakage
3. **Lost on refresh**: By design, page reload requires re-onboarding (re-signing)
4. **No persistence**: `unlockCachedAesKey()` always throws — caching was intentionally removed
5. **Chain muting**: During the COTI chain switch for onboarding, UI chain-change events are suppressed to avoid stale state resets

---

## Error Handling

- **User rejection** (EIP-1193 code 4001): Returns `null` silently — user cancelled
- **Snap unavailable/empty**: Falls through to contract onboarding
- **Chain switch failure** (code 4902): Attempts `wallet_addEthereumChain` to add COTI Testnet
- **Invalid key format**: Sets `onboardingError` state for UI display
- **ACCOUNT_NOT_ONBOARDED**: Clears session key, re-hides private balances, triggers re-onboard flow

---

## UI Flow (OnboardModal)

The `OnboardModal` component (`src/components/OnboardModal.tsx`) is displayed to non-MetaMask wallet users and has four states:

1. **Idle** — Explains that a signature is needed for AES key retrieval
2. **Loading** — Shows spinner while `generateOrRecoverAes()` is in progress
3. **Error** — Shows error message with retry button
4. **Success** — Auto-closes when `sessionAesKey` is set in context

The modal is triggered when the user attempts to view/manage private balances without an active session key.
