# Requirements Document

## Introduction

This feature extracts general-purpose cryptographic, token detection, and utility functions from the `coti-snap` MetaMask Snap into the `coti-wallet-plugin` library. The goal is to eliminate code duplication between the two projects, consolidate divergent implementations, and provide a single source of truth for core COTI privacy operations that can be consumed by any EIP-1193 wallet integration — not just MetaMask Snaps.

## Glossary

- **Plugin**: The `@coti-io/coti-wallet-plugin` TypeScript library built with tsup, providing reusable COTI privacy operations
- **Snap**: The `coti-snap` MetaMask Snap that currently contains the source implementations
- **AES_Key**: A 128-bit symmetric key used for COTI on-chain encryption, represented as a hex string
- **IT (Input Text)**: An encrypted input structure containing a ciphertext and cryptographic signature, used to submit private values to COTI smart contracts
- **CtUint256**: A 256-bit ciphertext structure composed of four 64-bit encrypted segments arranged as `{ high: { high, low }, low: { high, low } }`
- **CtUint64**: A single 64-bit ciphertext value produced by AES encryption
- **Decryption_Engine**: The module responsible for decrypting on-chain ciphertext balances back to plaintext values
- **Token_Detector**: The module responsible for classifying token contract types via ERC165 interface probing and bytecode analysis
- **Wallet_Deriver**: The module that deterministically derives an ethers Wallet from an AES key, account address, and chain ID
- **Sanity_Guard**: A validation check that rejects decrypted values exceeding plausible bounds for a given token's decimals
- **Network_Config**: A record mapping COTI chain IDs to their RPC URLs, explorer URLs, and environment metadata

## Requirements

### Requirement 1: Balance Decryption

**User Story:** As a plugin consumer, I want to decrypt on-chain encrypted balances, so that I can display human-readable token amounts to users.

#### Acceptance Criteria

1. WHEN a valid CtUint64 ciphertext (single uint256 value) and AES_Key (32-byte hex string) are provided, THE Decryption_Engine SHALL decrypt the ciphertext and return the plaintext as a bigint with a value in the range 0 to 2^64 - 1
2. WHEN a valid CtUint256 ciphertext (struct containing ciphertextHigh and ciphertextLow, each a uint256) and AES_Key are provided, THE Decryption_Engine SHALL decrypt both halves and reconstruct the full 256-bit plaintext as a bigint
3. WHEN a decimals parameter (integer 0 to 18) is provided, THE Decryption_Engine SHALL format the decrypted bigint into a decimal string by dividing by 10^decimals and returning the result with up to the specified number of fractional digits, trailing zeros removed
4. IF the decrypted CtUint64 value exceeds 2^64 - 1, THEN THE Sanity_Guard SHALL return null indicating AES key mismatch instead of the implausible value
5. IF the decrypted CtUint256 value exceeds 10^30 multiplied by 10^decimals, THEN THE Sanity_Guard SHALL return null indicating AES key mismatch instead of the implausible value
6. WHEN a CtUint256 value has both ciphertextHigh equal to 0 and ciphertextLow equal to 0, THE Decryption_Engine SHALL return 0 as a bigint without performing decryption
7. IF the AES_Key is not provided or is empty, THEN THE Decryption_Engine SHALL return null without attempting decryption

### Requirement 2: AES Key Normalization

**User Story:** As a plugin consumer, I want AES keys to be normalized consistently, so that encryption and decryption operations produce correct results regardless of input format.

#### Acceptance Criteria

1. WHEN an AES_Key with a "0x" prefix is provided, THE Plugin SHALL strip the prefix before any encryption or decryption operation
2. WHEN an AES_Key with mixed-case hex characters is provided, THE Plugin SHALL convert the key to lowercase
3. THE Plugin SHALL accept AES keys as 32-character hex strings (128-bit) after normalization
4. IF an AES_Key contains non-hexadecimal characters after prefix removal, THEN THE Plugin SHALL reject the key and throw an error indicating invalid hex format
5. IF an AES_Key does not have a length of 32 hex characters after normalization, THEN THE Plugin SHALL reject the key and throw an error indicating invalid key length

### Requirement 3: Encrypted Input Construction (IT)

**User Story:** As a plugin consumer, I want to construct encrypted input structures for smart contract calls, so that I can submit private values to COTI private contracts.

#### Acceptance Criteria

1. WHEN a plaintext value, AES_Key, Wallet, contract address, and function selector are provided, THE Plugin SHALL AES-encrypt the plaintext using the encoded AES_Key, concatenate the resulting ciphertext bytes with the encryption randomness (r), decode the concatenation as a uint256 string, produce a signature over that value, and return an ItUint64 structure containing the fields `ciphertext` (uint256 string) and `signature` (65-byte hex string)
2. WHEN a plaintext value is greater than or equal to 0 and less than 2^64, THE Plugin SHALL encrypt it as a single CtUint64 segment by encoding the plaintext into a 16-byte block, encrypting with AES, and returning the ciphertext concatenated with randomness as a uint256
3. WHEN a 256-bit plaintext value is provided, THE Plugin SHALL split it into four 64-bit segments (bits 255–192, 191–128, 127–64, 63–0), encrypt each segment independently as a CtUint64, and return a valid ItUint256 structure containing a nested ciphertext object with `high.high`, `high.low`, `low.high`, `low.low` (each a uint256 string) and a 2×2 signature array corresponding to each segment
4. IF the plaintext value is greater than or equal to 2^64 and the caller requests ItUint64, THEN THE Plugin SHALL throw a RangeError with a message indicating the plaintext size must be 64 bits or smaller
5. THE Plugin SHALL produce each signature by computing a solidityPackedKeccak256 digest over the parameters [address signerAddress, address contractAddress, bytes4 functionSelector, uint256 ciphertext] and signing the digest using the wallet's private key via ECDSA (SigningKey.sign), returning the concatenation of r, s, and v as a 65-byte hex value
6. IF the AES_Key, Wallet, contract address, or function selector is not provided or is invalid, THEN THE Plugin SHALL throw an error indicating which required parameter is missing or malformed

### Requirement 4: Wallet Derivation

**User Story:** As a plugin consumer, I want to derive a deterministic signing wallet from an AES key, so that I can produce signatures for encrypted inputs without requiring additional key management.

#### Acceptance Criteria

1. WHEN an AES_Key (32-character hex string), a valid Ethereum account address, and a chain ID (decimal string) are provided, THE Wallet_Deriver SHALL produce a deterministic ethers Wallet
2. THE Wallet_Deriver SHALL derive the wallet private key by computing solidityPackedKeccak256 with types ['string', 'address', 'string', 'string'] over the values ["coti-snap-encryption", account, chainId, aesKey] in that order
3. WHEN the same inputs are provided multiple times, THE Wallet_Deriver SHALL return a wallet with the same address and private key
4. THE Wallet_Deriver SHALL normalize the AES_Key by stripping any "0x" prefix and converting to lowercase before computing the hash
5. IF the AES_Key is not a valid 32-character hex string after normalization, or the account address is not a valid Ethereum address, THEN THE Wallet_Deriver SHALL throw an error indicating which input failed validation

### Requirement 5: Token Type Detection

**User Story:** As a plugin consumer, I want to detect whether a token contract is a standard ERC20, ERC721, ERC1155, or a COTI private ERC20 variant, so that I can apply the correct interaction logic.

#### Acceptance Criteria

1. WHEN a token contract address and provider are supplied, THE Token_Detector SHALL call `supportsInterface(bytes4)` on the contract for each known interface ID in the following precedence order: private ERC20 256-bit (0xdfeb393e), private ERC20 64-bit (0x8409a9cf), ERC721 (0x80ac58cd), ERC1155 (0xd9b67a26), and SHALL return the classification corresponding to the first interface that returns true
2. WHEN the contract supports interface ID 0x8409a9cf, THE Token_Detector SHALL classify it as a private ERC20 (64-bit)
3. WHEN the contract supports interface ID 0xdfeb393e, THE Token_Detector SHALL classify it as a private ERC20 (256-bit)
4. WHEN the contract supports interface ID 0x80ac58cd, THE Token_Detector SHALL classify it as ERC721
5. WHEN the contract supports interface ID 0xd9b67a26, THE Token_Detector SHALL classify it as ERC1155
6. IF the ERC165 probe reverts or returns false for all known interfaces, THEN THE Token_Detector SHALL fall back to checking the contract bytecode for the presence of ERC20 function selectors (balanceOf: 0x70a08231, transfer: 0xa9059cbb, approve: 0x095ea7b3) and SHALL classify the contract as a standard ERC20 if all three selectors are present in the deployed bytecode
7. IF both ERC165 and bytecode selector analysis yield no match, THEN THE Token_Detector SHALL return a classification value of "unknown"
8. IF the supplied address has no deployed bytecode (i.e., is an externally owned account or empty address), THEN THE Token_Detector SHALL return a classification value of "unknown" without attempting ERC165 or bytecode analysis
9. IF any RPC call during detection does not respond within 10 seconds, THEN THE Token_Detector SHALL abort the detection and return a classification value of "unknown"

### Requirement 6: Confidential Version Probing

**User Story:** As a plugin consumer, I want to determine whether a private ERC20 supports 256-bit operations, so that I can use the appropriate encryption variant.

#### Acceptance Criteria

1. WHEN a token address and provider are supplied, THE Token_Detector SHALL call the ERC-165 `supportsInterface` method on the token contract with interface ID 0xdfeb393e and return true if the contract reports support, or false otherwise
2. WHEN an optional account address is provided alongside the token address and provider, THE Token_Detector SHALL additionally call `accountEncryptionAddress(account)` on the token contract and return true only if both the 256-bit interface is supported and the returned encryption address is not the zero address
3. IF the token address contains no deployed contract code, THEN THE Token_Detector SHALL return false without attempting the interface probe
4. IF the `supportsInterface` call reverts or the contract does not implement ERC-165, THEN THE Token_Detector SHALL return false
5. THE Token_Detector SHALL complete the probe within 10 seconds; IF the provider does not respond within that duration, THEN THE Token_Detector SHALL return false

### Requirement 7: ERC20 Token Metadata

**User Story:** As a plugin consumer, I want to fetch standard ERC20 metadata (name, symbol, decimals), so that I can display token information in wallet UIs.

#### Acceptance Criteria

1. WHEN a valid ERC20 contract address (42-character hex string starting with 0x) and an active provider are supplied, THE Plugin SHALL return an object containing the token name (string), symbol (string), and decimals (integer in the range 0 to 36)
2. IF any individual metadata call (name, symbol, or decimals) reverts or the RPC request fails within 10 seconds, THEN THE Plugin SHALL return null for the failed field while still returning successfully resolved fields
3. IF the supplied address does not conform to a deployed ERC20 contract (i.e., all three metadata calls revert), THEN THE Plugin SHALL return null
4. THE Plugin SHALL cache metadata results in memory for the lifetime of the provider instance to avoid redundant RPC calls for the same token address

### Requirement 8: ERC721 Token Operations

**User Story:** As a plugin consumer, I want to fetch NFT metadata and verify ownership, so that I can display NFT details and validate user holdings.

#### Acceptance Criteria

1. WHEN a valid ERC721 contract address and provider are supplied, THE Plugin SHALL return the collection name and symbol
2. WHEN a token ID and owner address are provided, THE Plugin SHALL verify ownership by calling ownerOf and comparing the result
3. WHEN a confidential NFT address, token ID, and AES_Key are provided, THE Plugin SHALL decrypt the token URI and return the plaintext URI
4. WHEN a public NFT address and token ID are provided, THE Plugin SHALL return the token URI directly
5. IF the token URI uses an IPFS scheme, THEN THE Plugin SHALL resolve it through an IPFS gateway URL

### Requirement 9: Network Configuration

**User Story:** As a plugin consumer, I want a unified network configuration for COTI chains, so that both the snap and plugin use consistent RPC endpoints and chain metadata.

#### Acceptance Criteria

1. THE Plugin SHALL export Network_Config records for COTI Mainnet (chain ID 2632500) and COTI Testnet (chain ID 7082400)
2. WHEN a chain ID is provided, THE Plugin SHALL return the corresponding RPC URL, explorer URL, network name, and testnet flag
3. IF an unsupported chain ID is provided, THEN THE Plugin SHALL throw a descriptive error

### Requirement 10: Ciphertext Shape Validation

**User Story:** As a plugin consumer, I want to validate ciphertext structures before attempting decryption, so that I can avoid runtime errors from malformed data.

#### Acceptance Criteria

1. WHEN a value is provided, THE Plugin SHALL determine whether it conforms to the CtUint256 shape (an object with nested high/low structure containing string values)
2. WHEN a CtUint256 structure contains all-zero values, THE Plugin SHALL identify it as a zero ciphertext
3. THE Plugin SHALL export type guards that narrow TypeScript types for CtUint64 and CtUint256

### Requirement 11: Display Utilities

**User Story:** As a plugin consumer, I want formatting utilities for addresses and balances, so that I can present data consistently across wallet UIs.

#### Acceptance Criteria

1. WHEN an Ethereum address and desired length are provided, THE Plugin SHALL return a truncated representation showing the first and last characters with ellipsis
2. WHEN a balance bigint, decimals, and maximum display decimals are provided, THE Plugin SHALL format it as a human-readable string with thousand separators
3. WHEN a token symbol is provided, THE Plugin SHALL generate a deterministic SVG avatar string

### Requirement 12: Signature Utilities

**User Story:** As a plugin consumer, I want low-level signature helpers, so that I can construct and normalize ECDSA signatures for COTI contract interactions.

#### Acceptance Criteria

1. WHEN a private key and message digest are provided, THE Plugin SHALL produce a raw ECDSA signature with r, s, and v components
2. WHEN a signature with a v value of 27 or 28 is provided, THE Plugin SHALL normalize it to a 65-byte compact format with v encoded as 0x00 or 0x01
3. THE Plugin SHALL accept signatures in both hex string and byte array formats

### Requirement 13: Browser Compatibility

**User Story:** As a plugin consumer, I want all extracted functions to work in browser environments, so that the library can be used in web-based wallet applications.

#### Acceptance Criteria

1. THE Plugin SHALL avoid Node.js-only APIs (fs, crypto.createCipheriv, Buffer where TextEncoder suffices)
2. THE Plugin SHALL rely only on dependencies already declared as peer dependencies: ethers, @coti-io/coti-sdk-typescript, and @metamask/providers
3. THE Plugin SHALL export all new modules through the existing tsup entry point with tree-shakeable ESM and CJS outputs

### Requirement 14: Duplication Resolution

**User Story:** As a maintainer, I want a single canonical implementation for functions that currently exist in both projects, so that behavior is consistent and maintenance burden is reduced.

#### Acceptance Criteria

1. WHEN the Plugin exports a function that previously existed in both projects, THE Plugin SHALL use the snap implementation as the canonical source unless the plugin version is strictly more correct
2. THE Plugin SHALL document any behavioral differences between the snap and plugin versions that were resolved during migration
3. WHEN the `isInsaneDecryptedValue` threshold differs between projects, THE Plugin SHALL use the more conservative (lower) threshold and expose the threshold as a configurable parameter
