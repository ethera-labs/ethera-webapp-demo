import { composeUnpreparedUserOps } from '@ssv-labs/ethera-sdk';
import { erc20Abi, parseEventLogs, type Log, type TransactionReceipt } from 'viem';
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

const entryPointEventsAbi = [
  {
    type: 'event',
    name: 'UserOperationEvent',
    anonymous: false,
    inputs: [
      { name: 'userOpHash', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'paymaster', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'success', type: 'bool', indexed: false },
      { name: 'actualGasCost', type: 'uint256', indexed: false },
      { name: 'actualGasUsed', type: 'uint256', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'UserOperationRevertReason',
    anonymous: false,
    inputs: [
      { name: 'userOpHash', type: 'bytes32', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: false },
      { name: 'revertReason', type: 'bytes', indexed: false }
    ]
  }
] as const;

const MESSAGE_NOT_FOUND_SELECTOR = '0x28915ac7';

const resolveUserOpOutcome = ({
  logs,
  expectedSender
}: {
  logs: Log[];
  expectedSender: `0x${string}`;
}) => {
  const userOperationEvents = parseEventLogs({
    abi: entryPointEventsAbi,
    eventName: 'UserOperationEvent',
    logs,
    strict: false
  });
  const userOperationRevertEvents = parseEventLogs({
    abi: entryPointEventsAbi,
    eventName: 'UserOperationRevertReason',
    logs,
    strict: false
  });

  const successEvent = userOperationEvents.find(
    (eventLog) => eventLog.args.sender?.toLowerCase() === expectedSender.toLowerCase()
  );
  const revertEvent = userOperationRevertEvents.find(
    (eventLog) => eventLog.args.sender?.toLowerCase() === expectedSender.toLowerCase()
  );

  return {
    success: successEvent?.args.success,
    revertReason: revertEvent?.args.revertReason
  };
};

const resolveRevertReasonMessage = (revertReason: `0x${string}` | undefined) => {
  if (!revertReason || revertReason.length < 10) return 'User operation reverted onchain.';

  const selector = revertReason.slice(0, 10).toLowerCase();
  if (selector === MESSAGE_NOT_FOUND_SELECTOR) {
    return 'Destination mailbox message is not available yet (MessageNotFound).';
  }

  return `User operation reverted onchain (selector: ${selector}).`;
};

const assertUserOperationSucceeded = ({
  receipt,
  expectedSender,
  stepLabel
}: {
  receipt: TransactionReceipt;
  expectedSender: `0x${string}`;
  stepLabel: string;
}) => {
  if (receipt.status !== 'success') {
    throw new Error(`${stepLabel} transaction reverted onchain.`);
  }

  const outcome = resolveUserOpOutcome({
    logs: receipt.logs,
    expectedSender
  });

  if (outcome.success === false) {
    throw new Error(`${stepLabel} failed: ${resolveRevertReasonMessage(outcome.revertReason)}`);
  }
};

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

const prepareSourceFundingIfNeeded = async ({
  sourceSmartAccount,
  sourceChain,
  selectedToken,
  walletAddress,
  sender,
  fundingContext,
  ensureWalletOnChain,
  setBridgePhase
}: {
  sourceSmartAccount: ExecuteComposedBridgeFlowParams['sourceSmartAccount'];
  sourceChain: ExecuteComposedBridgeFlowParams['sourceChain'];
  selectedToken: ExecuteComposedBridgeFlowParams['selectedToken'];
  walletAddress: ExecuteComposedBridgeFlowParams['walletAddress'];
  sender: ExecuteComposedBridgeFlowParams['sender'];
  fundingContext: ExecuteComposedBridgeFlowParams['fundingContext'];
  ensureWalletOnChain: ExecuteComposedBridgeFlowParams['ensureWalletOnChain'];
  setBridgePhase: ExecuteComposedBridgeFlowParams['setBridgePhase'];
}) => {
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
};

/**
 * Runs approval (if needed), composes source+destination user ops, submits once, and waits for both receipts.
 */
export const executeComposedBridgeFlow = async ({
  sourceSmartAccount,
  destinationSmartAccount,
  sourceChain,
  destinationChain,
  sourceCalls,
  destinationCalls,
  selectedToken,
  walletAddress,
  sender,
  receiver,
  fundingContext,
  ensureWalletOnChain,
  setBridgePhase,
  onStageSubmitted,
  onStageStatusUpdated
}: ExecuteComposedBridgeFlowParams): Promise<ExecuteComposedBridgeFlowResult> => {
  await prepareSourceFundingIfNeeded({
    sourceSmartAccount,
    sourceChain,
    selectedToken,
    walletAddress,
    sender,
    fundingContext,
    ensureWalletOnChain,
    setBridgePhase
  });

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
  const explorerUrls = composed.explorerUrls;

  for (let index = 0; index < hashesToTrack.length; index += 1) {
    const hash = hashesToTrack[index];
    if (!hash) continue;

    onStageSubmitted({
      hash,
      explorerUrl: explorerUrls[index] ?? '',
      chainLabel: index === 0 ? sourceChain.name : destinationChain.name,
      stepLabel: index === 0 ? 'Source bridge submit' : 'Destination receive + payout'
    });
  }

  setBridgePhase('Payload submitted. Waiting for rollup confirmations...');

  try {
    const receipts = await withTimeout(
      sendResult.wait(),
      RECEIPT_WAIT_TIMEOUT_MS,
      'Timed out while waiting for cross-rollup confirmations. Check explorer links.'
    );

    const sourceReceipt = receipts[0];
    const destinationReceipt = receipts[1];

    if (!sourceReceipt || !destinationReceipt) {
      throw new Error('Cross-rollup confirmation is missing source or destination receipt.');
    }

    try {
      assertUserOperationSucceeded({
        receipt: sourceReceipt,
        expectedSender: sender,
        stepLabel: 'Source bridge submit'
      });
      if (hashesToTrack[0]) {
        onStageStatusUpdated({ hash: hashesToTrack[0], status: 'success' });
      }
    } catch (sourceError) {
      if (hashesToTrack[0]) {
        onStageStatusUpdated({ hash: hashesToTrack[0], status: 'failed' });
      }
      throw sourceError;
    }

    try {
      assertUserOperationSucceeded({
        receipt: destinationReceipt,
        expectedSender: receiver,
        stepLabel: 'Destination receive + payout'
      });
      if (hashesToTrack[1]) {
        onStageStatusUpdated({ hash: hashesToTrack[1], status: 'success' });
      }
    } catch (destinationError) {
      if (hashesToTrack[1]) {
        onStageStatusUpdated({ hash: hashesToTrack[1], status: 'failed' });
      }
      throw destinationError;
    }

    return {
      hashesToTrack,
      explorerUrls,
      chainLabels: hashesToTrack.map((_, index) => (index === 0 ? sourceChain.name : destinationChain.name)),
      stepLabels: hashesToTrack.map((_, index) => (index === 0 ? 'Source bridge submit' : 'Destination receive + payout')),
      receiptStatuses: hashesToTrack.map((_, index) => {
        const receipt = receipts[index];
        return receipt?.status === 'success' ? 'success' : 'failed';
      })
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
