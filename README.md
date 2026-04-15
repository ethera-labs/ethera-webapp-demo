# Ethera Rollup Bridge

Cross-rollup token bridge demo built with `@ssv-labs/ethera-sdk`.

## What this app demonstrates

- Smart account creation on two rollups
- Multi-chain user-op creation with the SDK (`createUserOp`)
- Atomic composition with `composeUnpreparedUserOps`
- Cross-rollup submission and receipt tracking

## Run locally

```bash
npm install
cp .env.testnet.example .env
npm run dev
```

The frontend runs on `http://localhost:5173`.

## Environment setup

Use one of the minimal templates:

```bash
cp .env.testnet.example .env
# or
cp .env.mainnet.example .env
```

Notes:

- `.env.testnet.example` is the minimal client-demo setup for testnet.
- `.env.mainnet.example` is the minimal mainnet scaffold (includes required AA keys).

### Paymaster (optional)

Paymaster is optional and controlled by endpoint config presence:

- If paymaster endpoint config is present, app runs in sponsored mode.
- If paymaster endpoint config is absent, app runs in non-sponsored mode.

Recommended pattern (included as commented lines in both env templates):

- Base URL + default route names.
- Testnet defaults: `rollupA` and `rollupB`
- Mainnet defaults: `mainnet` and `base`

Example:

```bash
VITE_TESTNET_PAYMASTER_BASE_URL=https://paymaster.example.com/rpc/v1
# optional, defaults are already wired
VITE_TESTNET_ROLLUP_A_PAYMASTER_NAME=rollupA
VITE_TESTNET_ROLLUP_B_PAYMASTER_NAME=rollupB
```

### Advanced paymaster overrides

Supported override patterns:

1. Shared endpoint for all chains:
   - `VITE_TESTNET_PAYMASTER_URL`
   - `VITE_MAINNET_PAYMASTER_URL`
2. Explicit per-chain endpoints:
   - `VITE_TESTNET_ROLLUP_A_PAYMASTER_URL`
   - `VITE_TESTNET_ROLLUP_B_PAYMASTER_URL`
   - `VITE_MAINNET_MAINNET_PAYMASTER_URL`
   - `VITE_MAINNET_BASE_PAYMASTER_URL`
3. Base endpoint + custom route names:
   - `VITE_TESTNET_PAYMASTER_BASE_URL` + route-name overrides
   - `VITE_MAINNET_PAYMASTER_BASE_URL` + route-name overrides

Endpoint precedence in app config:

- Per-chain endpoint override
- Base endpoint + route name
- Shared endpoint

## SDK boundary

`@ssv-labs/ethera-sdk` provides:

- paymaster integration plumbing (`getPaymasterEndpoint` callback flow)
- SDK defaults for rollup chains and AA testnet contracts

The webapp/environment provides:

- concrete paymaster endpoint URLs
- bridge/token/WETH/L1 bridge addresses
- optional route-name overrides
