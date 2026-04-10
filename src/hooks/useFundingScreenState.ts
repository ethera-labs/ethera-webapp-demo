import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { chainA, chainB, composeConfig, l1FundingConfig } from '../composeConfig';
import { formatChainLabel } from '../lib/format';
import { useL1FundingExecution } from './useL1FundingExecution';
import type { PickerOption } from '../components/Picker';

// Funding-mode state aggregator: destination selection, L1 balance, and submission state.
type UseFundingScreenStateParams = {
  walletAddress: `0x${string}` | undefined;
  isConnected: boolean;
  ensureWalletOnChain: (targetChainId: number) => Promise<unknown>;
  onClearErrors: () => void;
  onFundingError: (message: string) => void;
};

const AVAILABLE_CHAINS = [chainA, chainB] as const;

/**
 * Prepares all state needed by the L1 -> rollup funding UI.
 */
export function useFundingScreenState({
  walletAddress,
  isConnected,
  ensureWalletOnChain,
  onClearErrors,
  onFundingError
}: UseFundingScreenStateParams) {
  const [fundingDestinationChainId, setFundingDestinationChainId] = useState<number>(chainA.id);
  const [fundingAmountInput, setFundingAmountInput] = useState('');

  const fundingDestinationChain = fundingDestinationChainId === chainA.id ? chainA : chainB;
  const selectedFundingSourceChainLabel = l1FundingConfig
    ? formatChainLabel(l1FundingConfig.chain.name, l1FundingConfig.chain.id)
    : 'L1';
  const selectedFundingDestinationChainLabel = formatChainLabel(
    fundingDestinationChain.name,
    fundingDestinationChain.id
  );
  const selectedFundingSourceChainName = l1FundingConfig?.chain.name ?? 'L1';
  const selectedFundingDestinationChainName = fundingDestinationChain.name;

  const l1NativeBalanceQuery = useQuery({
    queryKey: ['l1-native-balance', l1FundingConfig?.chain.id, walletAddress],
    enabled: Boolean(l1FundingConfig?.chain && walletAddress),
    queryFn: async () => {
      const l1Chain = l1FundingConfig?.chain;
      const eoaAddress = walletAddress;

      if (!l1Chain || !eoaAddress) {
        throw new Error('L1 funding context is not ready yet.');
      }

      const publicClient = composeConfig.getPublicClient(l1Chain.id);
      if (!publicClient) {
        throw new Error(`L1 public client is not configured for chain ${l1Chain.id}.`);
      }

      return publicClient.getBalance({ address: eoaAddress });
    }
  });

  const l1NativeBalance = l1NativeBalanceQuery.data;

  const {
    executeFunding,
    isSubmitting: isFundingSubmitting,
    phase: fundingPhase,
    clearPhase: clearFundingPhase,
    results: fundingResults
  } = useL1FundingExecution({
    amountInput: fundingAmountInput,
    walletAddress,
    destinationChain: fundingDestinationChain,
    l1FundingConfig,
    availableL1Balance: l1NativeBalance,
    ensureWalletOnChain,
    onClearErrors,
    onFundingError,
    onFundingSuccess: () => {
      void l1NativeBalanceQuery.refetch();
    }
  });

  const hasFundingAmountInput = fundingAmountInput.trim().length > 0;
  const canSubmitFunding = isConnected && Boolean(l1FundingConfig) && hasFundingAmountInput && !isFundingSubmitting;

  const fundingDestinationOptions: PickerOption<number>[] = useMemo(
    () =>
      AVAILABLE_CHAINS.map((chain) => ({
        key: `fund-destination-${chain.id}`,
        value: chain.id,
        left: formatChainLabel(chain.name, chain.id)
      })),
    []
  );

  const resetFundingForm = useCallback(() => {
    setFundingAmountInput('');
  }, []);

  return {
    fundingDestinationChainId,
    fundingAmountInput,
    fundingDestinationChain,
    selectedFundingSourceChainLabel,
    selectedFundingDestinationChainLabel,
    selectedFundingSourceChainName,
    selectedFundingDestinationChainName,
    fundingDestinationOptions,
    l1NativeBalance,
    l1NativeBalanceQuery,
    executeFunding,
    isFundingSubmitting,
    fundingPhase,
    clearFundingPhase,
    fundingResults,
    canSubmitFunding,
    setFundingDestinationChainId,
    setFundingAmountInput,
    resetFundingForm
  };
}
