import type { useSmartAccount } from '@ssv-labs/ethera-sdk/react';
import { useCallback, useState } from 'react';
import { parseEther } from 'viem';
import { normalizeExecutionErrorMessage } from '../lib/errors';
import { formatUnitsFixedFraction } from '../lib/format';
import { entryPointAbi } from '../lib/entryPoint';
import type { DepositModalState } from '../types/deposit';

// Orchestrates EntryPoint deposit top-up steps used when paymaster is disabled.
type SmartAccountData = NonNullable<ReturnType<typeof useSmartAccount>['data']>;

type WalletClientLike = {
  writeContract: (...args: unknown[]) => Promise<`0x${string}`>;
  getChainId: () => Promise<number>;
};

type HandleDepositTopUpConfirmParams = {
  smartByChainId: Record<number, SmartAccountData | undefined>;
  entryPointAddress: `0x${string}`;
  ensureWalletOnChain: (targetChainId: number) => Promise<unknown>;
  clearBridgePhase: () => void;
};

type UseDepositTopUpOrchestrationParams = {
  onClearErrors: () => void;
  onTopUpCompleted?: () => void;
};

/**
 * Handles modal state and per-chain top-up execution for EntryPoint deposits.
 */
export function useDepositTopUpOrchestration({
  onClearErrors,
  onTopUpCompleted
}: UseDepositTopUpOrchestrationParams) {
  const [topUpError, setTopUpError] = useState<string | null>(null);
  const [depositModal, setDepositModal] = useState<DepositModalState | null>(null);
  const [isToppingUpDeposit, setIsToppingUpDeposit] = useState(false);

  const handleDepositRequired = useCallback((requirements: DepositModalState['requirements'], suggestedTopUpInput: string) => {
    setTopUpError(null);
    setDepositModal({
      requirements,
      currentIndex: 0,
      completedChainIds: [],
      topUpAmountInput: suggestedTopUpInput
    });
  }, []);

  const closeDepositModal = useCallback((clearBridgePhase?: () => void) => {
    setDepositModal(null);
    setTopUpError(null);
    clearBridgePhase?.();
  }, []);

  const setTopUpAmountInput = useCallback((nextValue: string) => {
    setDepositModal((previous) =>
      previous
        ? {
            ...previous,
            topUpAmountInput: nextValue
          }
        : previous
    );
  }, []);

  const handleDepositTopUpConfirm = useCallback(async ({
    smartByChainId,
    entryPointAddress,
    ensureWalletOnChain,
    clearBridgePhase
  }: HandleDepositTopUpConfirmParams) => {
    if (!depositModal) return;
    const requirement = depositModal.requirements[depositModal.currentIndex];
    if (!requirement) return;

    let topUpAmount: bigint;
    try {
      topUpAmount = parseEther(depositModal.topUpAmountInput || '0');
    } catch {
      setTopUpError('Invalid top-up amount. Enter a valid decimal value.');
      return;
    }

    if (topUpAmount <= 0n) {
      setTopUpError('Top-up amount must be greater than zero.');
      return;
    }

    try {
      setIsToppingUpDeposit(true);
      onClearErrors();
      setTopUpError(null);

      const chainSmart = smartByChainId[requirement.chainId];
      if (!chainSmart?.publicClient) {
        throw new Error(`Smart account client unavailable for chain ${requirement.chainId}.`);
      }

      const latestDeposit = await chainSmart.publicClient.readContract({
        address: entryPointAddress,
        abi: entryPointAbi,
        functionName: 'balanceOf',
        args: [requirement.smartAccount]
      });

      setDepositModal((previous) => {
        if (!previous) return previous;
        const nextRequirements = [...previous.requirements];
        nextRequirements[previous.currentIndex] = {
          ...nextRequirements[previous.currentIndex],
          currentDeposit: latestDeposit
        };
        return {
          ...previous,
          requirements: nextRequirements
        };
      });

      const completeCurrentStep = () => {
        const isLastStep = depositModal.currentIndex >= depositModal.requirements.length - 1;
        const completedChainIds = depositModal.completedChainIds.includes(requirement.chainId)
          ? depositModal.completedChainIds
          : [...depositModal.completedChainIds, requirement.chainId];

        if (isLastStep) {
          setDepositModal(null);
          clearBridgePhase();
          setTopUpError(null);
          onTopUpCompleted?.();
          return;
        }

        setDepositModal((previous) => {
          if (!previous) return previous;
          return {
            ...previous,
            currentIndex: previous.currentIndex + 1,
            completedChainIds
          };
        });
      };

      if (latestDeposit >= requirement.estimatedRequired) {
        completeCurrentStep();
        return;
      }

      const walletClient = (await ensureWalletOnChain(requirement.chainId)) as WalletClientLike;
      const activeChainId = await walletClient.getChainId();
      if (activeChainId !== requirement.chainId) {
        throw new Error(`Wallet chain mismatch after switch. Active: ${activeChainId}, expected: ${requirement.chainId}.`);
      }

      const hash = await walletClient.writeContract({
        address: entryPointAddress,
        abi: entryPointAbi,
        functionName: 'depositTo',
        args: [requirement.smartAccount],
        value: topUpAmount
      });
      await chainSmart.publicClient.waitForTransactionReceipt({ hash });
      const confirmedDeposit = await chainSmart.publicClient.readContract({
        address: entryPointAddress,
        abi: entryPointAbi,
        functionName: 'balanceOf',
        args: [requirement.smartAccount]
      });
      setDepositModal((previous) => {
        if (!previous) return previous;
        const nextRequirements = [...previous.requirements];
        nextRequirements[previous.currentIndex] = {
          ...nextRequirements[previous.currentIndex],
          currentDeposit: confirmedDeposit
        };
        return {
          ...previous,
          requirements: nextRequirements
        };
      });

      if (confirmedDeposit < requirement.estimatedRequired) {
        setTopUpError(
          `Deposit on ${requirement.chainLabel} is still below estimated requirement. Increase top-up amount and retry this step.`
        );
        return;
      }

      completeCurrentStep();
    } catch (topUpExecutionError) {
      const message =
        topUpExecutionError instanceof Error ? normalizeExecutionErrorMessage(topUpExecutionError.message) : 'Top-up failed.';
      setTopUpError(message);
      console.error('EntryPoint top-up failed', topUpExecutionError);
    } finally {
      setIsToppingUpDeposit(false);
    }
  }, [depositModal, onClearErrors, onTopUpCompleted]);

  const formatNativeAmount = useCallback((value: bigint) => {
    return formatUnitsFixedFraction(value, 18, 6);
  }, []);

  return {
    depositModal,
    isToppingUpDeposit,
    topUpError,
    formatNativeAmount,
    handleDepositRequired,
    closeDepositModal,
    handleDepositTopUpConfirm,
    setTopUpAmountInput
  };
}
