import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { chainA, chainB, composeConfig, demoTokens, l1FundingConfig, type DemoToken } from '../composeConfig';
import type { PickerOption } from '../components/Picker';
import { dedupeErc20TokensByAddress, getAssetValue, parsePositiveAssetAmountInput } from '../lib/assets';
import { formatChainLabel, formatTokenAmount } from '../lib/format';
import {
  resolveCetFactoryAddressFromL2Bridge,
  resolveL2BridgeAddressFromL1Bridge,
  resolvePredictedCetAddress
} from '../lib/l1Bridge';
import { useCanonicalL1TokenImport } from './useCanonicalL1TokenImport';
import { useL1FundingExecution } from './useL1FundingExecution';

// Funding-mode state aggregator: destination selection, source balances, and submission state.
type UseFundingScreenStateParams = {
  walletAddress: `0x${string}` | undefined;
  isConnected: boolean;
  ensureWalletOnChain: (targetChainId: number) => Promise<unknown>;
  onClearErrors: () => void;
  onFundingError: (message: string) => void;
};

const AVAILABLE_CHAINS = [chainA, chainB] as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;
const erc20BalanceOfAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

const readErc20BalanceOrZeroIfUndeployed = async ({
  publicClient,
  tokenAddress,
  account
}: {
  publicClient: NonNullable<ReturnType<typeof composeConfig.getPublicClient>>;
  tokenAddress: `0x${string}`;
  account: `0x${string}`;
}) => {
  const tokenCode = await publicClient.getCode({ address: tokenAddress });
  if (!tokenCode || tokenCode === '0x') {
    return 0n;
  }

  return publicClient.readContract({
    address: tokenAddress,
    abi: erc20BalanceOfAbi,
    functionName: 'balanceOf',
    args: [account]
  });
};

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
  const [fundingTokenValue, setFundingTokenValue] = useState<string>(() => {
    const defaultNative = demoTokens.find((token) => token.kind === 'nativeEthViaWeth');
    return defaultNative
      ? getAssetValue(defaultNative)
      : demoTokens[0]
        ? getAssetValue(demoTokens[0])
        : `nativeEthViaWeth:${ZERO_ADDRESS}`;
  });

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

  const nativeFundingToken: DemoToken = useMemo(
    () =>
      demoTokens.find((token) => token.kind === 'nativeEthViaWeth') ?? {
        symbol: 'ETH',
        address: ZERO_ADDRESS,
        decimals: 18,
        kind: 'nativeEthViaWeth'
      },
    []
  );

  const curatedErc20FundingTokens = demoTokens.filter((token) => token.kind === 'erc20');

  const {
    importedTokens,
    importTokenAddressInput,
    importTokenError,
    isImportingToken,
    setImportTokenAddressInput,
    importCanonicalL1Token
  } = useCanonicalL1TokenImport({
    walletAddress,
    l1FundingConfig,
    onImportError: onFundingError
  });

  const fundingTokens = useMemo(() => {
    const dedupedErc20Tokens = dedupeErc20TokensByAddress([...curatedErc20FundingTokens, ...importedTokens]);

    return [nativeFundingToken, ...dedupedErc20Tokens] as const;
  }, [curatedErc20FundingTokens, importedTokens, nativeFundingToken]);

  useEffect(() => {
    if (fundingTokens.length === 0) return;
    if (fundingTokens.some((token) => getAssetValue(token) === fundingTokenValue)) return;
    setFundingTokenValue(getAssetValue(fundingTokens[0]));
  }, [fundingTokenValue, fundingTokens]);

  const selectedFundingToken = useMemo(
    () => fundingTokens.find((token) => getAssetValue(token) === fundingTokenValue) ?? fundingTokens[0],
    [fundingTokenValue, fundingTokens]
  );

  const fundingErc20Tokens = useMemo(
    () => fundingTokens.filter((token) => token.kind === 'erc20'),
    [fundingTokens]
  );

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

  const l1TokenBalancesQuery = useQuery({
    queryKey: [
      'l1-erc20-balances',
      l1FundingConfig?.chain.id,
      walletAddress,
      fundingErc20Tokens.map((token) => token.address.toLowerCase()).join(',')
    ],
    enabled: Boolean(l1FundingConfig?.chain && walletAddress && fundingErc20Tokens.length > 0),
    queryFn: async () => {
      const l1Chain = l1FundingConfig?.chain;
      const eoaAddress = walletAddress;

      if (!l1Chain || !eoaAddress) {
        throw new Error('L1 ERC20 balance context is not ready yet.');
      }

      const publicClient = composeConfig.getPublicClient(l1Chain.id);
      if (!publicClient) {
        throw new Error(`L1 public client is not configured for chain ${l1Chain.id}.`);
      }

      const entries = await Promise.all(
        fundingErc20Tokens.map(async (token) => {
          try {
            const balance = await publicClient.readContract({
              address: token.address,
              abi: erc20BalanceOfAbi,
              functionName: 'balanceOf',
              args: [eoaAddress]
            });

            return [token.address.toLowerCase(), balance] as const;
          } catch {
            return [token.address.toLowerCase(), 0n] as const;
          }
        })
      );

      return Object.fromEntries(entries) as Record<string, bigint>;
    }
  });

  const l1NativeBalance = l1NativeBalanceQuery.data;
  const l1TokenBalances = l1TokenBalancesQuery.data;

  const destinationFundingBalanceQuery = useQuery({
    queryKey: [
      'l2-funding-destination-balance',
      fundingDestinationChain.id,
      walletAddress,
      l1FundingConfig?.chain.id,
      selectedFundingToken.kind,
      selectedFundingToken.address
    ],
    enabled: Boolean(l1FundingConfig?.chain && walletAddress),
    queryFn: async () => {
      const l1Chain = l1FundingConfig?.chain;
      const eoaAddress = walletAddress;

      if (!l1Chain || !eoaAddress) {
        throw new Error('Destination balance context is not ready yet.');
      }

      const destinationPublicClient = composeConfig.getPublicClient(fundingDestinationChain.id);
      if (!destinationPublicClient) {
        throw new Error(`Destination rollup public client is not configured for chain ${fundingDestinationChain.id}.`);
      }

      if (selectedFundingToken.kind === 'nativeEthViaWeth') {
        return destinationPublicClient.getBalance({ address: eoaAddress });
      }

      const l1BridgeAddress = l1FundingConfig?.bridgeByDestinationChainId[fundingDestinationChain.id];
      if (!l1BridgeAddress) {
        throw new Error(`L1 bridge contract is not configured for destination chain ${fundingDestinationChain.id}.`);
      }

      const l1PublicClient = composeConfig.getPublicClient(l1Chain.id);
      if (!l1PublicClient) {
        throw new Error(`L1 public client is not configured for chain ${l1Chain.id}.`);
      }

      const destinationL2BridgeAddress = await resolveL2BridgeAddressFromL1Bridge({
        l1PublicClient,
        l1BridgeAddress
      });
      const destinationCetFactoryAddress = await resolveCetFactoryAddressFromL2Bridge({
        l2PublicClient: destinationPublicClient,
        l2BridgeAddress: destinationL2BridgeAddress
      });
      const predictedCetAddress = await resolvePredictedCetAddress({
        l2PublicClient: destinationPublicClient,
        cetFactoryAddress: destinationCetFactoryAddress,
        remoteAsset: selectedFundingToken.address,
        remoteChainId: l1Chain.id
      });

      return readErc20BalanceOrZeroIfUndeployed({
        publicClient: destinationPublicClient,
        tokenAddress: predictedCetAddress,
        account: eoaAddress
      });
    }
  });

  const selectedFundingSourceBalance = selectedFundingToken
    ? selectedFundingToken.kind === 'nativeEthViaWeth'
      ? l1NativeBalance
      : l1TokenBalances?.[selectedFundingToken.address.toLowerCase()]
    : undefined;
  const selectedFundingDestinationBalance = destinationFundingBalanceQuery.data;

  const importFundingToken = useCallback(async () => {
    const importedToken = await importCanonicalL1Token();
    if (!importedToken) return;

    setFundingTokenValue(getAssetValue(importedToken));
    void l1TokenBalancesQuery.refetch();
    return importedToken;
  }, [importCanonicalL1Token, l1TokenBalancesQuery]);

  const {
    executeFunding,
    isSubmitting: isFundingSubmitting,
    phase: fundingPhase,
    clearPhase: clearFundingPhase,
    results: fundingResults
  } = useL1FundingExecution({
    amountInput: fundingAmountInput,
    selectedToken: selectedFundingToken,
    walletAddress,
    destinationChain: fundingDestinationChain,
    l1FundingConfig,
    availableSourceBalance: selectedFundingSourceBalance,
    ensureWalletOnChain,
    onClearErrors,
    onFundingError,
    onFundingSuccess: () => {
      void l1NativeBalanceQuery.refetch();
      void l1TokenBalancesQuery.refetch();
      void destinationFundingBalanceQuery.refetch();
    }
  });

  const parsedFundingAmountWei = useMemo(
    () =>
      parsePositiveAssetAmountInput({
        amountInput: fundingAmountInput,
        tokenKind: selectedFundingToken.kind,
        tokenDecimals: selectedFundingToken.decimals
      }),
    [fundingAmountInput, selectedFundingToken]
  );

  const hasSufficientFundingBalance =
    selectedFundingSourceBalance === undefined
      ? true
      : parsedFundingAmountWei !== undefined && parsedFundingAmountWei <= selectedFundingSourceBalance;

  const canSubmitFunding =
    isConnected &&
    Boolean(l1FundingConfig) &&
    parsedFundingAmountWei !== undefined &&
    hasSufficientFundingBalance &&
    !isFundingSubmitting;

  const fundingDestinationOptions: PickerOption<number>[] = useMemo(
    () =>
      AVAILABLE_CHAINS.map((chain) => ({
        key: `fund-destination-${chain.id}`,
        value: chain.id,
        left: formatChainLabel(chain.name, chain.id)
      })),
    []
  );

  const fundingTokenOptions: PickerOption<string>[] = useMemo(() => {
    const withBalance = fundingTokens.map((token) => {
      const balance =
        token.kind === 'nativeEthViaWeth'
          ? l1NativeBalance
          : l1TokenBalances?.[token.address.toLowerCase()];

      return {
        token,
        balance,
        hasBalance: balance !== undefined ? balance > 0n : false
      };
    });

    // Keep native ETH first, then funded ERC20s, then zero-balance ERC20s.
    const sorted = [
      ...withBalance.filter((entry) => entry.token.kind === 'nativeEthViaWeth'),
      ...withBalance.filter((entry) => entry.token.kind === 'erc20' && entry.hasBalance),
      ...withBalance.filter((entry) => entry.token.kind === 'erc20' && !entry.hasBalance)
    ];

    return sorted.map(({ token, balance }) => ({
      key: `fund-token-${getAssetValue(token)}`,
      value: getAssetValue(token),
      left: token.symbol,
      right: formatTokenAmount(balance, token.decimals)
    }));
  }, [fundingTokens, l1NativeBalance, l1TokenBalances]);

  const selectedFundingTokenDisplayBalance = formatTokenAmount(
    selectedFundingSourceBalance,
    selectedFundingToken.decimals
  );
  const selectedFundingDestinationDisplayBalance = formatTokenAmount(
    selectedFundingDestinationBalance,
    selectedFundingToken.decimals
  );

  const resetFundingForm = useCallback(() => {
    setFundingAmountInput('');
  }, []);

  return {
    fundingDestinationChainId,
    fundingAmountInput,
    fundingDestinationChain,
    fundingTokenValue,
    selectedFundingToken,
    selectedFundingSourceBalance,
    selectedFundingDestinationBalance,
    selectedFundingTokenDisplayBalance,
    selectedFundingDestinationDisplayBalance,
    selectedFundingSourceChainLabel,
    selectedFundingDestinationChainLabel,
    selectedFundingSourceChainName,
    selectedFundingDestinationChainName,
    fundingDestinationOptions,
    fundingTokenOptions,
    l1NativeBalance,
    l1NativeBalanceQuery,
    l1TokenBalancesQuery,
    destinationFundingBalanceQuery,
    executeFunding,
    isFundingSubmitting,
    fundingPhase,
    clearFundingPhase,
    fundingResults,
    canSubmitFunding,
    importTokenAddressInput,
    importTokenError,
    isImportingToken,
    setFundingDestinationChainId,
    setFundingAmountInput,
    setFundingTokenValue,
    setImportTokenAddressInput,
    importFundingToken,
    resetFundingForm
  };
}
