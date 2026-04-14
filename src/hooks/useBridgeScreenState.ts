import { useQuery } from '@tanstack/react-query';
import { useSmartAccount } from '@ssv-labs/compose-sdk/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { erc20Abi } from 'viem';
import { chainA, chainB, bridgeAddress, composeConfig, demoTokens, networkProfile, type DemoToken } from '../composeConfig';
import { formatChainLabel, formatTokenAmount } from '../lib/format';
import { useBridgeExecution } from './useBridgeExecution';
import type { PickerOption } from '../components/Picker';
import type { DepositRequirement } from '../types/deposit';
import type { TokenBalances } from '../types/bridge';

// Bridge-mode state aggregator: smart accounts, balances, picker options, and submit gating.
type UseBridgeScreenStateParams = {
  walletAddress: `0x${string}` | undefined;
  walletChainId: number | undefined;
  isConnected: boolean;
  isWalletOnSupportedChain: boolean;
  ensureWalletOnChain: (targetChainId: number) => Promise<unknown>;
  onClearErrors: () => void;
  onBridgeError: (message: string) => void;
  onDepositRequired: (requirements: DepositRequirement[], suggestedTopUpInput: string) => void;
};

const AVAILABLE_CHAINS = [chainA, chainB] as const;
const CHAIN_IDS = [chainA.id, chainB.id] as [number, number];
const getOppositeChainId = (chainId: number) => (chainId === chainA.id ? chainB.id : chainA.id);

/**
 * Prepares all bridge screen view-model state while delegating execution to useBridgeExecution.
 */
export function useBridgeScreenState({
  walletAddress,
  walletChainId,
  isConnected,
  isWalletOnSupportedChain,
  ensureWalletOnChain,
  onClearErrors,
  onBridgeError,
  onDepositRequired
}: UseBridgeScreenStateParams) {
  const [sourceChainId, setSourceChainId] = useState<number>(chainA.id);
  const [destinationChainId, setDestinationChainId] = useState<number>(chainB.id);
  const [selectedTokenSymbol, setSelectedTokenSymbol] = useState<DemoToken['symbol']>(() => demoTokens[0]?.symbol ?? '');
  const [amountInput, setAmountInput] = useState('');

  const entryPointAddress = composeConfig.entryPoint.address as `0x${string}`;

  const smartAccountAQuery = useSmartAccount({ chainId: chainA.id, multiChainIds: CHAIN_IDS });
  const smartAccountBQuery = useSmartAccount({ chainId: chainB.id, multiChainIds: CHAIN_IDS });
  const refetchSmartAccountA = smartAccountAQuery.refetch;
  const refetchSmartAccountB = smartAccountBQuery.refetch;

  const smartByChainId = useMemo(
    () => ({
      [chainA.id]: smartAccountAQuery.data,
      [chainB.id]: smartAccountBQuery.data
    }),
    [smartAccountAQuery.data, smartAccountBQuery.data]
  );

  const sourceSmart = smartByChainId[sourceChainId];
  const destinationSmart = smartByChainId[destinationChainId];
  const sourceChain = sourceChainId === chainA.id ? chainA : chainB;
  const destinationChain = destinationChainId === chainA.id ? chainA : chainB;

  const sharedSmartAccountAddress = smartAccountAQuery.data?.account.address;

  const selectedToken = useMemo(
    () => demoTokens.find((token) => token.symbol === selectedTokenSymbol) ?? demoTokens[0],
    [selectedTokenSymbol]
  );

  const selectedSourceChainLabel = formatChainLabel(sourceChain.name, sourceChain.id);
  const selectedDestinationChainLabel = formatChainLabel(destinationChain.name, destinationChain.id);

  const sourceTokenBalancesQuery = useQuery({
    queryKey: ['source-token-balances', sourceChain.id, sharedSmartAccountAddress, walletAddress],
    enabled: Boolean(sourceSmart?.publicClient && sharedSmartAccountAddress && walletAddress),
    queryFn: async () => {
      const smart = sourceSmart;
      const smartAddress = sharedSmartAccountAddress;
      const eoaAddress = walletAddress;

      if (!smart || !smartAddress || !eoaAddress) {
        throw new Error('Source smart account is not ready yet.');
      }

      const erc20Tokens = demoTokens.filter((token) => token.kind === 'erc20');
      const entries = await Promise.all(
        erc20Tokens.map(async (token) => {
          const [smartBalance, eoaBalance] = await Promise.all([
            smart.publicClient.readContract({
              address: token.address,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [smartAddress]
            }),
            smart.publicClient.readContract({
              address: token.address,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [eoaAddress]
            })
          ]);
          return [token.symbol, smartBalance + eoaBalance] as const;
        })
      );
      return Object.fromEntries(entries) as TokenBalances;
    }
  });

  const sourceNativeBalancesQuery = useQuery({
    queryKey: ['source-native-balances', sourceChain.id, sharedSmartAccountAddress, walletAddress],
    enabled: Boolean(sourceSmart?.publicClient && sharedSmartAccountAddress && walletAddress),
    queryFn: async () => {
      // ETH mode uses native source balances (EOA + smart account), not ERC20 balanceOf.
      const smart = sourceSmart;
      const smartAddress = sharedSmartAccountAddress;
      const eoaAddress = walletAddress;

      if (!smart || !smartAddress || !eoaAddress) {
        throw new Error('Source native balance context is not ready yet.');
      }

      const [smartBalance, eoaBalance] = await Promise.all([
        smart.publicClient.getBalance({ address: smartAddress }),
        smart.publicClient.getBalance({ address: eoaAddress })
      ]);

      return {
        smart: smartBalance,
        eoa: eoaBalance,
        total: smartBalance + eoaBalance
      };
    }
  });

  const destinationBalanceQuery = useQuery({
    queryKey: ['destination-balance', destinationChain.id, selectedToken?.kind, selectedToken?.address, walletAddress],
    enabled: Boolean(destinationSmart?.publicClient && walletAddress && selectedToken),
    queryFn: async () => {
      const smart = destinationSmart;
      const eoaAddress = walletAddress;

      if (!smart || !eoaAddress || !selectedToken) {
        throw new Error('Destination EOA context is not ready yet.');
      }

      // ETH mode reads native destination balance; ERC20 mode keeps token balanceOf behavior.
      if (selectedToken.kind === 'nativeEthViaWeth') {
        return smart.publicClient.getBalance({ address: eoaAddress });
      }

      return smart.publicClient.readContract({
        address: selectedToken.address,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [eoaAddress]
      });
    }
  });

  const sourceTokenBalances = sourceTokenBalancesQuery.data;
  const sourceNativeBalances = sourceNativeBalancesQuery.data;
  const sourceBalance = selectedToken
    ? selectedToken.kind === 'nativeEthViaWeth'
      ? sourceNativeBalances?.total
      : sourceTokenBalances?.[selectedToken.symbol]
    : undefined;
  const selectedTokenDisplayBalance = selectedToken ? formatTokenAmount(sourceBalance, selectedToken.decimals) : '...';
  const selectedTokenHasBalance = sourceBalance === undefined ? true : sourceBalance > 0n;
  const noBalanceTooltip = selectedToken
    ? `No ${selectedToken.symbol} available on source chain (EOA + smart account).`
    : undefined;

  const handleSourceChainChange = useCallback(
    (nextSourceChainId: number) => {
      setSourceChainId(nextSourceChainId);
      if (nextSourceChainId === destinationChainId) {
        setDestinationChainId(getOppositeChainId(nextSourceChainId));
      }
    },
    [destinationChainId]
  );

  const handleDestinationChainChange = useCallback(
    (nextDestinationChainId: number) => {
      setDestinationChainId(nextDestinationChainId);
      if (nextDestinationChainId === sourceChainId) {
        setSourceChainId(getOppositeChainId(nextDestinationChainId));
      }
    },
    [sourceChainId]
  );

  const refreshBridgeBalances = useCallback(() => {
    void sourceTokenBalancesQuery.refetch();
    void sourceNativeBalancesQuery.refetch();
    void destinationBalanceQuery.refetch();
  }, [destinationBalanceQuery, sourceNativeBalancesQuery, sourceTokenBalancesQuery]);

  const { executeBridge, isSubmitting, bridgePhase, clearBridgePhase, results } = useBridgeExecution({
    amountInput,
    selectedToken,
    sourceBalance,
    walletAddress,
    sourceChain,
    destinationChain,
    sourceSmart,
    destinationSmart,
    bridgeAddress,
    entryPointAddress,
    hasPaymaster: Boolean(networkProfile.paymasterByChainId),
    ensureWalletOnChain,
    onClearErrors,
    onBridgeError,
    onDepositRequired,
    onRefreshBalances: refreshBridgeBalances
  });

  useEffect(() => {
    if (!isConnected || !walletAddress) return;
    if (!isWalletOnSupportedChain) return;

    void refetchSmartAccountA();
    void refetchSmartAccountB();
  }, [isConnected, isWalletOnSupportedChain, walletAddress, walletChainId, refetchSmartAccountA, refetchSmartAccountB]);

  const accountsLoading = smartAccountAQuery.isLoading || smartAccountBQuery.isLoading;
  const sourceBalancesLoading = sourceTokenBalancesQuery.isLoading || sourceNativeBalancesQuery.isLoading;
  const hasAmountInput = amountInput.trim().length > 0;
  const canSubmitBridge =
    isConnected &&
    Boolean(selectedToken) &&
    hasAmountInput &&
    !accountsLoading &&
    !isSubmitting &&
    sourceChain.id !== destinationChain.id &&
    selectedTokenHasBalance;

  const sourceOptions: PickerOption<number>[] = useMemo(
    () =>
      AVAILABLE_CHAINS.map((chain) => ({
        key: `source-${chain.id}`,
        value: chain.id,
        left: formatChainLabel(chain.name, chain.id)
      })),
    []
  );

  const destinationOptions: PickerOption<number>[] = useMemo(
    () =>
      AVAILABLE_CHAINS.map((chain) => ({
        key: `destination-${chain.id}`,
        value: chain.id,
        left: formatChainLabel(chain.name, chain.id)
      })),
    []
  );

  const tokenOptions: PickerOption<DemoToken['symbol']>[] = useMemo(
    () =>
      demoTokens.map((token) => {
        const balance = token.kind === 'nativeEthViaWeth' ? sourceNativeBalances?.total : sourceTokenBalances?.[token.symbol];
        const isNoBalance = balance !== undefined && balance === 0n;

        return {
          key: token.symbol,
          value: token.symbol,
          left: token.symbol,
          right: formatTokenAmount(balance, token.decimals),
          disabled: isNoBalance
        };
      }),
    [sourceNativeBalances?.total, sourceTokenBalances]
  );

  const resetBridgeForm = useCallback(() => {
    setAmountInput('');
  }, []);

  return {
    sourceChainId,
    destinationChainId,
    selectedTokenSymbol,
    amountInput,
    sourceChain,
    destinationChain,
    selectedToken,
    sourceBalance,
    selectedSourceChainLabel,
    selectedDestinationChainLabel,
    selectedTokenDisplayBalance,
    selectedTokenHasBalance,
    noBalanceTooltip,
    sourceOptions,
    destinationOptions,
    tokenOptions,
    sourceTokenBalancesQuery,
    sourceNativeBalancesQuery,
    destinationBalanceQuery,
    accountsLoading,
    sourceBalancesLoading,
    canSubmitBridge,
    executeBridge,
    isSubmitting,
    bridgePhase,
    clearBridgePhase,
    results,
    smartByChainId,
    setSelectedTokenSymbol,
    setAmountInput,
    handleSourceChainChange,
    handleDestinationChainChange,
    resetBridgeForm
  };
}
