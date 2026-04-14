import { composeUnpreparedUserOps } from '@ssv-labs/ethera-sdk';
import { erc20Abi } from 'viem';
import {
  COMPOSE_BUILD_TIMEOUT_MS,
  COMPOSE_SEND_TIMEOUT_MS,
  HASH_PRESENCE_POLL_ATTEMPTS,
  HASH_PRESENCE_POLL_INTERVAL_MS,
  RECEIPT_WAIT_TIMEOUT_MS,
  USER_OP_BUILD_TIMEOUT_MS
} from './constants';
import type { ExecuteComposedBridgeFlowParams, ExecuteComposedBridgeFlowResult, WalletClientLike } from './types';

// Compose SDK execution path with timeout handling and broadcast verification fallback.
const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> =>
  Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs))
  ]);

const verifySequencerBroadcast = async ({
  sourceSmartAccount,
  destinationSmartAccount,
  hashesToTrack,
  setBridgePhase
}: {
  sourceSmartAccount: ExecuteComposedBridgeFlowParams['sourceSmartAccount'];
  destinationSmartAccount: ExecuteComposedBridgeFlowParams['destinationSmartAccount'];
  hashesToTrack: `0x${string}`[];
  setBridgePhase: ExecuteComposedBridgeFlowParams['setBridgePhase'];
}) => {
  if (hashesToTrack.length < 2) return;

  setBridgePhase('Verifying sequencer broadcast for submitted hashes...');

  let sourceTxByHash: unknown = null;
  let destinationTxByHash: unknown = null;

  for (let attempt = 1; attempt <= HASH_PRESENCE_POLL_ATTEMPTS; attempt += 1) {
    [sourceTxByHash, destinationTxByHash] = await Promise.all([
      sourceSmartAccount.publicClient.request({
        method: 'eth_getTransactionByHash',
        params: [hashesToTrack[0]]
      }),
      destinationSmartAccount.publicClient.request({
        method: 'eth_getTransactionByHash',
        params: [hashesToTrack[1]]
      })
    ]);

    if (sourceTxByHash !== null && destinationTxByHash !== null) {
      return;
    }

    if (attempt < HASH_PRESENCE_POLL_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, HASH_PRESENCE_POLL_INTERVAL_MS));
    }
  }

  throw new Error(
    'Cross-rollup payload was not broadcast by the sequencer. No transaction was found for the built hashes on one or both rollups. Please retry or contact infra.'
  );
};

/**
 * Runs approval (if needed), composes user ops, submits payload via SDK send, and waits for receipts.
 */
export const executeComposedBridgeFlow = async ({
  sourceSmartAccount,
  destinationSmartAccount,
  sourceChain,
  sourceCalls,
  destinationCalls,
  selectedToken,
  walletAddress,
  sender,
  fundingContext,
  ensureWalletOnChain,
  setBridgePhase,
  onPayloadSubmitted
}: ExecuteComposedBridgeFlowParams): Promise<ExecuteComposedBridgeFlowResult> => {
  // ETH mode may need a native EOA -> smart-account transfer before source userOp creation.
  if (fundingContext.kind === 'nativeEthViaWeth' && fundingContext.amountToFundSmartAccountFromEoa > 0n) {
    setBridgePhase(`Funding source smart account with ${selectedToken.symbol}...`);

    const walletClient = (await ensureWalletOnChain(sourceChain.id)) as WalletClientLike;
    const fundingHash = await walletClient.sendTransaction({
      to: sender,
      value: fundingContext.amountToFundSmartAccountFromEoa,
      chain: sourceChain,
      account: walletAddress
    });

    setBridgePhase('Waiting for source funding confirmation...');
    await sourceSmartAccount.publicClient.waitForTransactionReceipt({ hash: fundingHash });
  }

  // ERC20 approval flow remains BTK-only and is skipped for ETH mode.
  if (
    fundingContext.kind === 'erc20' &&
    fundingContext.amountToPullFromEoa > 0n &&
    fundingContext.sourceAllowance < fundingContext.amountToPullFromEoa
  ) {
    setBridgePhase(`Approving ${selectedToken.symbol} pull from source EOA...`);

    const walletClient = (await ensureWalletOnChain(sourceChain.id)) as WalletClientLike;
    const approvalHash = await walletClient.writeContract({
      address: selectedToken.address,
      abi: erc20Abi,
      functionName: 'approve',
      args: [sender, fundingContext.amountToPullFromEoa],
      chain: sourceChain,
      account: walletAddress
    });

    setBridgePhase('Waiting for EOA approval confirmation...');
    await sourceSmartAccount.publicClient.waitForTransactionReceipt({ hash: approvalHash });
  }

  setBridgePhase('Preparing source operation...');
  const sourceUserOp = await withTimeout(
    sourceSmartAccount.account.createUserOp(sourceCalls),
    USER_OP_BUILD_TIMEOUT_MS,
    'Timed out while building source UserOperation.'
  );

  setBridgePhase('Preparing destination operation...');
  const destinationUserOp = await withTimeout(
    destinationSmartAccount.account.createUserOp(destinationCalls),
    USER_OP_BUILD_TIMEOUT_MS,
    'Timed out while building destination UserOperation.'
  );

  setBridgePhase('Awaiting wallet signature and composing payload...');
  const composed = await withTimeout(
    composeUnpreparedUserOps([sourceUserOp, destinationUserOp], {
      onSigned: () => {
        setBridgePhase('User operations signed. Building chain transactions...');
      },
      onComposed: () => {
        setBridgePhase('Composed successfully. Submitting cross-rollup payload...');
      }
    }),
    COMPOSE_BUILD_TIMEOUT_MS,
    'Timed out while composing user operations. Confirm wallet signature prompts and verify compose RPC availability.'
  );

  setBridgePhase('Submitting cross-rollup payload...');
  const sendResult = await withTimeout(
    composed.send(),
    COMPOSE_SEND_TIMEOUT_MS,
    'Timed out while submitting cross-rollup payload (eth_sendXTransaction). Verify RPC/sequencer health and retry.'
  );

  const hashesToTrack = sendResult.hashes;
  onPayloadSubmitted({
    hashesToTrack,
    explorerUrls: composed.explorerUrls
  });

  setBridgePhase('Payload submitted. Waiting for rollup confirmations...');

  try {
    const receipts = await withTimeout(
      sendResult.wait(),
      RECEIPT_WAIT_TIMEOUT_MS,
      'Timed out while waiting for cross-rollup confirmations. Check explorer links.'
    );

    return {
      hashesToTrack,
      explorerUrls: composed.explorerUrls,
      receiptStatuses: receipts.map((receipt) => (receipt.status === 'success' ? 'success' : 'failed'))
    };
  } catch (executionError) {
    const timedOut = executionError instanceof Error && executionError.message.includes('Timed out while waiting for');

    if (timedOut) {
      await verifySequencerBroadcast({
        sourceSmartAccount,
        destinationSmartAccount,
        hashesToTrack,
        setBridgePhase
      });
    }

    throw executionError;
  }
};
