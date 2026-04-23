import { useCallback, useState } from 'react';
import { formatEther, type Chain } from 'viem';
import type { DemoToken } from '../composeConfig';
import { formatChainLabel } from '../lib/format';
import type { BridgeResult } from '../types/bridge';
import type { DepositRequirement } from '../types/deposit';
import {
  MAX_TRANSACTION_HISTORY,
  MIN_RECOMMENDED_TOP_UP,
  buildBridgeCalls,
  executeComposedBridgeFlow,
  loadSourceFundingContext,
  markNonSuccessfulStatusesFailed,
  resolveDestinationPayoutTokenAddress,
  resolveSourceTokenBridgeMode,
  resolveBridgeExecutionError,
  resolveEntryPointDepositRequirements,
  type BridgeCall,
  type SmartAccountData,
  validateBridgeExecutionInput
} from './bridgeExecution';

// Bridge execution orchestrator: validates inputs, coordinates compose/send, and tracks result lifecycle.
type UseBridgeExecutionParams = {
  amountInput: string;
  selectedToken: DemoToken | undefined;
  sourceBalance: bigint | undefined;
  walletAddress: `0x${string}` | undefined;
  sourceChain: Chain;
  destinationChain: Chain;
  sourceSmart: SmartAccountData | undefined;
  destinationSmart: SmartAccountData | undefined;
  universalBridgeAddress: `0x${string}` | undefined;
  entryPointAddress: `0x${string}`;
  hasPaymaster: boolean;
  ensureWalletOnChain: (targetChainId: number) => Promise<unknown>;
  onClearErrors: () => void;
  onBridgeError: (message: string) => void;
  onDepositRequired: (requirements: DepositRequirement[], suggestedTopUpInput: string) => void;
  onRefreshBalances: () => void;
};

/**
 * Executes the cross-rollup bridge flow and exposes UI-friendly submission state.
 */
export function useBridgeExecution({
  amountInput,
  selectedToken,
  sourceBalance,
  walletAddress,
  sourceChain,
  destinationChain,
  sourceSmart,
  destinationSmart,
  universalBridgeAddress,
  entryPointAddress,
  hasPaymaster,
  ensureWalletOnChain,
  onClearErrors,
  onBridgeError,
  onDepositRequired,
  onRefreshBalances
}: UseBridgeExecutionParams) {
  const [results, setResults] = useState<BridgeResult[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bridgePhase, setBridgePhase] = useState<string | null>(null);

  const clearBridgePhase = useCallback(() => {
    setBridgePhase(null);
  }, []);

  const upsertBridgeResult = useCallback((sessionId: bigint, build: (existing?: BridgeResult) => BridgeResult) => {
    setResults((previous) => {
      const existingIndex = previous.findIndex((item) => item.sessionId === sessionId);

      if (existingIndex === -1) {
        return [build(undefined), ...previous].slice(0, MAX_TRANSACTION_HISTORY);
      }

      const next = [...previous];
      next[existingIndex] = build(next[existingIndex]);
      return next;
    });
  }, []);

  const appendBridgeStage = useCallback(
    ({
      sessionId,
      hash,
      explorerUrl,
      chainLabel,
      stepLabel
    }: {
      sessionId: bigint;
      hash: `0x${string}`;
      explorerUrl: string;
      chainLabel: string;
      stepLabel: string;
    }) => {
      upsertBridgeResult(sessionId, (existing) => ({
        hashes: [...(existing?.hashes ?? []), hash],
        explorerUrls: [...(existing?.explorerUrls ?? []), explorerUrl],
        chainLabels: [...(existing?.chainLabels ?? []), chainLabel],
        stepLabels: [...(existing?.stepLabels ?? []), stepLabel],
        sessionId,
        receiptStatuses: [...(existing?.receiptStatuses ?? []), 'pending']
      }));
    },
    [upsertBridgeResult]
  );

  const setBridgeStageStatus = useCallback(
    ({ hash, status }: { hash: `0x${string}`; status: BridgeResult['receiptStatuses'][number] }) => {
      setResults((previous) =>
        previous.map((item) => {
          const stageIndex = item.hashes.findIndex((itemHash) => itemHash === hash);
          if (stageIndex === -1) return item;

          const nextStatuses = [...item.receiptStatuses];
          nextStatuses[stageIndex] = status;
          return {
            ...item,
            receiptStatuses: nextStatuses
          };
        })
      );
    },
    []
  );

  const checkEntryPointDepositRequirements = useCallback(
    async ({
      sourceSmartAccount,
      destinationSmartAccount,
      sourceCalls,
      destinationCalls
    }: {
      sourceSmartAccount: SmartAccountData;
      destinationSmartAccount: SmartAccountData;
      sourceCalls: BridgeCall[];
      destinationCalls: BridgeCall[];
    }) => {
      return resolveEntryPointDepositRequirements({
        sourceSmartAccount,
        destinationSmartAccount,
        sourceCalls,
        destinationCalls,
        sourceChainLabel: formatChainLabel(sourceChain.name, sourceChain.id),
        destinationChainLabel: formatChainLabel(destinationChain.name, destinationChain.id),
        entryPointAddress
      });
    },
    [destinationChain.id, destinationChain.name, entryPointAddress, sourceChain.id, sourceChain.name]
  );

  const executeBridge = useCallback(
    async (options?: { skipDepositCheck?: boolean }) => {
      onClearErrors();

      if (!universalBridgeAddress) {
        onBridgeError('Universal L2->L2 bridge is not configured. Set VITE_TESTNET_UNIVERSAL_L2_TO_L2_BRIDGE and reload.');
        return;
      }

      const validation = validateBridgeExecutionInput({
        amountInput,
        selectedToken,
        sourceBalance,
        walletAddress,
        sourceChain,
        destinationChain,
        sourceSmart,
        destinationSmart
      });

      if (!validation.ok) {
        onBridgeError(validation.error);
        return;
      }

      const {
        amount,
        selectedToken: validatedToken,
        walletAddress: validatedWalletAddress,
        sourceSmart: sourceSmartAccount,
        destinationSmart: destinationSmartAccount
      } = validation.value;

      const sender = sourceSmartAccount.account.address;
      const receiver = destinationSmartAccount.account.address;
      const destinationEoaReceiver = validatedWalletAddress;

      const fundingContext = await loadSourceFundingContext({
        sourceSmart: sourceSmartAccount,
        selectedToken: validatedToken,
        sender,
        walletAddress: validatedWalletAddress,
        amount
      });

      if (amount > fundingContext.sourceTotalBalanceOnChain) {
        onBridgeError(`Amount exceeds total available ${validatedToken.symbol} on source chain (EOA + smart account).`);
        return;
      }

      const sessionId = BigInt(Date.now());
      // Only ERC20 mode needs transferFrom pull from EOA; ETH mode pre-funds native in execution step.
      const amountToPullFromEoa = fundingContext.kind === 'erc20' ? fundingContext.amountToPullFromEoa : 0n;
      const sourceTokenBridgeMode = await resolveSourceTokenBridgeMode({
        sourceSmart: sourceSmartAccount,
        selectedToken: validatedToken
      });
      const destinationPayoutTokenAddress = await resolveDestinationPayoutTokenAddress({
        sourceSmart: sourceSmartAccount,
        destinationSmart: destinationSmartAccount,
        selectedToken: validatedToken,
        sourceTokenBridgeMode,
        sourceChainId: sourceChain.id,
        destinationChainId: destinationChain.id,
        universalBridgeAddress
      });

      const { sourceCalls, destinationCalls } = buildBridgeCalls({
        selectedToken: validatedToken,
        walletAddress: validatedWalletAddress,
        sender,
        receiver,
        destinationEoaReceiver,
        destinationPayoutTokenAddress,
        universalBridgeAddress,
        sourceChainId: sourceChain.id,
        destinationChainId: destinationChain.id,
        amount,
        sessionId,
        amountToPullFromEoa,
        sourceTokenBridgeMode
      });

      const shouldCheckEntryPointDeposit = !options?.skipDepositCheck && !hasPaymaster;
      if (shouldCheckEntryPointDeposit) {
        const depositRequirements = await checkEntryPointDepositRequirements({
          sourceSmartAccount,
          destinationSmartAccount,
          sourceCalls,
          destinationCalls
        });

        if (depositRequirements.length > 0) {
          const suggestedTopUp = depositRequirements.reduce(
            (max, requirement) => (requirement.recommendedTopUp > max ? requirement.recommendedTopUp : max),
            MIN_RECOMMENDED_TOP_UP
          );
          onDepositRequired(depositRequirements, formatEther(suggestedTopUp));
          return;
        }
      }

      try {
        setIsSubmitting(true);

        const execution = await executeComposedBridgeFlow({
          sourceSmartAccount,
          destinationSmartAccount,
          sourceChain,
          destinationChain,
          sourceCalls,
          destinationCalls,
          selectedToken: validatedToken,
          walletAddress: validatedWalletAddress,
          sender,
          receiver,
          // Funding context carries mode-specific precompose requirements (native prefund vs ERC20 approval).
          fundingContext,
          ensureWalletOnChain,
          setBridgePhase,
          onStageSubmitted: ({ hash, explorerUrl, chainLabel, stepLabel }) => {
            appendBridgeStage({
              sessionId,
              hash,
              explorerUrl,
              chainLabel,
              stepLabel
            });
          },
          onStageStatusUpdated: ({ hash, status }) => {
            setBridgeStageStatus({ hash, status });
          }
        });

        upsertBridgeResult(sessionId, (existing) => ({
          hashes: existing?.hashes ?? execution.hashesToTrack,
          explorerUrls: existing?.explorerUrls ?? execution.explorerUrls,
          chainLabels: existing?.chainLabels ?? execution.chainLabels,
          stepLabels: existing?.stepLabels ?? execution.stepLabels,
          sessionId,
          receiptStatuses: execution.receiptStatuses
        }));

        onRefreshBalances();
      } catch (executionError) {
        const { normalizedMessage } = resolveBridgeExecutionError(executionError);

        setResults((previous) =>
          previous.map((item) =>
            item.sessionId === sessionId
              ? {
                  ...item,
                  receiptStatuses: markNonSuccessfulStatusesFailed(item.receiptStatuses)
                }
              : item
          )
        );

        onBridgeError(normalizedMessage);
        console.error('Bridge execution failed', normalizedMessage, executionError);
      } finally {
        setBridgePhase(null);
        setIsSubmitting(false);
      }
    },
    [
      amountInput,
      checkEntryPointDepositRequirements,
      destinationChain,
      destinationSmart,
      ensureWalletOnChain,
      appendBridgeStage,
      setBridgeStageStatus,
      hasPaymaster,
      onBridgeError,
      onClearErrors,
      onDepositRequired,
      onRefreshBalances,
      selectedToken,
      sourceBalance,
      sourceChain,
      sourceSmart,
      universalBridgeAddress,
      upsertBridgeResult,
      walletAddress
    ]
  );

  return {
    executeBridge,
    isSubmitting,
    bridgePhase,
    clearBridgePhase,
    results
  };
}
