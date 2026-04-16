import { useCallback, useMemo, useState } from 'react';
import { parseEther, type Chain } from 'viem';
import {
  buildProveWithdrawal,
  finalizeWithdrawal,
  getWithdrawals,
  proveWithdrawal
} from 'viem/op-stack';
import { composeConfig, type L1FundingConfig } from '../composeConfig';
import { getComposeWithdrawalStatus } from '../lib/composeSettlement';
import { normalizeExecutionErrorMessage } from '../lib/errors';
import { formatChainLabel } from '../lib/format';
import { l2StandardBridgeAbi } from '../lib/l1Bridge';
import type { ReturnResult, ReturnSettlementContracts, WithdrawalLifecycleStatus } from '../types/funding';

// Handles rollup -> L1 withdrawal initiation and settlement lifecycle.
type WalletClientLike = {
  writeContract: (...args: unknown[]) => Promise<`0x${string}`>;
  getChainId: () => Promise<number>;
};

type UseL2ReturnExecutionParams = {
  amountInput: string;
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

/**
 * Executes L2 -> L1 native ETH return and L1 prove/finalize settlement actions.
 */
export function useL2ReturnExecution({
  amountInput,
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
      onReturnError('Enter an ETH amount.');
      return;
    }

    let amountWei: bigint;
    try {
      amountWei = parseEther(amountInput);
    } catch {
      onReturnError('Invalid ETH amount.');
      return;
    }

    if (amountWei <= 0n) {
      onReturnError('Amount must be greater than zero.');
      return;
    }

    if (availableSourceBalance !== undefined && amountWei > availableSourceBalance) {
      onReturnError('Amount exceeds available ETH balance on the selected rollup.');
      return;
    }

    const sessionId = BigInt(Date.now());
    const sourceChainLabel = formatChainLabel(sourceChain.name, sourceChain.id);
    const destinationChainLabel = formatChainLabel(l1FundingConfig.chain.name, l1FundingConfig.chain.id);

    let submittedHash: `0x${string}` | null = null;
    let explorerUrl = '';

    try {
      setIsSubmitting(true);
      setPhase(`Switching wallet to ${sourceChain.name}...`);

      const walletClient = (await ensureWalletOnChain(sourceChain.id)) as WalletClientLike;
      const activeChainId = await walletClient.getChainId();
      if (activeChainId !== sourceChain.id) {
        throw new Error(`Wallet chain mismatch after switch. Active: ${activeChainId}, expected: ${sourceChain.id}.`);
      }

      setPhase('Submitting rollup withdrawal transaction...');
      submittedHash = await walletClient.writeContract({
        address: sourceL2BridgeAddress,
        abi: l2StandardBridgeAbi,
        functionName: 'bridgeETHTo',
        args: [walletAddress, l1FundingConfig.minGasLimit, '0x'],
        value: amountWei
      });

      const explorerBaseUrl = sourceChain.blockExplorers?.default?.url;
      explorerUrl = explorerBaseUrl ? new URL(`tx/${submittedHash}`, explorerBaseUrl).toString() : '';

      upsertResult(sessionId, () => ({
        hash: submittedHash!,
        explorerUrl,
        sourceChainLabel,
        destinationChainLabel,
        sourceChainId: sourceChain.id,
        destinationChainId: l1FundingConfig.chain.id,
        recipient: walletAddress,
        amountWei,
        status: 'pending',
        lifecycleStatus: 'waiting-to-prove',
        settlementContracts,
        sessionId
      }));

      const sourcePublicClient = composeConfig.getPublicClient(sourceChain.id);
      if (!sourcePublicClient) {
        throw new Error(`Could not resolve source rollup public client for chain ${sourceChain.id}.`);
      }

      setPhase('Waiting for rollup confirmation...');
      const receipt = await sourcePublicClient.waitForTransactionReceipt({ hash: submittedHash });
      const status = receipt.status === 'success' ? 'success' : 'failed';

      upsertResult(sessionId, (existing) => ({
        ...(existing ?? {
          hash: submittedHash!,
          explorerUrl,
          sourceChainLabel,
          destinationChainLabel,
          sourceChainId: sourceChain.id,
          destinationChainId: l1FundingConfig.chain.id,
          recipient: walletAddress,
          amountWei,
          lifecycleStatus: 'waiting-to-prove',
          settlementContracts,
          sessionId
        }),
        status
      }));

      if (status === 'failed') {
        onReturnError('Rollup withdrawal transaction reverted. Please retry.');
        return;
      }

      onReturnSuccess();
    } catch (executionError) {
      const rawMessage = executionError instanceof Error ? executionError.message : 'Unknown L2 return error.';
      const normalizedMessage = normalizeExecutionErrorMessage(rawMessage);

      if (submittedHash) {
        upsertResult(sessionId, (existing) => ({
          ...(existing ?? {
            hash: submittedHash!,
            explorerUrl,
            sourceChainLabel,
            destinationChainLabel,
            sourceChainId: sourceChain.id,
            destinationChainId: l1FundingConfig.chain.id,
            recipient: walletAddress,
            amountWei,
            lifecycleStatus: 'waiting-to-prove',
            settlementContracts,
            sessionId
          }),
          status: 'failed'
        }));
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
        const proveGame = lifecycle.game;
        if (!proveGame) {
          throw new Error('Could not resolve an eligible Compose dispute game for this withdrawal yet.');
        }

        const proveArgs = await buildProveWithdrawal(sourcePublicClient, {
          game: proveGame,
          withdrawal
        });
        const proveArgsWithoutTargetChain = {
          l2OutputIndex: proveArgs.l2OutputIndex,
          outputRootProof: proveArgs.outputRootProof,
          withdrawalProof: proveArgs.withdrawalProof,
          withdrawal: proveArgs.withdrawal
        };

        setPhase('Submitting prove transaction on L1...');
        const proveTxHash = await proveWithdrawal(walletClient as never, {
          ...proveArgsWithoutTargetChain,
          chain: l1FundingConfig.chain,
          portalAddress: result.settlementContracts.l1PortalAddress,
          account: result.recipient
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
        const finalizeTxHash = await finalizeWithdrawal(walletClient as never, {
          withdrawal,
          chain: l1FundingConfig.chain,
          portalAddress: result.settlementContracts.l1PortalAddress,
          account: result.recipient
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
