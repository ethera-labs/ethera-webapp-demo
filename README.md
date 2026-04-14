# Ethera Rollup Bridge

Cross-rollup token bridge demo built with `@ssv-labs/compose-sdk`.

## What this app demonstrates

- Smart account creation on two rollups
- Multi-chain user-op creation with the SDK (`createUserOp`)
- Atomic composition with `composeUnpreparedUserOps`
- Cross-rollup submission and receipt tracking
- Clean, client-friendly UI with Ethera + SSV-inspired styling

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

The frontend runs on `http://localhost:5173`.

## Current default mode

- `VITE_COMPOSE_NETWORK=testnet`
- Uses SDK rollup chains/contracts unless overridden in `.env`
- Uses one explicit bridged token from env (`VITE_TESTNET_TOKEN_ADDRESS`)

## Sepolia rollup override support

You can override testnet rollups directly from `.env` (RPC, explorer, chain IDs, bridge/token addresses, token symbols, and AA contracts) without touching code.

Minimal example:

```bash
VITE_COMPOSE_NETWORK=testnet
VITE_TESTNET_LABEL=Custom Testnet
VITE_TESTNET_ROLLUP_A_CHAIN_ID=111111
VITE_TESTNET_ROLLUP_A_RPC=https://rollup-a-rpc.example.com/
VITE_TESTNET_ROLLUP_B_CHAIN_ID=222222
VITE_TESTNET_ROLLUP_B_RPC=https://rollup-b-rpc.example.com/
```

For realistic POC setups, prefer a single explicit token:

```bash
VITE_TESTNET_TOKEN_ADDRESS=0x...
VITE_TESTNET_TOKEN_DECIMALS=18
VITE_TESTNET_TOKEN_SYMBOL=BTK
VITE_TESTNET_WETH_ADDRESS=0x... # required for ETH mode (L2->L2)
```

`VITE_TESTNET_WETH_ADDRESS` is required in testnet mode. If it is missing or invalid, the app fails fast on startup so ETH bridge mode cannot run with an incorrect contract address.

## Paymaster support

The app is paymaster-ready. SDK `createUserOps` requests sponsorship data when paymaster is configured.

You can configure:

- One shared endpoint: `VITE_TESTNET_PAYMASTER_URL` / `VITE_MAINNET_PAYMASTER_URL`
- Or dynamic base endpoint + chain route names:
  - `VITE_TESTNET_PAYMASTER_BASE_URL`
  - `VITE_TESTNET_ROLLUP_A_PAYMASTER_NAME`
  - `VITE_TESTNET_ROLLUP_B_PAYMASTER_NAME`
- Or explicit per-chain endpoints:
  - `VITE_TESTNET_ROLLUP_A_PAYMASTER_URL`
  - `VITE_TESTNET_ROLLUP_B_PAYMASTER_URL`
  - `VITE_MAINNET_MAINNET_PAYMASTER_URL`
  - `VITE_MAINNET_BASE_PAYMASTER_URL`

Recommended local setup:

- Dynamic mapping from one base URL:
  - `VITE_TESTNET_PAYMASTER_BASE_URL=https://paymaster.example.com/rpc/v1`
  - `VITE_TESTNET_ROLLUP_A_PAYMASTER_NAME=rollupA`
  - `VITE_TESTNET_ROLLUP_B_PAYMASTER_NAME=rollupB`

If paymaster env is omitted, the app runs in non-sponsored mode (smart accounts need native gas).

## Mainnet-ready scaffold

A config scaffold exists for mainnet in `.env.example`, but it is intentionally disabled by default.
To activate mainnet mode, set:

```bash
VITE_COMPOSE_NETWORK=mainnet
```

Then provide all required mainnet RPC and account abstraction contract values.
