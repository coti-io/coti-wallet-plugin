# NPM Publish Checklist

Use this checklist for the final PR before publishing `@coti-io/coti-wallet-plugin`.

## Package Decision

- Publish package: `@coti-io/coti-wallet-plugin`
- Version: `0.1.0`
- Access: public scoped package (`publishConfig.access = "public"`)
- License: Apache 2.0, matching the repository `LICENSE` (same as `@coti-io/coti-sdk-typescript`)

## Required Validation

```bash
npm run clean
npm run typecheck
npm test -- --run
npm run build
npm pack --dry-run
```

`prepublishOnly` runs the same clean, typecheck, test, and build gate before `npm publish`.

## Tarball Smoke

Before publishing, install the packed tarball into a clean app and import the public entrypoint. This release was smoke-tested with:

```bash
npm install ./coti-io-coti-wallet-plugin-0.1.0.tgz \
  react@18.3.1 react-dom@18.3.1 ethers@6.16.0 viem@2.47.10 wagmi@2.14.0 \
  @tanstack/react-query@5.62.0 @rainbow-me/rainbowkit@2.2.0 \
  @metamask/providers@22.1.1 @coti-io/coti-sdk-typescript@1.0.8
```

Then verify the package imports:

```bash
node --input-type=module -e "const m = await import('@coti-io/coti-wallet-plugin'); if (!m.PrivacyBridgeProvider || !m.WagmiRainbowKitProvider) throw new Error('missing exports')"
```

## Publish

```bash
npm publish --access public
```

Make sure the publishing account has access to the COTI npm organization before running the command.
