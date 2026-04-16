import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { chainA, chainB, composeConfig, l1FundingConfig } from '../composeConfig';
import type { PickerOption } from '../components/Picker';
import { formatChainLabel } from '../lib/format';
import {
  resolveDisputeGameFactoryAddressFromPortal,
  resolveL1MessengerAddressFromL1Bridge,
  resolveL1PortalAddressFromMessenger,
  resolveL2BridgeAddressFromL1Bridge
} from '../lib/l1Bridge';
import { useL2ReturnExecution } from './useL2ReturnExecution';

// Return-mode state aggregator: source rollup selection, bridge resolution, and settlement controls.
type UseReturnScreenStateParams = {
  walletAddress: `0x${string}` | undefined;
  isConnected: boolean;
  ensureWalletOnChain: (targetChainId: number) => Promise<unknown>;
  onClearErrors: () => void;
  onReturnError: (message: string) => void;
};

const AVAILABLE_CHAINS = [chainA, chainB] as const;

/**
 * Prepares all state needed by the rollup -> L1 ETH return UI.
 */
export function useReturnScreenState({
  walletAddress,
  isConnected,
  ensureWalletOnChain,
  onClearErrors,
  onReturnError
}: UseReturnScreenStateParams) {
  const [returnSourceChainId, setReturnSourceChainId] = useState<number>(chainA.id);
  const [returnAmountInput, setReturnAmountInput] = useState('');

  const returnSourceChain = returnSourceChainId === chainA.id ? chainA : chainB;
  const selectedReturnSourceChainLabel = formatChainLabel(returnSourceChain.name, returnSourceChain.id);
  const selectedReturnDestinationChainLabel = l1FundingConfig
    ? formatChainLabel(l1FundingConfig.chain.name, l1FundingConfig.chain.id)
    : 'L1';
  const selectedReturnSourceChainName = returnSourceChain.name;
  const selectedReturnDestinationChainName = l1FundingConfig?.chain.name ?? 'L1';

  const configuredL1BridgeAddress = l1FundingConfig?.bridgeByDestinationChainId[returnSourceChain.id];

  const returnNativeBalanceQuery = useQuery({
    queryKey: ['l2-return-native-balance', returnSourceChain.id, walletAddress],
    enabled: Boolean(walletAddress),
    queryFn: async () => {
      const eoaAddress = walletAddress;
      if (!eoaAddress) {
        throw new Error('Wallet address is not available.');
      }

      const sourcePublicClient = composeConfig.getPublicClient(returnSourceChain.id);
      if (!sourcePublicClient) {
        throw new Error(`Source rollup public client is not configured for chain ${returnSourceChain.id}.`);
      }

      return sourcePublicClient.getBalance({ address: eoaAddress });
    }
  });

  const l1NativeBalanceQuery = useQuery({
    queryKey: ['l1-native-balance', l1FundingConfig?.chain.id, walletAddress],
    enabled: Boolean(l1FundingConfig?.chain && walletAddress),
    queryFn: async () => {
      const l1Chain = l1FundingConfig?.chain;
      const eoaAddress = walletAddress;

      if (!l1Chain || !eoaAddress) {
        throw new Error('L1 balance context is not ready yet.');
      }

      const l1PublicClient = composeConfig.getPublicClient(l1Chain.id);
      if (!l1PublicClient) {
        throw new Error(`L1 public client is not configured for chain ${l1Chain.id}.`);
      }

      return l1PublicClient.getBalance({ address: eoaAddress });
    }
  });

  const resolvedL2BridgeAddressQuery = useQuery({
    queryKey: ['l2-return-bridge-address', l1FundingConfig?.chain.id, returnSourceChain.id, configuredL1BridgeAddress],
    enabled: Boolean(l1FundingConfig && configuredL1BridgeAddress),
    queryFn: async () => {
      if (!l1FundingConfig || !configuredL1BridgeAddress) {
        throw new Error('L1 funding bridge configuration is not ready.');
      }

      const l1PublicClient = composeConfig.getPublicClient(l1FundingConfig.chain.id);
      if (!l1PublicClient) {
        throw new Error(`L1 public client is not configured for chain ${l1FundingConfig.chain.id}.`);
      }

      return resolveL2BridgeAddressFromL1Bridge({
        l1PublicClient,
        l1BridgeAddress: configuredL1BridgeAddress
      });
    }
  });

  const settlementContractsQuery = useQuery({
    queryKey: ['l2-return-settlement-contracts', l1FundingConfig?.chain.id, returnSourceChain.id, configuredL1BridgeAddress],
    enabled: Boolean(l1FundingConfig && configuredL1BridgeAddress),
    queryFn: async () => {
      if (!l1FundingConfig || !configuredL1BridgeAddress) {
        throw new Error('L1 funding bridge configuration is not ready.');
      }

      const l1PublicClient = composeConfig.getPublicClient(l1FundingConfig.chain.id);
      if (!l1PublicClient) {
        throw new Error(`L1 public client is not configured for chain ${l1FundingConfig.chain.id}.`);
      }

      const l1MessengerAddress = await resolveL1MessengerAddressFromL1Bridge({
        l1PublicClient,
        l1BridgeAddress: configuredL1BridgeAddress
      });
      const l1PortalAddress = await resolveL1PortalAddressFromMessenger({
        l1PublicClient,
        l1MessengerAddress
      });
      const l1DisputeGameFactoryAddress = await resolveDisputeGameFactoryAddressFromPortal({
        l1PublicClient,
        l1PortalAddress
      });

      return {
        l1MessengerAddress,
        l1PortalAddress,
        l1DisputeGameFactoryAddress
      };
    }
  });

  const returnNativeBalance = returnNativeBalanceQuery.data;
  const l1NativeBalance = l1NativeBalanceQuery.data;
  const resolvedL2BridgeAddress = resolvedL2BridgeAddressQuery.data;
  const settlementContracts = settlementContractsQuery.data;

  const {
    executeReturn,
    proveReturn,
    finalizeReturn,
    isSubmitting: isReturnSubmitting,
    phase: returnPhase,
    clearPhase: clearReturnPhase,
    results: returnResults
  } = useL2ReturnExecution({
    amountInput: returnAmountInput,
    walletAddress,
    sourceChain: returnSourceChain,
    l1FundingConfig,
    sourceL2BridgeAddress: resolvedL2BridgeAddress,
    settlementContracts,
    availableSourceBalance: returnNativeBalance,
    ensureWalletOnChain,
    onClearErrors,
    onReturnError,
    onReturnSuccess: () => {
      void returnNativeBalanceQuery.refetch();
      void l1NativeBalanceQuery.refetch();
    }
  });

  const hasReturnAmountInput = returnAmountInput.trim().length > 0;
  const canSubmitReturn =
    isConnected &&
    Boolean(l1FundingConfig) &&
    hasReturnAmountInput &&
    !isReturnSubmitting &&
    Boolean(resolvedL2BridgeAddress) &&
    Boolean(settlementContracts);

  const returnSourceOptions: PickerOption<number>[] = useMemo(
    () =>
      AVAILABLE_CHAINS.map((chain) => ({
        key: `return-source-${chain.id}`,
        value: chain.id,
        left: formatChainLabel(chain.name, chain.id)
      })),
    []
  );

  const handleProve = useCallback(
    async (sessionId: bigint) => {
      return proveReturn(sessionId);
    },
    [proveReturn]
  );

  const handleFinalize = useCallback(
    async (sessionId: bigint) => {
      const didFinalize = await finalizeReturn(sessionId);
      if (didFinalize) {
        void l1NativeBalanceQuery.refetch();
      }

      return didFinalize;
    },
    [finalizeReturn, l1NativeBalanceQuery]
  );

  const resetReturnForm = useCallback(() => {
    setReturnAmountInput('');
  }, []);

  return {
    returnSourceChainId,
    returnAmountInput,
    returnSourceChain,
    selectedReturnSourceChainLabel,
    selectedReturnDestinationChainLabel,
    selectedReturnSourceChainName,
    selectedReturnDestinationChainName,
    configuredL1BridgeAddress,
    returnSourceOptions,
    returnNativeBalance,
    returnNativeBalanceQuery,
    l1NativeBalance,
    l1NativeBalanceQuery,
    resolvedL2BridgeAddress,
    resolvedL2BridgeAddressQuery,
    settlementContracts,
    settlementContractsQuery,
    executeReturn,
    proveReturn: handleProve,
    finalizeReturn: handleFinalize,
    isReturnSubmitting,
    returnPhase,
    clearReturnPhase,
    returnResults,
    canSubmitReturn,
    setReturnSourceChainId,
    setReturnAmountInput,
    resetReturnForm
  };
}
