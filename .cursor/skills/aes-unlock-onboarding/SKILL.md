---
name: aes-unlock-onboarding
description: >-
  Guides AES key unlock and onboarding in @coti-io/coti-wallet-plugin. Use when
  changing unlock/onboarding UI, usePrivateUnlock, OnboardModal, encrypted AES
  backup restore, aesAccessStrategy, muteChainUpdates, session AES key, or
  generateOrRecoverAes flows.
---

# AES unlock and onboarding

## Preferred host API

Host apps must unlock through the provider controller — not a one-off modal or restore hack:

```tsx
<CotiPluginProvider privateUnlock={{ theme, warning }}>
  <App />
</CotiPluginProvider>
```

Default surface is `core` (wallet + unlock). Token lists, swap/fees, and PoD tracking require `surface="bridge"`.

From components: `usePrivateUnlock().unlock()`, `.lock()`, or `.requireUnlock(action)`.

**Do not** orchestrate unlock with:

- A locally owned `OnboardModal`
- `refreshPrivateBalances({ restoreOnly: true })` as the primary unlock path

## Access routing

Single routing table: `src/lib/aesAccessStrategy.ts`.

| Condition | Mode |
| --- | --- |
| Snap installed + Snap has key | `snap` |
| Encrypted backup or session AES key | `local` |
| Otherwise | `onboard` |

Preferred user-facing order: Snap → encrypted backup restore → contract onboarding → optional manual AES input (only if host supplies `onManualAesKeySubmit`).

## Contract onboarding rules

1. AES key chain is always COTI Testnet or Mainnet (`aesKeyChainId`), even when the UI is on Sepolia / Fuji.
2. Temporary switches to COTI must mute chain-change reactions (`muteChainUpdates`).
3. Onboard via `@coti-io/coti-ethers` `signer.generateOrRecoverAes()` (BrowserProvider + signer).
4. Validate the AES key after recovery; switch the wallet back to the original chain when applicable.
5. MetaMask may persist the key into the Snap when the origin is allowed.
6. Non-Snap **Save Locally** encrypts a backup via host `onboardingServices` callbacks. Snap onboarding skips that backup save (Snap already holds the key).
7. Unlock succeeds only after private balances refresh with the session key.

## Lock semantics

```
lock()   → hide balances; clear plaintext session AES (default on wagmi disconnect)
unlock() → session key → Snap/backup restore → OnboardModal only if restore fails
         → succeed only after private balance refresh
```

`isUnlocked` / `isPrivateUnlocked` means **private balances are visible**. It does **not** mean a key exists in Snap or backup. Do not use it to infer onboarding state.

## Backup storage

- Plugin encrypts/decrypts backup blobs; it does **not** write storage itself.
- Supported path: host `localStorage` via `configureCotiPlugin({ onboardingServices: { mode: 'custom', ... } })`.
- **Remote AES backup is deprecated** — do not add new remote backup integrations.
- Blob alone is not enough; blob + matching EIP-712 wrap signature decrypts the AES key. Treat that signature as a sensitive unlock credential.

## Security checklist

- [ ] Never log, persist, or transmit raw AES keys as ordinary app data
- [ ] Session AES is wallet-bound; avoid cross-account leakage
- [ ] Do not invent alternate unlock entry points outside `usePrivateUnlock` / `aesAccessStrategy`
- [ ] Keep Snap vs local vs onboard routing in `aesAccessStrategy` — do not duplicate the table elsewhere

## Key files

| Area | Path |
| --- | --- |
| Access routing | `src/lib/aesAccessStrategy.ts` |
| Unlock controller | `src/context/privateUnlock/` |
| AES provider / steps | `src/hooks/useAesKeyProvider.ts` |
| Modal UI | `src/components/OnboardModal.tsx` |
| Backup vault | `src/crypto/aesKeyBackupVault.ts` |
| Plugin config | `src/config/plugin.ts` |
