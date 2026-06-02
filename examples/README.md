# COTI Wallet Plugin — Example App

Minimal React app demonstrating the `@coti-io/coti-wallet-plugin` library. Connects a wallet via RainbowKit and displays public and private token balances from the [COTI Token List](https://github.com/coti-io/coti-token-list).

## Prerequisites

- Node.js 18+
- The parent plugin must be built first (`npm run build` in the root directory)

## Setup

```bash
# From the repository root
npm run build

# Then in the examples directory
cd examples
cp .env.example .env
npm install
```

Edit `.env` and add your WalletConnect project ID (get one at https://cloud.walletconnect.com):

```
VITE_WALLETCONNECT_PROJECT_ID=your_project_id_here
```

## Run

```bash
npm run dev
```

Opens at http://localhost:5173

## What It Does

1. **Connect Wallet** — Click to open RainbowKit modal (MetaMask, Coinbase, WalletConnect, etc.)
2. **Public Balances** — Reads on-chain ERC20 `balanceOf` for all public tokens on the connected chain
3. **Native COTI** — Displays native COTI balance via wagmi
4. **Private Balances** — Click "Unlock Private Balances" to derive the AES key, then decrypted private token balances appear

## Network

The app targets **COTI Testnet** (chain ID 7082400) by default. Switch your wallet to COTI Testnet to see token balances.
