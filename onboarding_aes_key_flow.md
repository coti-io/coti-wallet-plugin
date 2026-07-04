# User Onboarding: AES Key Retrieval

## Overview

Onboarding retrieves or restores the wallet-bound AES key used to decrypt private token balances. The active key is kept in React session state, while optional encrypted backups are stored in localStorage and, when configured, also in the on-chain `AesKeyBackupVault`.

The current flow is implemented by `useAesKeyProvider` in `src/hooks/useAesKeyProvider.ts`.

## Routes

| Wallet | First route | Fallback |
|---|---|---|
| MetaMask with Snap | `getAESKeyFromSnap(address)` | Contract onboarding if Snap is empty/unavailable |
| Other wallets / MetaMask without usable Snap | Encrypted backup restore, then contract onboarding | Manual AES key input in `OnboardModal` if the host supplies `onManualAesKeySubmit` |

## Contract Onboarding Flow

1. Caller invokes `getAesKey(address, setStep, options)`.
2. The hook emits `restoring-backup`, reads the encrypted blob from localStorage first, then `AesKeyBackupVault` if configured and no local backup exists, asks the wallet for the EIP-712 restore signature, and decrypts it with `decryptAesKeyBackup`.
3. If `options.restoreOnly` is true and no backup is restored, the hook returns `null` without contract onboarding.
4. The hook switches to COTI mainnet/testnet when needed, muting chain-change reactions during the temporary switch.
5. If `grantNativeCoti` is configured and the wallet balance is below `onboardingGrantMinBalanceWei` or the default minimum, the hook emits `granting-funds`, calls the grant service, then emits `waiting-for-funds` while polling native COTI balance.
6. The hook creates a `@coti-io/coti-ethers` `BrowserProvider` and signer.
7. `signer.generateOrRecoverAes()` runs the onboarding flow. The wallet sees the message signature and, for first-time onboarding, the on-chain transaction.
8. The hook reads `signer.getUserOnboardInfo().aesKey`, validates the AES key, and switches the wallet back to the original chain when applicable.
9. For MetaMask, the hook attempts to persist the key into the Snap if the origin is allowed.
10. If `options.saveBackup` is true, the hook encrypts the AES key with `encryptAesKeyBackup`, writes the blob to localStorage, and sends one `AesKeyBackupVault` transaction when a vault address is configured.
11. The hook emits `complete` and returns the AES key.

## Example App Services

`examples/src/App.tsx` configures `onboardingServices` with `mode: 'custom'`.

| Env var | Behavior |
|---|---|
| `VITE_GRANT_API_URL_TESTNET` | Testnet `grantNativeCoti` POST URL |
| `VITE_GRANT_API_URL_MAINNET` | Mainnet `grantNativeCoti` POST URL |
| one grant URL unset | Skips grant API calls on that chain; onboarding falls through to the normal insufficient-funds path if the wallet has no native COTI |
| both grant URLs unset | Does not configure a grant service on either chain; onboarding requires the wallet to already have native COTI for gas |

The example still keeps the active AES key in memory. When `Save encrypted backup` is checked, the encrypted blob is stored locally. If `VITE_AES_KEY_BACKUP_VAULT_ADDRESS` is also set, the same encrypted blob is stored on-chain.

Manual AES key input is session-only in the current unlock flow. Contract onboarding uses the encrypted backup helper when `Save encrypted backup` is checked: the user signs the backup context, the key is encrypted with `encryptAesKeyBackup`, and the encrypted blob is saved through the configured backup storage.

`npm run dev:local-snap` in `examples/` starts a local `coti-snap` server and the wallet example with `VITE_SNAP_ID=local:http://localhost:8080`.

## Key Components

| File | Role |
|---|---|
| `src/hooks/useAesKeyProvider.ts` | Snap route, contract backup restore/save, grant, contract onboarding |
| `src/crypto/aesKeyBackupVault.ts` | EIP-712 signature based AES-GCM backup encryption/decryption |
| `src/crypto/aesKeyBackupContract.ts` | Encrypted backup storage transport (`AesKeyBackupVault` or localStorage fallback) |
| `src/components/OnboardModal.tsx` | Onboarding UI, backup opt-in, manual AES key input, success key display |
| `src/context/privacyBridge/usePrivacyBridgeSessionKey.ts` | Wallet-bound in-memory session AES key |
| `src/context/privacyBridge/usePrivacyBridgeUnlockSession.ts` | PrivacyBridge unlock/manual onboarding lifecycle |
| `src/context/privacyBridge/usePrivacyBridgeAccountSync.ts` | Balance refresh when the session AES key changes |
| `src/lib/chainMute.ts` | Mutes temporary onboarding chain-switch UI effects |

## Security Properties

1. The active AES key is session-only React state and is wallet-bound to prevent cross-account leakage.
2. Encrypted backups are optional and stored in `AesKeyBackupVault` or localStorage fallback.
3. Backup restore requires a wallet signature, so a stored blob alone is not enough to recover the AES key.
4. Manual AES key input is session-only.
5. `unlockCachedAesKey()` in the PrivacyBridge compatibility surface still reports no cached key; legacy `localAesKeyVault` is exported but not used by the current PrivacyBridge unlock flow.

## Error Handling

- User rejection during Snap, restore signature, chain switch, or onboarding returns `null` or shows the relevant modal error without storing a key.
- Backup restore failures fall through to contract onboarding and set a non-blocking warning.
- Backup save transaction failures do not block a successful onboarding; the user receives a warning.
- Grant API HTTP errors are treated as skipped grants, which covers duplicate/already-sent grant cases. The onboarding transaction still needs native COTI gas, so an unfunded wallet fails through the normal insufficient-balance path.
- Invalid AES key format sets `onboardingError` and emits `error`.
