import { useQuery } from '@tanstack/react-query';
import { useSmartAccount } from '@ssv-labs/ethera-sdk/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { erc20Abi } from 'viem';
import {
  chainA,
  chainB,
  composeConfig,
  demoTokens,
  l1FundingConfig,
  networkProfile,
  universalContracts,
  type DemoToken
} from '../composeConfig';
import { dedupeErc20TokensByAddress, getAssetValue } from '../lib/assets';
import { formatChainLabel, formatTokenAmount } from '../lib/format';
import { resolveCetFactoryAddressFromL2Bridge, resolvePredictedCetAddress } from '../lib/l1Bridge';
import { resolveImportedTokenMetadata, upsertImportedToken } from '../lib/importedTokens';
import { resolveDestinationPayoutTokenAddress, resolveSourceTokenBridgeMode } from './bridgeExecution';
import { useCanonicalL1TokenImport } from './useCanonicalL1TokenImport';
import { useBridgeExecution } from './useBridgeExecution';
import { useImportedTokensStorage } from './useImportedTokensStorage';
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
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

type AutoResolvedBridgeToken = DemoToken & {
  kind: 'erc20';
  bridgeMode: 'cet';
};

const readBridgeErc20BalanceOrZeroIfUndeployed = async ({
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
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [account]
  });
};

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
  const nativeBridgeToken = useMemo<DemoToken>(
    () =>
      demoTokens.find((token) => token.kind === 'nativeEthViaWeth') ?? {
        symbol: 'ETH',
        address: ZERO_ADDRESS,
        decimals: 18,
        kind: 'nativeEthViaWeth'
      },
    []
  );
  const curatedErc20BridgeTokens = useMemo(() => demoTokens.filter((token) => token.kind === 'erc20'), []);
  const [selectedTokenValue, setSelectedTokenValue] = useState<string>(() => getAssetValue(nativeBridgeToken));
  const [amountInput, setAmountInput] = useState('');
  const [importTokenAddressInput, setImportTokenAddressInput] = useState('');
  const [importTokenError, setImportTokenError] = useState<string | null>(null);
  const [isImportingToken, setIsImportingToken] = useState(false);

  const entryPointAddress = composeConfig.entryPoint.address as `0x${string}`;
  const universalBridgeAddress = universalContracts?.l2ToL2Bridge;

  const { importedTokens: importedCanonicalL1Tokens } = useCanonicalL1TokenImport({
    walletAddress,
    l1FundingConfig
  });

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
  const sourceComposeL2BridgeAddress = networkProfile.universal?.l2BridgeByChainId?.[sourceChain.id];
  const canonicalL1ChainId = l1FundingConfig?.chain.id;
  const importedRollupTokens = useImportedTokensStorage({
    chainId: sourceChain.id,
    walletAddress
  });
  const importedTokens = useMemo<DemoToken[]>(
    () =>
      importedRollupTokens.map((token) => ({
        ...token,
        kind: 'erc20' as const
      })),
    [importedRollupTokens]
  );

  const sharedSmartAccountAddress = smartAccountAQuery.data?.account.address;

  const autoResolvedBridgeTokensQuery = useQuery({
    queryKey: [
      'bridge-auto-resolved-tokens',
      sourceChain.id,
      walletAddress,
      canonicalL1ChainId,
      sourceComposeL2BridgeAddress,
      importedCanonicalL1Tokens.map((token) => token.address.toLowerCase()).join(',')
    ],
    enabled: Boolean(
      walletAddress && canonicalL1ChainId && sourceComposeL2BridgeAddress && importedCanonicalL1Tokens.length > 0
    ),
    queryFn: async (): Promise<AutoResolvedBridgeToken[]> => {
      if (!canonicalL1ChainId || !sourceComposeL2BridgeAddress) {
        throw new Error('Source rollup token discovery context is not ready yet.');
      }

      const sourcePublicClient = composeConfig.getPublicClient(sourceChain.id);
      if (!sourcePublicClient) {
        throw new Error(`Source rollup public client is not configured for chain ${sourceChain.id}.`);
      }

      const cetFactoryAddress = await resolveCetFactoryAddressFromL2Bridge({
        l2PublicClient: sourcePublicClient,
        l2BridgeAddress: sourceComposeL2BridgeAddress
      });

      const resolvedTokens = await Promise.all(
        importedCanonicalL1Tokens.map(async (canonicalToken) => {
          try {
            const predictedTokenAddress = await resolvePredictedCetAddress({
              l2PublicClient: sourcePublicClient,
              cetFactoryAddress,
              remoteAsset: canonicalToken.address,
              remoteChainId: canonicalL1ChainId
            });

            const tokenCode = await sourcePublicClient.getCode({ address: predictedTokenAddress });
            if (!tokenCode || tokenCode === '0x') {
              return undefined;
            }

            return {
              symbol: canonicalToken.symbol,
              address: predictedTokenAddress,
              decimals: canonicalToken.decimals,
              kind: 'erc20',
              bridgeMode: 'cet'
            } satisfies AutoResolvedBridgeToken;
          } catch {
            return undefined;
          }
        })
      );

      return resolvedTokens.filter((token): token is AutoResolvedBridgeToken => Boolean(token));
    }
  });

  const bridgeTokens = useMemo(() => {
    const dedupedErc20Tokens = dedupeErc20TokensByAddress([
      ...curatedErc20BridgeTokens,
      ...(autoResolvedBridgeTokensQuery.data ?? []),
      ...importedTokens
    ]);
    return [nativeBridgeToken, ...dedupedErc20Tokens];
  }, [autoResolvedBridgeTokensQuery.data, curatedErc20BridgeTokens, importedTokens, nativeBridgeToken]);

  useEffect(() => {
    if (bridgeTokens.length === 0) return;
    if (bridgeTokens.some((token) => getAssetValue(token) === selectedTokenValue)) return;
    setSelectedTokenValue(getAssetValue(bridgeTokens[0]));
  }, [bridgeTokens, selectedTokenValue]);

  const selectedToken = useMemo(
    () => bridgeTokens.find((token) => getAssetValue(token) === selectedTokenValue) ?? bridgeTokens[0],
    [bridgeTokens, selectedTokenValue]
  );

  const selectedSourceChainLabel = formatChainLabel(sourceChain.name, sourceChain.id);
  const selectedDestinationChainLabel = formatChainLabel(destinationChain.name, destinationChain.id);

  const bridgeErc20Tokens = useMemo(
    () => bridgeTokens.filter((token) => token.kind === 'erc20'),
    [bridgeTokens]
  );

  const sourceTokenBalancesQuery = useQuery({
    queryKey: [
      'source-token-balances',
      sourceChain.id,
      sharedSmartAccountAddress,
      walletAddress,
      bridgeErc20Tokens.map((token) => token.address.toLowerCase()).join(',')
    ],
    enabled: Boolean(sourceSmart?.publicClient && sharedSmartAccountAddress && walletAddress),
    queryFn: async () => {
      const smart = sourceSmart;
      const smartAddress = sharedSmartAccountAddress;
      const eoaAddress = walletAddress;

      if (!smart || !smartAddress || !eoaAddress) {
        throw new Error('Source smart account is not ready yet.');
      }

      const entries = await Promise.all(
        bridgeErc20Tokens.map(async (token) => {
          const [smartBalance, eoaBalance] = await Promise.all([
            readBridgeErc20BalanceOrZeroIfUndeployed({
              publicClient: smart.publicClient,
              tokenAddress: token.address,
              account: smartAddress
            }),
            readBridgeErc20BalanceOrZeroIfUndeployed({
              publicClient: smart.publicClient,
              tokenAddress: token.address,
              account: eoaAddress
            })
          ]);

          return [token.address.toLowerCase(), smartBalance + eoaBalance] as const;
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
    queryKey: [
      'destination-balance',
      destinationChain.id,
      sourceChain.id,
      sourceSmart?.account.address,
      destinationSmart?.account.address,
      universalBridgeAddress,
      selectedToken?.kind,
      selectedToken?.address,
      walletAddress
    ],
    enabled: Boolean(
      destinationSmart?.publicClient &&
        walletAddress &&
        selectedToken &&
        (selectedToken.kind === 'nativeEthViaWeth' || sourceSmart?.publicClient)
    ),
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

      const sourceSmartAccount = sourceSmart;
      if (!sourceSmartAccount) {
        throw new Error('Source smart account is not ready yet.');
      }

      if (!universalBridgeAddress) {
        return readBridgeErc20BalanceOrZeroIfUndeployed({
          publicClient: smart.publicClient,
          tokenAddress: selectedToken.address,
          account: eoaAddress
        });
      }

      const sourceTokenBridgeMode = await resolveSourceTokenBridgeMode({
        sourceSmart: sourceSmartAccount,
        selectedToken
      });
      const destinationPayoutTokenAddress = await resolveDestinationPayoutTokenAddress({
        sourceSmart: sourceSmartAccount,
        destinationSmart: smart,
        selectedToken,
        sourceTokenBridgeMode,
        sourceChainId: sourceChain.id,
        destinationChainId: destinationChain.id,
        universalBridgeAddress
      });

      return readBridgeErc20BalanceOrZeroIfUndeployed({
        publicClient: smart.publicClient,
        tokenAddress: destinationPayoutTokenAddress,
        account: eoaAddress
      });
    }
  });

  const sourceTokenBalances = sourceTokenBalancesQuery.data;
  const sourceNativeBalances = sourceNativeBalancesQuery.data;
  const refetchSourceTokenBalances = sourceTokenBalancesQuery.refetch;
  const refetchDestinationBalance = destinationBalanceQuery.refetch;

  useEffect(() => {
    if (!autoResolvedBridgeTokensQuery.data) return;

    void refetchSourceTokenBalances();
    void refetchDestinationBalance();
  }, [autoResolvedBridgeTokensQuery.data, refetchDestinationBalance, refetchSourceTokenBalances]);

  const sourceBalance = selectedToken
    ? selectedToken.kind === 'nativeEthViaWeth'
      ? sourceNativeBalances?.total
      : sourceTokenBalances?.[selectedToken.address.toLowerCase()]
    : undefined;
  const selectedTokenDisplayBalance = selectedToken ? formatTokenAmount(sourceBalance, selectedToken.decimals) : '...';
  const selectedTokenHasBalance = sourceBalance === undefined ? true : sourceBalance > 0n;
  const noBalanceTooltip = selectedToken
    ? `No ${selectedToken.symbol} available on source chain (EOA + smart account).`
    : undefined;

  const importBridgeToken = useCallback(async () => {
    if (!walletAddress) {
      const message = 'Connect a wallet before importing a rollup token.';
      setImportTokenError(message);
      onBridgeError(message);
      return undefined;
    }

    const candidateAddress = importTokenAddressInput.trim();
    if (!candidateAddress) {
      const message = 'Enter the token address on the current source rollup.';
      setImportTokenError(message);
      onBridgeError(message);
      return undefined;
    }

    const sourcePublicClient = composeConfig.getPublicClient(sourceChain.id);
    if (!sourcePublicClient) {
      const message = `Source rollup public client is not configured for chain ${sourceChain.id}.`;
      setImportTokenError(message);
      onBridgeError(message);
      return undefined;
    }

    try {
      setIsImportingToken(true);
      setImportTokenError(null);

      const token = await resolveImportedTokenMetadata({
        publicClient: sourcePublicClient,
        tokenAddress: candidateAddress
      });

      upsertImportedToken({
        networkMode: networkProfile.mode,
        chainId: sourceChain.id,
        walletAddress,
        token
      });

      const importedToken: DemoToken = {
        ...token,
        kind: 'erc20'
      };

      setImportTokenAddressInput('');
      setSelectedTokenValue(getAssetValue(importedToken));
      void sourceTokenBalancesQuery.refetch();
      void destinationBalanceQuery.refetch();

      return importedToken;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Could not import token from address.';
      const message = rawMessage.toLowerCase().includes('valid evm address')
        ? 'Enter a valid token address on the current source rollup.'
        : 'Could not import token. Enter the token address on the current source rollup.';
      setImportTokenError(message);
      onBridgeError(message);
      return undefined;
    } finally {
      setIsImportingToken(false);
    }
  }, [
    destinationBalanceQuery,
    importTokenAddressInput,
    onBridgeError,
    sourceChain.id,
    sourceTokenBalancesQuery,
    walletAddress
  ]);

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
    universalBridgeAddress,
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
    Boolean(universalBridgeAddress) &&
    hasAmountInput &&
    !accountsLoading &&
    !isSubmitting &&
    sourceChain.id !== destinationChain.id &&
    selectedTokenHasBalance;

  const bridgeDisabledReason = universalBridgeAddress
    ? null
    : 'Universal L2->L2 bridge address is missing. Set VITE_TESTNET_UNIVERSAL_L2_TO_L2_BRIDGE.';

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

  const tokenOptions: PickerOption<string>[] = useMemo(
    () =>
      bridgeTokens.map((token) => {
        const balance =
          token.kind === 'nativeEthViaWeth'
            ? sourceNativeBalances?.total
            : sourceTokenBalances?.[token.address.toLowerCase()];
        const isNoBalance = balance !== undefined && balance === 0n;

        return {
          key: getAssetValue(token),
          value: getAssetValue(token),
          left: token.symbol,
          right: formatTokenAmount(balance, token.decimals),
          disabled: isNoBalance
        };
      }),
    [bridgeTokens, sourceNativeBalances?.total, sourceTokenBalances]
  );

  const resetBridgeForm = useCallback(() => {
    setAmountInput('');
  }, []);

  return {
    sourceChainId,
    destinationChainId,
    selectedTokenValue,
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
    bridgeDisabledReason,
    canSubmitBridge,
    executeBridge,
    isSubmitting,
    bridgePhase,
    clearBridgePhase,
    results,
    smartByChainId,
    importTokenAddressInput,
    importTokenError,
    isImportingToken,
    setSelectedTokenValue,
    setImportTokenAddressInput,
    importBridgeToken,
    setAmountInput,
    handleSourceChainChange,
    handleDestinationChainChange,
    resetBridgeForm
  };
}
