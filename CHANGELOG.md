# Changelog

All notable changes to `@coti-io/coti-wallet-plugin` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Version numbers follow [SemVer](https://semver.org/).

## [Unreleased]

Intended for the next npm release after `0.3.10`. Hosts on `0.3.10` should treat the items below as breaking until that version is published.

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

[Unreleased]: https://github.com/coti-io/coti-wallet-plugin/compare/v0.3.10...HEAD
[0.3.10]: https://github.com/coti-io/coti-wallet-plugin/releases/tag/v0.3.10
