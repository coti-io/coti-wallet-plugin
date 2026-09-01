---
name: coti-sdk-encrypt-decrypt
description: >-
  Encrypt and decrypt COTI private values with @coti-io/coti-sdk-typescript and
  this package's wrappers. Use when adding or changing encrypt/decrypt logic,
  ctUint/itUint handling, private balances, encryptPrivateValue,
  decryptPrivateValue, ciphertext parsing, or AES key normalization.
---

# COTI SDK encrypt / decrypt

## Prefer existing surfaces (in order)

1. **React / host apps** — `usePrivateUnlock()` / privacy-bridge session:
   - `encryptPrivateValue`
   - `decryptPrivateValue`  
   These choose Snap vs local AES and require unlock.

2. **Library internals** — reuse wrappers before new SDK call sites:

| Task | Use |
| --- | --- |
| Decrypt ctUint64 / ctUint256 balances | `src/crypto/decryption.ts` → `decryptCtUint64`, `decryptCtUint256` |
| Encrypt amount → ctUint256 | `src/hooks/bridge/privateValueCrypto.ts` → `encryptPrivateCtUint256` |
| Decrypt ctUint256 → formatted amount | `decryptPrivateCtUint256` in the same file |
| Signed itUint256 for txs | `src/hooks/bridge/encryptValue256.ts` → `encryptValue256` |
| Normalize AES key hex | `src/crypto/aesKey.ts` → `normalizeAesKey` / `normalizeAesKeyHex` |

3. **Direct SDK** (`@coti-io/coti-sdk-typescript`) only when no wrapper fits.

## SDK cheat sheet

```ts
import {
  encrypt,
  decrypt,
  encryptUint256,
  decryptUint,
  decryptUint256,
  buildItUint256WithSigner,
  encodeKey,
  encodeUint,
  decodeUint,
} from '@coti-io/coti-sdk-typescript';
```

| API | Role |
| --- | --- |
| `encrypt` / `decrypt` | Raw 16-byte AES block ops |
| `encryptUint256(value, aesKey)` | Plaintext wei → flat `{ ciphertextHigh, ciphertextLow }` |
| `decryptUint(ct, userKey)` | ctUint64 → `bigint` |
| `decryptUint256(flat, userKey)` | Flat ctUint256 → `bigint` (v1.0.6+) |
| `buildItUint256WithSigner({...})` | Encrypted + signed input-text for contract calls |

Always pass AES keys through this package’s normalizers — do not invent hex/`0x` handling.

## ctUint256 shapes

On-chain values may be:

- **Flat:** `{ ciphertextHigh, ciphertextLow }`
- **Nested:** `{ high: { high, low }, low: { high, low } }`
- **Tuple/array:** `[ciphertextHigh, ciphertextLow]`

`decryptCtUint256` already normalizes nested/tuple → flat before calling `decryptUint256`. Prefer that helper over ad-hoc reshaping.

Parse/serialize JSON with `parseCtUint256Json` / `serializeCtUint256` in `privateValueCrypto.ts`.

## Rules

- Check zero / uninitialized ciphertext before decrypt (wrappers return `0n` for zero).
- Treat `null` from decrypt helpers as AES mismatch or invalid ciphertext — do not format as a balance.
- Do not roll custom AES/XOR crypto.
- Do not use PoD encryption services (`@coti-io/pod-sdk` / `@coti/pod-sdk`) for native COTI ct/it ops in this package.
- Never log AES keys or plaintext private balances.

## Quick examples

**Decrypt balance (library):**

```ts
import { decryptCtUint256 } from '../crypto/decryption';

const wei = decryptCtUint256(ciphertext, aesKey, { decimals: 18 });
if (wei === null) {
  // key mismatch or bad ciphertext
}
```

**Encrypt amount (library):**

```ts
import { encryptPrivateCtUint256 } from '../hooks/bridge/privateValueCrypto';

const ct = encryptPrivateCtUint256({
  amount: '1.5',
  decimals: 18,
  aesKey,
});
```

**Signed input for a contract call:**

```ts
import { encryptValue256 } from '../hooks/bridge/encryptValue256';

const { ciphertext, signature } = await encryptValue256(
  amountWei,
  aesKeyHex,
  contractAddress,
  functionSelector,
  walletAddress,
  signer,
);
```
