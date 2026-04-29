# Ethera Webapp Demo

Universal bridge demo for Ethera.

This app is a demo that shows the full Ethera flow across Sepolia and two rollups:
- `L1 -> L2`
- `L2 -> L2`
- `L2 -> L1`

## What This Demo Covers

- Smart account creation on both rollups with `@ssv-labs/ethera-sdk`
- Universal bridge deposits from Sepolia to either rollup
- Cross-rollup transfers between Rollup A and Rollup B
- Rollup withdrawals back to Sepolia
- Optional paymaster support
- Token import for canonical L1 assets and rollup-side assets

This app follows the universal bridge flow.

## Bridge Flows

### L1 -> L2

Source chain: Sepolia  
Destination chain: Rollup A or Rollup B

Contract path:
- `ComposeL1Bridge` on Sepolia
- `L2ComposeBridge` on the destination rollup

Behavior:
- ETH uses `bridgeETHTo(...)`
- Canonical L1 ERC20 uses `bridgeERC20To(...)`
- If the asset does not yet exist on the destination rollup, the destination side can deploy the CET representation before minting

Notes:
- For first-time CET creation, the message gas limit matters
- The current recommended Sepolia config uses `VITE_TESTNET_L1_BRIDGE_MIN_GAS_LIMIT=2000000`

### L2 -> L2

Source chain: Rollup A or Rollup B  
Destination chain: the other rollup

Contract path:
- `ComposeL2ToL2Bridge` on the source rollup
- `ComposeL2ToL2Bridge` on the destination rollup

SDK usage:
- build source and destination UserOps with the Ethera SDK
- compose them into one cross-rollup payload
- submit once and track both rollup transactions

Behavior:
- ETH uses `bridgeEthTo(...)`
- Plain ERC20 uses `bridgeERC20To(...)`
- CET uses `bridgeCETTo(...)`
- The app resolves the token route dynamically from the source token

Notes:
- Some CET routes need higher destination-side UserOp gas, especially when the destination rollup must deploy the CET for the first time
- The current Sepolia example env includes destination-side gas overrides for that case

### L2 -> L1

Source chain: Rollup A or Rollup B  
Destination chain: Sepolia

Contract path:
- `L2ComposeBridge` on the source rollup
- `ComposePortal` on Sepolia

Behavior:
1. Submit the withdrawal on the rollup
2. Wait until the withdrawal becomes provable on Sepolia
3. Submit the prove transaction on Sepolia
4. Wait until the proof matures
5. Submit the finalize transaction on Sepolia

Important:
- This is not a one-click instant return flow
- On the current Sepolia setup, proving depends on the dispute game pipeline
- Finalization is time-gated by the portal
- The return flow should use its own lower gas setting via `VITE_TESTNET_L2_TO_L1_MIN_GAS_LIMIT`

Observed Sepolia behavior during testing:
- `ready-to-prove` typically appeared after the next eligible dispute game was published
- finalization is gated by the portal's configured proof maturity delay

## Contracts

Main universal bridge contracts used by the demo:
- `ComposeL1Bridge`
- `L2ComposeBridge`
- `ComposeL2ToL2Bridge`
- `ComposePortal`

The working Sepolia example config is documented in [.env.testnet.example](./.env.testnet.example).

## Getting Started

### Requirements

- Node.js 20+
- npm
- MetaMask or another injected wallet

### Install

```bash
npm install
cp .env.testnet.example .env
npm run dev
```

The app runs at `http://localhost:5173`.

### Validate the Build

```bash
npm run build
npm run lint
```

## Environment

The app expects a Vite env file. For testnet:

```bash
cp .env.testnet.example .env
```

Main config groups:
- token config
- L1 bridge config
- universal bridge route config
- optional paymaster config
- optional gas tuning for known CET deployment cases

The SDK already provides rollup chain defaults and AA defaults. The env file mainly carries route-specific bridge configuration and demo token settings.

## Quick Start

### 1. Fund Sepolia

You need:
- Sepolia ETH for gas
- Sepolia USDC if you want to test the USDC path

USDC faucet:
- Circle Public Faucet: https://faucet.circle.com

For Sepolia ETH, use your preferred Sepolia faucet.

### 2. Bridge Sepolia -> Rollup

In the `L1 to Rollup` section:
- choose Rollup A or Rollup B
- choose ETH or a canonical L1 token
- submit the bridge

If you bridge USDC for the first time to a rollup, the destination CET may be created during the deposit.

### 3. Bridge Rollup -> Rollup

In the `Rollup Bridge` section:
- choose source and destination rollups
- choose the asset
- if the asset is not listed, import it
- submit the bridge

For bridged assets like USDC CET, import the token using the token address on the current source rollup.

### 4. Withdraw Rollup -> Sepolia

In the `Rollup to L1` section:
- choose the source rollup
- choose ETH or a canonical L1 token
- submit the withdrawal

Then complete the return flow in stages:
- wait for `Ready to prove`
- click `Prove on L1`
- wait for `Ready to finalize`
- click `Finalize on L1`

## Paymaster Support

Paymaster support is optional.

If paymaster config is present:
- the app runs in sponsored mode

If paymaster config is absent:
- the app checks EntryPoint funding and prompts for top-up when needed

## Notes for Testing

- Imported tokens are meant to make testing smoother, especially for freshly bridged assets
- Rollup-to-rollup CET transfers may need higher destination gas than plain ERC20 routes
- L2 -> L1 completion time depends on the live dispute game and portal state

## Tech Stack

- React
- TypeScript
- Vite
- `viem`
- `wagmi`
- `@ssv-labs/ethera-sdk`
