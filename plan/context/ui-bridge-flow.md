# Universal Shared Bridge — UI Integration Flows

## 1. L1 → L2a (deposit)

### 1a. ERC-20 deposit

**User actions**
1. `IERC20(T).approve(L1ComposeBridge, amount)`
2. `L1ComposeBridge.bridgeERC20To(_localToken=T, _remoteToken=predictedCET, _to, _amount, _minGasLimit, _extraData)`
   - `_extraData` = `abi.encode(name, symbol, decimals, userExtra)` — metadata used if CET not yet deployed on L2a.
   - `predictedCET` = `CetFactory.predictAddress(T, L1_CHAIN_ID)` (UI computes off-chain).

**Behind the scenes**
- `L1ComposeBridge` forwards ERC-20 to `ComposePortal` → locks in `ComposeERC20Lockbox`.
- Emits `TransactionDeposited` → op-node derives an L2 deposit tx.
- On L2a: `L2CrossDomainMessenger` → `L2ComposeBridge.finalizeBridgeERC20`:
  - `CetFactory.deployIfAbsent(T, L1_CHAIN_ID, decimals, name, symbol)` (first deposit deploys Wrapped CET).
  - `IComposableERC20(cet).crosschainMint(_to, _amount)`.

**User sees on L2a.** CET balance at `predictedCET`. Always **Wrapped** flavor (`cetType() == WRAPPED`).

**UI notes**
- CET address is deterministic — can be displayed and added to wallet before the deposit lands.
- Deposit finalization latency ≈ L1 confirmation + op-node derivation (~minutes, chain-specific).
- Poll `ERC20BridgeFinalized` event on L2a or watch CET balance.

### 1b. ETH deposit

**User actions**
1. `L1ComposeBridge.bridgeETHTo{value: amount}(_to, _minGasLimit, _extraData)` (or `bridgeETH` to self).

**Behind the scenes**
- ETH forwarded through `ComposePortal` → `ComposeETHLockbox`.
- `TransactionDeposited` → L2a deposit tx.
- `L2ComposeBridge.finalizeBridgeETH` forwards `msg.value` as native ETH to `_to`.

**User sees on L2a.** Native ETH balance at `_to`. No CET involved on the L1↔L2 ETH leg
(ETH stays native on both sides).

---

## 2. L2a → L2b

### 2a. CET hop (L2a → L2b)

User holds CET on L2a from step 1.

**User actions on L2a**
1. `IERC20(cet).approve(ComposeL2ToL2Bridge, amount)`
2. `ComposeL2ToL2Bridge.bridgeCETTo(chainDest=L2b, cetTokenSrc=cet, amount, receiver, sessionId)`

**Behind the scenes on L2a**
- `IComposableERC20(cet).crosschainBurn(sender, amount)` — supply destroyed.
- `mailbox.writeMessage(SEND_TOKENS, payload = abi.encode(L1_CHAIN_ID, T, amount, name, symbol, decimals))`.
- Source bridge then awaits `ACK` via `mailbox.readMessage` (`checkAck`).

**Coordinator relay.** An off-chain coordinator reads `SEND_TOKENS` from L2a's outbox and
calls `mailbox.putInbox(...)` on L2b. UI does not trigger this.

**User actions on L2b**
3. `ComposeL2ToL2Bridge.receiveTokens(msgHeader)` — **must be called by `msgHeader.receiver`**.

**Behind the scenes on L2b**
- `mailbox.readMessage(SEND_TOKENS)` — read-once.
- Destination branch (`ensureCETAndMint`):
  - If L2b hosts escrowed native of asset → release native ERC-20.
  - Else if a Core CET exists on L2b → mint into Core.
  - Else → deploy (if absent) + mint **Wrapped CET** at `predictedCET`.
- Writes `ACK` back to mailbox for L2a.

**User sees on L2b.** CET (same address as on L2a) or native ERC-20, depending on branch.

### 2b. Native ERC-20 hop (L2a → L2b, asset native to L2a)

Only applies if the asset is a non-CET ERC-20 native to L2a (not bridged from L1).

**User actions on L2a**
1. `IERC20(token).approve(ComposeL2ToL2Bridge, amount)`.
2. `ComposeL2ToL2Bridge.bridgeERC20To(chainDest, tokenSrc, amount, receiver, sessionId)`.

**Behind the scenes.** Token locked on L2a; payload encodes `(L2a_chainId, token, …)`. On L2b,
`receiveTokens` mints Wrapped CET (or Core if present).

**User sees on L2b.** Wrapped CET at `cetFactory.predictAddress(tokenOnL2a, L2a_CHAIN_ID)`.

### 2c. ETH hop (L2a → L2b)

**User actions on L2a**
1. `ComposeL2ToL2Bridge.bridgeEthTo{value: amount}(sessionId, chainDest, receiver)`.

**User actions on L2b**
2. `ComposeL2ToL2Bridge.receiveETH(msgHeader)` — called by receiver.

Native ETH in, native ETH out (uses `ETHLiquidity` pool on both sides).

### UI notes for L2↔L2

- **sessionId** must be unique.
- `receiveTokens` / `receiveETH` require the receiver as `msg.sender`.

---

## 3. L2b → L1 (withdrawal)

User holds CET on L2b. Withdraw to L1 to redeem the original locked asset.

### 3a. ERC-20 withdrawal

**User actions on L2b**
1. `L2ComposeBridge.bridgeERC20To(_localToken=CET, _remoteToken=T, _to, _amount, _minGasLimit, _extraData)`
   - `_localToken` must match `cetFactory.predictAddress(T, L1_CHAIN_ID)`.

**Behind the scenes on L2b**
- `IComposableERC20(CET).crosschainBurn(from, amount)`.
- `L2CrossDomainMessenger.sendMessage` → targets `ComposeL1Bridge.finalizeBridgeERC20` on L1.

**Withdrawal proof phase (L1)**
- After the L2 post-root is finalized, a prover submits the withdrawal to `ComposePortal` →
  verified via `ComposeDisputeGame` (OP-Succinct validity proof).
- UI surfaces: "Proving" → "Ready to finalize" → "Finalized".

**Finalization on L1**
- `ComposePortal.finalizeWithdrawalTransaction(...)` → `L1CrossDomainMessenger` →
  `ComposeL1Bridge.finalizeBridgeERC20`.
- Releases ERC-20 from `ComposeERC20Lockbox` to `_to`.

**User sees on L1.** Original ERC-20 `T` balance at `_to`.

### 3b. ETH withdrawal

**User actions on L2b**
1. `L2ComposeBridge.bridgeETHTo{value: amount}(_to, _minGasLimit, _extraData)`.

Rest mirrors 3a: prove → finalize → `ComposeETHLockbox` releases native ETH to `_to`.

---

## 4. End-to-end summary (ERC-20)

| Step | Chain | Call | Who calls | Latency |
|---|---|---|---|---|
| 1 | L1 | `ComposeL1Bridge.bridgeERC20To` | user | L1 block |
| 2 | L2a | `L2ComposeBridge.finalizeBridgeERC20` | op-node deposit tx | ~minutes |
| 3 | L2a | `ComposeL2ToL2Bridge.bridgeCETTo` | user | L2a block |
| 4 | L2b | `ComposeL2ToL2Bridge.receiveTokens` | user (receiver) | after coordinator relay |
| 5 | L2b | `L2ComposeBridge.bridgeERC20To` | user | L2b block |
| 6 | L1 | `ComposePortal.finalizeWithdrawalTransaction` | user (after prove) | after post-root finalized |

Token representation across the journey:
- L1: native ERC-20 `T` (escrowed in `ComposeERC20Lockbox`).
- L2a: Wrapped CET at `predictedCET = predictAddress(T, L1_CHAIN_ID)`.
- L2b: Wrapped CET at same `predictedCET`.
- L1 (after withdrawal): native ERC-20 `T` (released from lockbox).

## 5. End-to-end summary (ETH)

| Step | Chain | Call | Who calls |
|---|---|---|---|
| 1 | L1 | `ComposeL1Bridge.bridgeETHTo{value}` | user |
| 2 | L2a | `L2ComposeBridge.finalizeBridgeETH` | op-node deposit tx |
| 3 | L2a | `ComposeL2ToL2Bridge.bridgeEthTo{value}` | user |
| 4 | L2b | `ComposeL2ToL2Bridge.receiveETH` | user (receiver) |
| 5 | L2b | `L2ComposeBridge.bridgeETHTo{value}` | user |
| 6 | L1 | `ComposePortal.finalizeWithdrawalTransaction` | user (after prove) |

ETH is native on every hop — no CET involved.

---

## 6. Wrapped vs Core CET (UI-facing)

- **Wrapped** (default): deployed by the bridge via `CetFactory` on first deposit. Address
  deterministic from `(remoteAsset, remoteChainID)`. `cetType() == WRAPPED`.
- **Core** (optional): deployed by the asset issuer natively on a chain. `cetType() == CORE`.
  Bridge mints directly into Core when present.
- **Conversion (same chain):** `ComposeL2ToL2Bridge.redeemWrappedCET(wrapped, core, amount)`
  lets users swap their Wrapped for Core 1:1 once a Core has been deployed. Call is 1 tx, no
  cross-chain hop.