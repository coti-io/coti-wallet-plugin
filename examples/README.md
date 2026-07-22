# COTI Wallet Plugin — Example App

Minimal React app demonstrating `@coti-io/coti-wallet-plugin`.

**Documentation:** [Example App guide](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/example-app)

Encrypted AES backups in this example use **localStorage only** (development / same-device convenience). For production remote storage auth, see [Secure Remote AES Backup Storage](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/aes-backup-remote-storage) and the [AES Backup Security](https://docs.coti.io/coti-documentation/build-on-coti/tools/coti-wallet-plugin/aes-backup-security) model.

## Quick start

```bash
cp .env.example .env
# Add VITE_WALLETCONNECT_PROJECT_ID from https://cloud.walletconnect.com
npm run dev
```

Opens at http://localhost:5173
