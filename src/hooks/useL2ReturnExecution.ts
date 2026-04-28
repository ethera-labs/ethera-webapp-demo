import { useCallback, useMemo, useState } from 'react';
import { erc20Abi, type Chain } from 'viem';
import { getWithdrawals } from 'viem/op-stack';
import { composeConfig, type L1FundingConfig } from '../composeConfig';
import { parsePositiveAssetAmountInput } from '../lib/assets';
import { buildComposeProveWithdrawalArgs, getComposeWithdrawalStatus } from '../lib/composeSettlement';
import { normalizeExecutionErrorMessage } from '../lib/errors';
import { formatChainLabel } from '../lib/format';
import { l2StandardBridgeAbi } from '../lib/l1Bridge';
import type {
  ReturnExecutionAsset,
  ReturnResult,
  ReturnSettlementContracts,
  WithdrawalLifecycleStatus
} from '../types/funding';

// Handles rollup -> L1 withdrawal initiation and settlement lifecycle.
type WalletClientLike = {
  writeContract: (...args: unknown[]) => Promise<`0x${string}`>;
  getChainId: () => Promise<number>;
};

type UseL2ReturnExecutionParams = {
  amountInput: string;
  selectedAsset: ReturnExecutionAsset;
  walletAddress: `0x${string}` | undefined;
  sourceChain: Chain;
  l1FundingConfig: L1FundingConfig | undefined;
  sourceL2BridgeAddress: `0x${string}` | undefined;
  settlementContracts: ReturnSettlementContracts | undefined;
  availableSourceBalance: bigint | undefined;
  ensureWalletOnChain: (targetChainId: number) => Promise<unknown>;
  onClearErrors: () => void;
  onReturnError: (message: string) => void;
  onReturnSuccess: () => void;
};

const MAX_RETURN_HISTORY = 12;

const composePortalSuperRootProveAbi = [
  {
    type: 'function',
    name: 'proveWithdrawalTransaction',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: '_tx',
        type: 'tuple',
        components: [
          { name: 'nonce', type: 'uint256' },
          { name: 'sender', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'data', type: 'bytes' }
        ]
      },
      { name: '_disputeGameProxy', type: 'address' },
      { name: '_outputRootIndex', type: 'uint256' },
      {
        name: '_superRootProof',
        type: 'tuple',
        components: [
          { name: 'version', type: 'bytes1' },
          { name: 'timestamp', type: 'uint64' },
          {
            name: 'outputRoots',
            type: 'tuple[]',
            components: [
              { name: 'chainId', type: 'uint256' },
              { name: 'root', type: 'bytes32' }
            ]
          }
        ]
      },
      {
        name: '_outputRootProof',
        type: 'tuple',
        components: [
          { name: 'version', type: 'bytes32' },
          { name: 'stateRoot', type: 'bytes32' },
          { name: 'messagePasserStorageRoot', type: 'bytes32' },
          { name: 'latestBlockhash', type: 'bytes32' }
        ]
      },
      { name: '_withdrawalProof', type: 'bytes[]' }
    ],
    outputs: []
  }
] as const;

const composePortalFinalizeWithdrawalAbi = [
  {
    type: 'function',
    name: 'finalizeWithdrawalTransactionExternalProof',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: '_tx',
        type: 'tuple',
        components: [
          { name: 'nonce', type: 'uint256' },
          { name: 'sender', type: 'address' },
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'gasLimit', type: 'uint256' },
          { name: 'data', type: 'bytes' }
        ]
      },
      { name: '_proofSubmitter', type: 'address' }
    ],
    outputs: []
  }
] as const;

type ReturnResultContext = Omit<
  ReturnResult,
  'status' | 'lifecycleStatus' | 'proveTxHash' | 'proveTxExplorerUrl' | 'finalizeTxHash' | 'finalizeTxExplorerUrl'
>;

/**
 * Builds a return result from shared context plus lifecycle status fields.
 */
const buildReturnResult = ({
  context,
  status,
  lifecycleStatus
}: {
  context: ReturnResultContext;
  status: ReturnResult['status'];
  lifecycleStatus: ReturnResult['lifecycleStatus'];
}): ReturnResult => ({
  ...context,
  status,
  lifecycleStatus
});

const returnResultToContext = (result: ReturnResult): ReturnResultContext => ({
  hash: result.hash,
  explorerUrl: result.explorerUrl,
  sourceChainLabel: result.sourceChainLabel,
  destinationChainLabel: result.destinationChainLabel,
  sourceChainId: result.sourceChainId,
  destinationChainId: result.destinationChainId,
  recipient: result.recipient,
  amountWei: result.amountWei,
  tokenSymbol: result.tokenSymbol,
  tokenDecimals: result.tokenDecimals,
  settlementContracts: result.settlementContracts,
  sessionId: result.sessionId
});

/**
 * Executes L2 -> L1 return initiation and L1 prove/finalize settlement actions.
 */
export function useL2ReturnExecution({
  amountInput,
  selectedAsset,
  walletAddress,
  sourceChain,
  l1FundingConfig,
  sourceL2BridgeAddress,
  settlementContracts,
  availableSourceBalance,
  ensureWalletOnChain,
  onClearErrors,
  onReturnError,
  onReturnSuccess
}: UseL2ReturnExecutionParams) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [results, setResults] = useState<ReturnResult[]>([]);

  const clearPhase = useCallback(() => {
    setPhase(null);
  }, []);

  const upsertResult = useCallback((sessionId: bigint, build: (existing?: ReturnResult) => ReturnResult) => {
    setResults((previous) => {
      const index = previous.findIndex((item) => item.sessionId === sessionId);

      if (index === -1) {
        return [build(undefined), ...previous].slice(0, MAX_RETURN_HISTORY);
      }

      const next = [...previous];
      next[index] = build(next[index]);
      return next;
    });
  }, []);

  const resultsBySessionId = useMemo(() => {
    const map = new Map<bigint, ReturnResult>();
    for (const result of results) {
      map.set(result.sessionId, result);
    }
    return map;
  }, [results]);

  const resolveReturnContext = useCallback(
    async (result: ReturnResult) => {
      if (!l1FundingConfig) {
        throw new Error('L1 funding is not configured for this environment.');
      }

      const l1PublicClient = composeConfig.getPublicClient(l1FundingConfig.chain.id);
      if (!l1PublicClient) {
        throw new Error(`L1 public client is not configured for chain ${l1FundingConfig.chain.id}.`);
      }

      const sourcePublicClient = composeConfig.getPublicClient(result.sourceChainId);
      if (!sourcePublicClient) {
        throw new Error(`Rollup public client is not configured for chain ${result.sourceChainId}.`);
      }

      const receipt = await sourcePublicClient.getTransactionReceipt({ hash: result.hash });
      const [withdrawal] = getWithdrawals(receipt);

      if (!withdrawal) {
        throw new Error(`No withdrawal log found in source transaction ${result.hash}.`);
      }

      return {
        l1PublicClient,
        sourcePublicClient,
        receipt,
        withdrawal
      };
    },
    [l1FundingConfig]
  );

  const deriveLifecycleStatus = useCallback(
    async (result: ReturnResult): Promise<WithdrawalLifecycleStatus | null> => {
      try {
        const { l1PublicClient, receipt, withdrawal } = await resolveReturnContext(result);
        const { status } = await getComposeWithdrawalStatus({
          l1PublicClient,
          portalAddress: result.settlementContracts.l1PortalAddress,
          disputeGameFactoryAddress: result.settlementContracts.l1DisputeGameFactoryAddress,
          sourceChainId: result.sourceChainId,
          withdrawal,
          withdrawalL2BlockNumber: receipt.blockNumber
        });

        return status;
      } catch {
        return null;
      }
    },
    [resolveReturnContext]
  );

  const syncLifecycleStatus = useCallback(
    async ({ sessionId, result, fallback }: { sessionId: bigint; result: ReturnResult; fallback: WithdrawalLifecycleStatus }) => {
      const derivedStatus = await deriveLifecycleStatus(result);
      upsertResult(sessionId, (existing) => {
        if (!existing) return result;
        return {
          ...existing,
          lifecycleStatus: derivedStatus ?? fallback
        };
      });
    },
    [deriveLifecycleStatus, upsertResult]
  );

  const executeReturn = useCallback(async () => {
    onClearErrors();

    if (!l1FundingConfig) {
      onReturnError('L2 -> L1 return flow is not configured for this environment.');
      return;
    }

    if (!walletAddress) {
      onReturnError('Connected wallet address is unavailable. Reconnect wallet and retry.');
      return;
    }

    if (!sourceL2BridgeAddress) {
      onReturnError('Could not resolve the L2 bridge contract for this rollup.');
      return;
    }

    if (!settlementContracts) {
      onReturnError('Could not resolve L1 settlement contracts for this rollup.');
      return;
    }

    if (!amountInput.trim()) {
      onReturnError(`Enter a ${selectedAsset.symbol} amount.`);
      return;
    }

    const amountWei = parsePositiveAssetAmountInput({
      amountInput,
      tokenKind: selectedAsset.kind,
      tokenDecimals: selectedAsset.decimals
    });

    if (amountWei === undefined) {
      onReturnError(`Invalid ${selectedAsset.symbol} amount.`);
      return;
    }

    if (availableSourceBalance !== undefined && amountWei > availableSourceBalance) {
      onReturnError(`Amount exceeds available ${selectedAsset.symbol} balance on the selected rollup.`);
      return;
    }

    const sessionId = BigInt(Date.now());
    const sourceChainLabel = formatChainLabel(sourceChain.name, sourceChain.id);
    const destinationChainLabel = formatChainLabel(l1FundingConfig.chain.name, l1FundingConfig.chain.id);

    let submittedHash: `0x${string}` | null = null;
    let explorerUrl = '';

    const buildResultContext = (): ReturnResultContext => ({
      hash: submittedHash!,
      explorerUrl,
      sourceChainLabel,
      destinationChainLabel,
      sourceChainId: sourceChain.id,
      destinationChainId: l1FundingConfig.chain.id,
      recipient: walletAddress,
      amountWei,
      tokenSymbol: selectedAsset.symbol,
      tokenDecimals: selectedAsset.decimals,
      settlementContracts,
      sessionId
    });

    const resolveResultContext = (existing?: ReturnResult): ReturnResultContext => ({
      ...(existing ? returnResultToContext(existing) : {}),
      ...buildResultContext()
    });

    try {
      setIsSubmitting(true);
      setPhase(`Switching wallet to ${sourceChain.name}...`);

      const walletClient = (await ensureWalletOnChain(sourceChain.id)) as WalletClientLike;
      const activeChainId = await walletClient.getChainId();
      if (activeChainId !== sourceChain.id) {
        throw new Error(`Wallet chain mismatch after switch. Active: ${activeChainId}, expected: ${sourceChain.id}.`);
      }

      const sourcePublicClient = composeConfig.getPublicClient(sourceChain.id);
      if (!sourcePublicClient) {
        throw new Error(`Could not resolve source rollup public client for chain ${sourceChain.id}.`);
      }

      if (selectedAsset.kind === 'nativeEthViaWeth') {
        setPhase('Submitting rollup ETH withdrawal transaction...');
        submittedHash = await walletClient.writeContract({
          address: sourceL2BridgeAddress,
          abi: l2StandardBridgeAbi,
          functionName: 'bridgeETHTo',
          args: [walletAddress, l1FundingConfig.minGasLimit, '0x'],
          value: amountWei
        });
      } else {
        setPhase(`Checking ${selectedAsset.symbol} allowance...`);
        const allowance = await sourcePublicClient.readContract({
          address: selectedAsset.l2TokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [walletAddress, sourceL2BridgeAddress]
        });

        if (allowance < amountWei) {
          setPhase(`Approving ${selectedAsset.symbol} for withdrawal bridge...`);
          const approvalHash = await walletClient.writeContract({
            address: selectedAsset.l2TokenAddress,
            abi: erc20Abi,
            functionName: 'approve',
            args: [sourceL2BridgeAddress, amountWei]
          });

          await sourcePublicClient.waitForTransactionReceipt({ hash: approvalHash });
        }

        setPhase(`Submitting rollup ${selectedAsset.symbol} withdrawal transaction...`);
        submittedHash = await walletClient.writeContract({
          address: sourceL2BridgeAddress,
          abi: l2StandardBridgeAbi,
          functionName: 'bridgeERC20To',
          args: [
            selectedAsset.l2TokenAddress,
            selectedAsset.l1TokenAddress,
            walletAddress,
            amountWei,
            l1FundingConfig.minGasLimit,
            '0x'
          ]
        });
      }

      const explorerBaseUrl = sourceChain.blockExplorers?.default?.url;
      explorerUrl = explorerBaseUrl ? new URL(`tx/${submittedHash}`, explorerBaseUrl).toString() : '';

      upsertResult(sessionId, () =>
        buildReturnResult({
          context: resolveResultContext(),
          status: 'pending',
          lifecycleStatus: 'waiting-to-prove'
        })
      );

      setPhase('Waiting for rollup confirmation...');
      const receipt = await sourcePublicClient.waitForTransactionReceipt({ hash: submittedHash });
      const status = receipt.status === 'success' ? 'success' : 'failed';

      upsertResult(sessionId, (existing) =>
        buildReturnResult({
          context: resolveResultContext(existing),
          status,
          lifecycleStatus: existing?.lifecycleStatus ?? 'waiting-to-prove'
        })
      );

      if (status === 'failed') {
        onReturnError('Rollup withdrawal transaction reverted. Please retry.');
        return;
      }

      onReturnSuccess();
    } catch (executionError) {
      const rawMessage = executionError instanceof Error ? executionError.message : 'Unknown L2 return error.';
      const normalizedMessage = normalizeExecutionErrorMessage(rawMessage);

      if (submittedHash) {
        upsertResult(sessionId, (existing) =>
          buildReturnResult({
            context: resolveResultContext(existing),
            status: 'failed',
            lifecycleStatus: existing?.lifecycleStatus ?? 'waiting-to-prove'
          })
        );
      }

      onReturnError(normalizedMessage);
      console.error('L2 -> L1 return flow failed', executionError);
    } finally {
      setPhase(null);
      setIsSubmitting(false);
    }
  }, [
    amountInput,
    availableSourceBalance,
    ensureWalletOnChain,
    l1FundingConfig,
    onClearErrors,
    onReturnError,
    onReturnSuccess,
    selectedAsset,
    settlementContracts,
    sourceChain,
    sourceL2BridgeAddress,
    upsertResult,
    walletAddress
  ]);

  const proveReturn = useCallback(
    async (sessionId: bigint) => {
      onClearErrors();

      const result = resultsBySessionId.get(sessionId);
      if (!result) {
        onReturnError('Could not locate return transaction in history.');
        return false;
      }

      if (!l1FundingConfig) {
        onReturnError('L1 funding is not configured for this environment.');
        return false;
      }

      if (result.status !== 'success') {
        onReturnError('Cannot prove a return transaction that has not succeeded on the rollup.');
        return false;
      }

      try {
        upsertResult(sessionId, (existing) => {
          if (!existing) return result;
          return { ...existing, lifecycleStatus: 'proving' };
        });

        const { l1PublicClient, sourcePublicClient, receipt, withdrawal } = await resolveReturnContext(result);

        const lifecycle = await getComposeWithdrawalStatus({
          l1PublicClient,
          portalAddress: result.settlementContracts.l1PortalAddress,
          disputeGameFactoryAddress: result.settlementContracts.l1DisputeGameFactoryAddress,
          sourceChainId: result.sourceChainId,
          withdrawal,
          withdrawalL2BlockNumber: receipt.blockNumber
        });

        if (lifecycle.status !== 'ready-to-prove') {
          upsertResult(sessionId, (existing) => {
            if (!existing) return result;
            return {
              ...existing,
              lifecycleStatus:
                lifecycle.status === 'waiting-to-finalize' ||
                lifecycle.status === 'ready-to-finalize' ||
                lifecycle.status === 'finalized'
                  ? lifecycle.status
                  : 'waiting-to-prove'
            };
          });
          onReturnError(`Withdrawal is currently ${lifecycle.status}. Wait until it is ready to prove.`);
          return false;
        }

        setPhase(`Switching wallet to ${l1FundingConfig.chain.name}...`);
        const walletClient = (await ensureWalletOnChain(l1FundingConfig.chain.id)) as WalletClientLike;
        const activeChainId = await walletClient.getChainId();
        if (activeChainId !== l1FundingConfig.chain.id) {
          throw new Error(
            `Wallet chain mismatch after switch. Active: ${activeChainId}, expected: ${l1FundingConfig.chain.id}.`
          );
        }

        setPhase('Building prove transaction...');
        if (!lifecycle.game) {
          throw new Error('Could not resolve an eligible Compose dispute game for this withdrawal yet.');
        }

        const proveArgs = await buildComposeProveWithdrawalArgs({
          sourcePublicClient,
          l1PublicClient,
          portalAddress: result.settlementContracts.l1PortalAddress,
          disputeGameFactoryAddress: result.settlementContracts.l1DisputeGameFactoryAddress,
          sourceChainId: result.sourceChainId,
          game: lifecycle.game,
          withdrawal,
          withdrawalL2BlockNumber: receipt.blockNumber
        });

        setPhase('Submitting prove transaction on L1...');
        const proveTxHash = await walletClient.writeContract({
          address: result.settlementContracts.l1PortalAddress,
          abi: composePortalSuperRootProveAbi,
          functionName: 'proveWithdrawalTransaction',
          args: [
            proveArgs.withdrawal,
            proveArgs.disputeGameProxy,
            proveArgs.outputRootIndex,
            proveArgs.superRootProof,
            proveArgs.outputRootProof,
            proveArgs.withdrawalProof
          ]
        });

        const l1ExplorerBase = l1FundingConfig.chain.blockExplorers?.default?.url;
        const proveTxExplorerUrl = l1ExplorerBase ? new URL(`tx/${proveTxHash}`, l1ExplorerBase).toString() : '';

        setPhase('Waiting for prove confirmation on L1...');
        const proveReceipt = await l1PublicClient.waitForTransactionReceipt({ hash: proveTxHash });

        if (proveReceipt.status !== 'success') {
          throw new Error('Prove transaction reverted on L1.');
        }

        upsertResult(sessionId, (existing) => {
          if (!existing) return result;
          return {
            ...existing,
            lifecycleStatus: 'waiting-to-finalize',
            proveTxHash,
            proveTxExplorerUrl
          };
        });

        return true;
      } catch (executionError) {
        const rawMessage = executionError instanceof Error ? executionError.message : 'Unknown prove error.';
        const normalizedMessage = normalizeExecutionErrorMessage(rawMessage);

        await syncLifecycleStatus({
          sessionId,
          result,
          fallback: 'waiting-to-prove'
        });

        onReturnError(normalizedMessage);
        console.error('Prove withdrawal failed', executionError);
        return false;
      } finally {
        setPhase(null);
      }
    },
    [
      ensureWalletOnChain,
      l1FundingConfig,
      onClearErrors,
      onReturnError,
      resolveReturnContext,
      resultsBySessionId,
      syncLifecycleStatus,
      upsertResult
    ]
  );

  const finalizeReturn = useCallback(
    async (sessionId: bigint) => {
      onClearErrors();

      const result = resultsBySessionId.get(sessionId);
      if (!result) {
        onReturnError('Could not locate return transaction in history.');
        return false;
      }

      if (!l1FundingConfig) {
        onReturnError('L1 funding is not configured for this environment.');
        return false;
      }

      if (result.status !== 'success') {
        onReturnError('Cannot finalize a return transaction that has not succeeded on the rollup.');
        return false;
      }

      try {
        upsertResult(sessionId, (existing) => {
          if (!existing) return result;
          return { ...existing, lifecycleStatus: 'finalizing' };
        });

        const { l1PublicClient, receipt, withdrawal } = await resolveReturnContext(result);
        const lifecycle = await getComposeWithdrawalStatus({
          l1PublicClient,
          portalAddress: result.settlementContracts.l1PortalAddress,
          disputeGameFactoryAddress: result.settlementContracts.l1DisputeGameFactoryAddress,
          sourceChainId: result.sourceChainId,
          withdrawal,
          withdrawalL2BlockNumber: receipt.blockNumber
        });

        if (lifecycle.status !== 'ready-to-finalize') {
          upsertResult(sessionId, (existing) => {
            if (!existing) return result;
            return {
              ...existing,
              lifecycleStatus:
                lifecycle.status === 'finalized'
                  ? 'finalized'
                  : lifecycle.status === 'ready-to-prove' || lifecycle.status === 'waiting-to-prove'
                    ? lifecycle.status
                    : 'waiting-to-finalize'
            };
          });
          onReturnError(`Withdrawal is currently ${lifecycle.status}. Wait until it is ready to finalize.`);
          return false;
        }

        setPhase(`Switching wallet to ${l1FundingConfig.chain.name}...`);
        const walletClient = (await ensureWalletOnChain(l1FundingConfig.chain.id)) as WalletClientLike;
        const activeChainId = await walletClient.getChainId();
        if (activeChainId !== l1FundingConfig.chain.id) {
          throw new Error(
            `Wallet chain mismatch after switch. Active: ${activeChainId}, expected: ${l1FundingConfig.chain.id}.`
          );
        }

        setPhase('Submitting finalize transaction on L1...');
        const proofSubmitter = lifecycle.proofSubmitter ?? result.recipient;
        const finalizeTxHash = await walletClient.writeContract({
          address: result.settlementContracts.l1PortalAddress,
          abi: composePortalFinalizeWithdrawalAbi,
          functionName: 'finalizeWithdrawalTransactionExternalProof',
          args: [withdrawal, proofSubmitter]
        });

        const l1ExplorerBase = l1FundingConfig.chain.blockExplorers?.default?.url;
        const finalizeTxExplorerUrl = l1ExplorerBase ? new URL(`tx/${finalizeTxHash}`, l1ExplorerBase).toString() : '';

        setPhase('Waiting for finalize confirmation on L1...');
        const finalizeReceipt = await l1PublicClient.waitForTransactionReceipt({ hash: finalizeTxHash });
        if (finalizeReceipt.status !== 'success') {
          throw new Error('Finalize transaction reverted on L1.');
        }

        upsertResult(sessionId, (existing) => {
          if (!existing) return result;
          return {
            ...existing,
            lifecycleStatus: 'finalized',
            finalizeTxHash,
            finalizeTxExplorerUrl
          };
        });

        onReturnSuccess();
        return true;
      } catch (executionError) {
        const rawMessage = executionError instanceof Error ? executionError.message : 'Unknown finalize error.';
        const normalizedMessage = normalizeExecutionErrorMessage(rawMessage);

        await syncLifecycleStatus({
          sessionId,
          result,
          fallback: 'waiting-to-finalize'
        });

        onReturnError(normalizedMessage);
        console.error('Finalize withdrawal failed', executionError);
        return false;
      } finally {
        setPhase(null);
      }
    },
    [
      ensureWalletOnChain,
      l1FundingConfig,
      onClearErrors,
      onReturnError,
      onReturnSuccess,
      resolveReturnContext,
      resultsBySessionId,
      syncLifecycleStatus,
      upsertResult
    ]
  );

  return {
    executeReturn,
    proveReturn,
    finalizeReturn,
    isSubmitting,
    phase,
    clearPhase,
    results,
    upsertResult
  };
}
