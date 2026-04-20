import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseEther, parseUnits } from 'viem';
import { chainA, chainB, composeConfig, demoTokens, l1FundingConfig, networkProfile, type DemoToken } from '../composeConfig';
import type { PickerOption } from '../components/Picker';
import { readImportedTokens, resolveImportedTokenMetadata, upsertImportedToken } from '../lib/importedTokens';
import { formatChainLabel, formatTokenAmount } from '../lib/format';
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

const getFundingTokenValue = (token: DemoToken) => `${token.kind}:${token.address.toLowerCase()}`;

/**
 * Parses funding input with token decimals and rejects non-positive values.
 */
const parseFundingAmountInput = ({ amountInput, token }: { amountInput: string; token: DemoToken }): bigint | undefined => {
  const trimmedAmountInput = amountInput.trim();
  if (!trimmedAmountInput) return undefined;

  try {
    const amountWei = token.kind === 'nativeEthViaWeth' ? parseEther(trimmedAmountInput) : parseUnits(trimmedAmountInput, token.decimals);
    return amountWei > 0n ? amountWei : undefined;
  } catch {
    return undefined;
  }
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
      ? getFundingTokenValue(defaultNative)
      : demoTokens[0]
        ? getFundingTokenValue(demoTokens[0])
        : `nativeEthViaWeth:${ZERO_ADDRESS}`;
  });
  const [importTokenAddressInput, setImportTokenAddressInput] = useState('');
  const [importTokenError, setImportTokenError] = useState<string | null>(null);
  const [isImportingToken, setIsImportingToken] = useState(false);
  const [importedTokens, setImportedTokens] = useState<DemoToken[]>([]);

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

  useEffect(() => {
    if (!walletAddress || !l1FundingConfig) {
      setImportedTokens([]);
      return;
    }

    // Imported tokens are stored per wallet + network + L1 chain.
    const stored = readImportedTokens({
      networkMode: networkProfile.mode,
      chainId: l1FundingConfig.chain.id,
      walletAddress
    }).map((token) => ({
      ...token,
      kind: 'erc20' as const
    }));

    setImportedTokens(stored);
  }, [walletAddress]);

  const fundingTokens = useMemo(() => {
    const erc20ByAddress = new Map<string, DemoToken>();

    for (const token of curatedErc20FundingTokens) {
      erc20ByAddress.set(token.address.toLowerCase(), token);
    }

    for (const token of importedTokens) {
      erc20ByAddress.set(token.address.toLowerCase(), token);
    }

    return [nativeFundingToken, ...erc20ByAddress.values()] as const;
  }, [curatedErc20FundingTokens, importedTokens, nativeFundingToken]);

  useEffect(() => {
    if (fundingTokens.length === 0) return;
    if (fundingTokens.some((token) => getFundingTokenValue(token) === fundingTokenValue)) return;
    setFundingTokenValue(getFundingTokenValue(fundingTokens[0]));
  }, [fundingTokenValue, fundingTokens]);

  const selectedFundingToken = useMemo(
    () => fundingTokens.find((token) => getFundingTokenValue(token) === fundingTokenValue) ?? fundingTokens[0],
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

  const selectedFundingSourceBalance = selectedFundingToken
    ? selectedFundingToken.kind === 'nativeEthViaWeth'
      ? l1NativeBalance
      : l1TokenBalances?.[selectedFundingToken.address.toLowerCase()]
    : undefined;

  const importFundingToken = useCallback(async () => {
    if (!walletAddress || !l1FundingConfig) {
      setImportTokenError('Connect a wallet and configure L1 funding before importing tokens.');
      return;
    }

    const candidateAddress = importTokenAddressInput.trim();
    if (!candidateAddress) {
      setImportTokenError('Enter a token address to import.');
      return;
    }

    const l1PublicClient = composeConfig.getPublicClient(l1FundingConfig.chain.id);
    if (!l1PublicClient) {
      setImportTokenError(`L1 public client is not configured for chain ${l1FundingConfig.chain.id}.`);
      return;
    }

    try {
      setIsImportingToken(true);
      setImportTokenError(null);

      const token = await resolveImportedTokenMetadata({
        publicClient: l1PublicClient,
        tokenAddress: candidateAddress
      });

      const nextImported = upsertImportedToken({
        networkMode: networkProfile.mode,
        chainId: l1FundingConfig.chain.id,
        walletAddress,
        token
      }).map((item) => ({ ...item, kind: 'erc20' as const }));

      setImportedTokens(nextImported);
      const importedToken: DemoToken = {
        ...token,
        kind: 'erc20'
      };

      setFundingTokenValue(getFundingTokenValue(importedToken));
      setImportTokenAddressInput('');
      void l1TokenBalancesQuery.refetch();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not import token from address.';
      setImportTokenError(message);
    } finally {
      setIsImportingToken(false);
    }
  }, [importTokenAddressInput, l1TokenBalancesQuery, walletAddress]);

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
    }
  });

  const parsedFundingAmountWei = useMemo(
    () => parseFundingAmountInput({ amountInput: fundingAmountInput, token: selectedFundingToken }),
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
      key: `fund-token-${getFundingTokenValue(token)}`,
      value: getFundingTokenValue(token),
      left: token.symbol,
      right: formatTokenAmount(balance, token.decimals)
    }));
  }, [fundingTokens, l1NativeBalance, l1TokenBalances]);

  const selectedFundingTokenDisplayBalance = formatTokenAmount(
    selectedFundingSourceBalance,
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
    selectedFundingTokenDisplayBalance,
    selectedFundingSourceChainLabel,
    selectedFundingDestinationChainLabel,
    selectedFundingSourceChainName,
    selectedFundingDestinationChainName,
    fundingDestinationOptions,
    fundingTokenOptions,
    l1NativeBalance,
    l1NativeBalanceQuery,
    l1TokenBalancesQuery,
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
