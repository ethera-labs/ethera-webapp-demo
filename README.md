# Ethera Rollup Bridge

Cross-rollup token bridge demo built with `@ssv-labs/ethera-sdk`.

## What this app demonstrates

- Smart account creation on two rollups
- Multi-chain user-op creation with the SDK (`createUserOp`)
- Atomic composition with `composeUnpreparedUserOps`
- Cross-rollup submission and receipt tracking
- End-to-end demo path: `L1 -> L2 -> L2 -> L1` (return leg initiates withdrawal on rollup)

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

## Complete flow

This demo now supports the full path:

1. `L1 -> L2` native ETH funding
2. `L2 -> L2` bridge (ERC-20 and ETH mode)
3. `L2 -> L1` native ETH return:
   - initiate on rollup
   - prove on L1
   - finalize on L1

For `L2 -> L1`, L2 initiation deducts balance on rollup immediately.
ETH appears on L1 only after prove + finalize complete.

No additional env keys are required for the return leg when L1 bridge config is already set (`VITE_TESTNET_L1_TO_ROLLUP_A_BRIDGE`, `VITE_TESTNET_L1_TO_ROLLUP_B_BRIDGE`, `VITE_TESTNET_L1_BRIDGE_MIN_GAS_LIMIT`).

Important behavior notes:

- Users do not call the L1 standard bridge directly for settlement.
- Settlement is completed through Optimism Portal prove/finalize calls (resolved dynamically from configured L1 bridge).
- Withdrawal readiness/prove selection uses Compose dispute-game decoding (`extraData`) + portal checks, not OP default game decoding.
- Sequencer/proposer do not automatically credit L1 wallet balance without prove/finalize.

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
