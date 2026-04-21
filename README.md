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

## Current Bridge Flows (legacy branch)

This branch exposes three user flows in the UI:

1. **Rollup Bridge (`L2 -> L2`)**
2. **L1 to Rollup Bridge (`L1 -> L2`)**
3. **Bridge Back to L1 (`L2 -> L1`)**

---

### 1) Rollup Bridge (`L2 -> L2`)

Moves assets between Rollup A and Rollup B using a composed cross-rollup payload.

**What the user does**
- Select source rollup, destination rollup, token, amount.
- Sign once for composed cross-rollup execution.

**Contracts / components involved**
- `ComposeL2ToL2Bridge` (send + receive path)
- Smart Account (source + destination)
- Ethera SDK composition (`composeUnpreparedUserOps`)

**Asset handling**
- **ERC20 mode:** source token approve + send, destination receive + transfer to EOA.
- **ETH mode:** source native pre-funding + WETH wrap/approve/send, destination receive + WETH unwrap + native transfer to EOA.

**When funds are visible**
- After source/destination rollup confirmations complete.

---

### 2) L1 to Rollup Bridge (`L1 -> L2`)

Funds a rollup account from L1.

**What the user does**
- Choose destination rollup and amount.
- Submit L1 bridge transaction.

**Contracts / components involved**
- `L1StandardBridge` (`bridgeETHTo`)
- L2 bridge counterpart resolved by configuration

**When funds are visible**
- After L1 transaction confirms and L2 side finalization/derivation completes.

---

### 3) Bridge Back to L1 (`L2 -> L1`)

Withdraws native ETH from rollup back to L1 with explicit settlement steps.

**What the user does**
1. Submit withdrawal on L2.
2. Wait until status is **Ready to prove**.
3. Submit **Prove on L1**.
4. Wait until status is **Ready to finalize**.
5. Submit **Finalize on L1**.

**Contracts / components involved**
- `L2StandardBridge` (`bridgeETHTo`) for withdrawal initiation
- `L1CrossDomainMessenger` (resolved from configured L1 bridge)
- `OptimismPortal` / portal contract (resolved dynamically)
- `DisputeGameFactory` (resolved dynamically)

**When funds are visible**
- Only after **Finalize on L1** succeeds.

---

## Contract Role Reference

- **`ComposeL2ToL2Bridge`**: handles rollup-to-rollup token/ETH transfer flow.
- **`L1StandardBridge`**: entry point for L1 -> L2 funding transactions.
- **`L2StandardBridge`**: entry point for L2 -> L1 withdrawal initiation.
- **`L1CrossDomainMessenger`**: message relay layer for bridge settlement.
- **`OptimismPortal` / portal**: prove/finalize settlement checks and execution.
- **`DisputeGameFactory`**: source of dispute games/outputs used to determine proving readiness.

---

## Withdrawal Timing (important)

For `L2 -> L1`, **proving is asynchronous** and depends on output/game publication cadence.

That means:
- `Waiting to prove` can be normal for some time.
- Users must still execute **prove** and **finalize** (two separate L1 transactions).
- L1 balance does not update at withdrawal submit time.

---

## Practical UX expectation

For return withdrawals:
- L2 submit is immediate.
- Proving availability may take time depending on publisher cadence.
- Settlement completes only after user runs prove + finalize.

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
