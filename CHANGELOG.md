# Changelog

All notable changes to `@coti-io/coti-wallet-plugin` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers follow [SemVer](https://semver.org/).

## [Unreleased]

## [0.4.4] - 2026-09-15

### Added

- `getChainConfig(chainId)` on the package barrel so hosts can read portal strategy, oracle, fee-estimation limits, and addresses without vendoring the chain registry. `CHAIN_CONFIGS` stays internal.
- Built-in COTI Mainnet gas-grant URL (`grantApiUrlMainnet` / `DEFAULT_GRANT_API_URL_MAINNET`), matching the testnet grant path so onboarding no longer skips native COTI grants on mainnet.

## [0.4.3] - 2026-09-15

### Added

- PoD mainnet inbox family alongside testnet: fee estimate, encrypt, AES onboard, request tracking, Avalanche gas floor, and RainbowKit now target the connected network instead of testnet-only.

### Fixed

- Avalanche C-Chain price oracle now uses `PoDPriceOracle` from mainnet deploy config instead of the Chainlink live adapter.
- `executePodPortalTransaction` no longer defaults omitted `chainId` to Sepolia, which bound Avalanche mainnet deposits to the testnet inbox.
- Portal encode calls pass the mainnet encryption gateway allowlist so Avalanche deposits are not rejected as an untrusted encryption service URL.
- Avalanche and COTI mainnet PoD explorer URLs use network slugs instead of numeric chain ids.

## [0.4.2] - 2026-09-15

### Added

- Avalanche C-Chain and Ethereum mainnet in the chain registry so PoD portals can resolve RPCs and contracts on those L1s instead of falling back to COTI testnet.

## [0.4.1] - 2026-09-03

### Added

- `PLUGIN_VERSION` export. The package prints `[@coti-io/coti-wallet-plugin@x.y.z] loaded` once on import so hosts can confirm which build is on the page.

### Fixed

- Contract onboarding now closes the modal after a successful private-balance refresh. The session AES key is committed during catalog refresh, so the wait-effect previously missed it and stayed on Persisting Key.
- The onboard success screen is kept only when a non-blocking warning remains (Snap persist or encrypted backup save).

### Changed

- Debug logs around onboard close and AES session vs catalog refresh (`configureCotiPlugin({ debug: true })`).

## [0.4.0] - 2026-09-02

Breaking host API vs `0.3.10`. Hosts must upgrade to this version for the names and contracts below.

### Breaking

- Renamed public Privacy Bridge APIs to `CotiPlugin*` (`CotiPluginProvider`, `useCotiWallet`, `useCotiUnlock`, …).
- Replaced `pluginSurface` with additive `features={['tokens', 'portal', 'pod']}`. Default is core only (wallet + AES unlock).
- `refreshPrivateBalances` returns `AccountStateResult` (`{ ok, reason }`) instead of `boolean`.
- Removed `sessionAesKey` from the public unlock context. Hosts encrypt/decrypt via `encryptPrivateValue` / `decryptPrivateValue`.
- RainbowKit is optional: import `WagmiRainbowKitProvider` from `@coti-io/coti-wallet-plugin/rainbowkit`. The main entry no longer imports RainbowKit.
- Stopped exporting dApp internals from the package barrel (`useMetamask`, `OnboardModal`, `CHAIN_CONFIGS`, fee helpers, mute/logger/ABI/RPC constants, and related names).
- Raised peer floors to the validated stack (`wagmi@^2.14.0`, `viem@^2.47.0`, `react@^18.3.0`, optional `@rainbow-me/rainbowkit@^2.2.0`, and matching ethers / react-query / MetaMask provider mins). Hosts on earlier 2.x / 18.x should upgrade.

### Changed

- AES session establish is separate from token catalog refresh. Unlock still composes both.
- Chain mute, Snap AES cache, validated unlock keys, and RPC fallback live on a per-provider `PluginRuntime`.
- Onboard success no longer displays or copies the plaintext AES key.
- CI and `prepublishOnly` fail when coverage drops below the floors in `vitest.config.ts`.
- Runtime dependency `@coti-io/coti-ethers` is `^1.0.5` (the version this repo installs).

### Fixed

- MetaMask `-32002` overlapping `wallet_requestPermissions` / Snap prompts.
- Connect no longer decrypts private catalogs without a session AES key (that wrote `0.00` and could overwrite unlock).
- Private-balance RPC/decode failures no longer report as a zero balance.
- Injected MetaMask account/chain switches reset or refetch private catalogs (same as the wagmi path).
- Public ERC-20 429s off Avalanche Fuji no longer throw the Fuji-named rate-limit error.
- Onboard modal no longer reopens after a successful backup restore.
- Cached wagmi config is reused when `WagmiRainbowKitProvider` remounts.

## [0.3.10] - 2026-08-17

Published npm release. Includes testnet PoD v2.4 remount addresses and MTT faucet/portal pointer updates from the `0.3.9` → `0.3.10` window.

[Unreleased]: https://github.com/coti-io/coti-wallet-plugin/compare/v0.4.4...HEAD
[0.4.4]: https://github.com/coti-io/coti-wallet-plugin/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/coti-io/coti-wallet-plugin/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/coti-io/coti-wallet-plugin/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/coti-io/coti-wallet-plugin/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/coti-io/coti-wallet-plugin/compare/v0.3.10...v0.4.0
[0.3.10]: https://github.com/coti-io/coti-wallet-plugin/releases/tag/v0.3.10
