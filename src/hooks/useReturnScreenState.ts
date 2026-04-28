import { useQuery } from '@tanstack/react-query';
import { erc20Abi } from 'viem';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { chainA, chainB, composeConfig, demoTokens, l1FundingConfig, networkProfile } from '../composeConfig';
import type { PickerOption } from '../components/Picker';
import { dedupeErc20TokensByAddress, getAssetValue, parsePositiveAssetAmountInput } from '../lib/assets';
import { formatChainLabel, formatTokenAmount } from '../lib/format';
import { resolveCetFactoryAddressFromL2Bridge, resolvePredictedCetAddress } from '../lib/l1Bridge';
import { resolveReturnRouteForSourceChain } from '../lib/returnRoute';
import type { ReturnExecutionAsset } from '../types/funding';
import { useCanonicalL1TokenImport } from './useCanonicalL1TokenImport';
import { useL2ReturnExecution } from './useL2ReturnExecution';

// Return-mode state aggregator: source rollup selection, route resolution, assets, and settlement controls.
type UseReturnScreenStateParams = {
  walletAddress: `0x${string}` | undefined;
  isConnected: boolean;
  ensureWalletOnChain: (targetChainId: number) => Promise<unknown>;
  onClearErrors: () => void;
  onReturnError: (message: string) => void;
};

const AVAILABLE_CHAINS = [chainA, chainB] as const;
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

type ResolvedReturnErc20Asset = {
  value: string;
  kind: 'erc20';
  symbol: string;
  decimals: number;
  l1TokenAddress: `0x${string}`;
  l2TokenAddress: `0x${string}`;
  sourceBalance: bigint;
  destinationBalance: bigint;
};

type ReturnAsset =
  | {
      value: string;
      kind: 'nativeEthViaWeth';
      symbol: string;
      decimals: number;
      sourceBalance: bigint | undefined;
      destinationBalance: bigint | undefined;
    }
  | ResolvedReturnErc20Asset;

/**
 * Prepares all state needed by the rollup -> L1 ETH/ERC-20 return UI.
 */
export function useReturnScreenState({
  walletAddress,
  isConnected,
  ensureWalletOnChain,
  onClearErrors,
  onReturnError
}: UseReturnScreenStateParams) {
  const nativeReturnToken = useMemo(
    () =>
      demoTokens.find((token) => token.kind === 'nativeEthViaWeth') ?? {
        symbol: 'ETH',
        address: ZERO_ADDRESS,
        decimals: 18,
        kind: 'nativeEthViaWeth' as const
      },
    []
  );

  const [returnSourceChainId, setReturnSourceChainId] = useState<number>(chainA.id);
  const [returnAmountInput, setReturnAmountInput] = useState('');
  const [returnTokenValue, setReturnTokenValue] = useState<string>(() => getAssetValue(nativeReturnToken));

  const returnSourceChain = returnSourceChainId === chainA.id ? chainA : chainB;
  const selectedReturnSourceChainLabel = formatChainLabel(returnSourceChain.name, returnSourceChain.id);
  const selectedReturnDestinationChainLabel = l1FundingConfig
    ? formatChainLabel(l1FundingConfig.chain.name, l1FundingConfig.chain.id)
    : 'L1';
  const selectedReturnSourceChainName = returnSourceChain.name;
  const selectedReturnDestinationChainName = l1FundingConfig?.chain.name ?? 'L1';

  const {
    importedTokens,
    importTokenAddressInput: returnImportTokenAddressInput,
    importTokenError: returnImportTokenError,
    isImportingToken: isImportingReturnToken,
    setImportTokenAddressInput: setReturnImportTokenAddressInput,
    importCanonicalL1Token
  } = useCanonicalL1TokenImport({
    walletAddress,
    l1FundingConfig,
    onImportError: onReturnError
  });

  const canonicalL1Erc20Tokens = useMemo(() => {
    const curatedCanonicalTokens = demoTokens.filter((token) => token.kind === 'erc20');
    return dedupeErc20TokensByAddress([...curatedCanonicalTokens, ...importedTokens]);
  }, [importedTokens]);

  const configuredComposePortalAddress = l1FundingConfig?.composePortalBySourceChainId?.[returnSourceChain.id];
  const configuredUniversalL2BridgeAddress = networkProfile.universal?.l2BridgeByChainId?.[returnSourceChain.id];
  const configuredUniversalComposePortalAddress = networkProfile.universal?.composePortalByChainId?.[returnSourceChain.id];

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

  // Resolve both L2 bridge and L1 settlement contracts in one universal-first query.
  const returnRouteQuery = useQuery({
    queryKey: [
      'l2-return-route',
      l1FundingConfig?.chain.id,
      returnSourceChain.id,
      configuredComposePortalAddress,
      configuredUniversalL2BridgeAddress,
      configuredUniversalComposePortalAddress
    ],
    enabled: Boolean(l1FundingConfig),
    queryFn: async () => {
      if (!l1FundingConfig) {
        throw new Error('L1 funding bridge configuration is not ready.');
      }

      const l1PublicClient = composeConfig.getPublicClient(l1FundingConfig.chain.id);
      if (!l1PublicClient) {
        throw new Error(`L1 public client is not configured for chain ${l1FundingConfig.chain.id}.`);
      }

      return resolveReturnRouteForSourceChain({
        sourceChainId: returnSourceChain.id,
        l1FundingConfig,
        universalContracts: networkProfile.universal,
        l1PublicClient
      });
    }
  });

  const sourceL2BridgeAddress = returnRouteQuery.data?.l2BridgeAddress;

  const returnErc20AssetsQuery = useQuery({
    queryKey: [
      'l2-return-erc20-assets',
      returnSourceChain.id,
      walletAddress,
      l1FundingConfig?.chain.id,
      sourceL2BridgeAddress,
      canonicalL1Erc20Tokens.map((token) => token.address.toLowerCase()).join(',')
    ],
    enabled: Boolean(
      walletAddress && l1FundingConfig?.chain.id && sourceL2BridgeAddress && canonicalL1Erc20Tokens.length > 0
    ),
    queryFn: async (): Promise<ResolvedReturnErc20Asset[]> => {
      if (!walletAddress || !l1FundingConfig || !sourceL2BridgeAddress) {
        throw new Error('Return ERC-20 asset context is not ready yet.');
      }

      const sourcePublicClient = composeConfig.getPublicClient(returnSourceChain.id);
      if (!sourcePublicClient) {
        throw new Error(`Source rollup public client is not configured for chain ${returnSourceChain.id}.`);
      }

      const l1PublicClient = composeConfig.getPublicClient(l1FundingConfig.chain.id);
      if (!l1PublicClient) {
        throw new Error(`L1 public client is not configured for chain ${l1FundingConfig.chain.id}.`);
      }
      const l1ChainId = l1FundingConfig.chain.id;

      const cetFactoryAddress = await resolveCetFactoryAddressFromL2Bridge({
        l2PublicClient: sourcePublicClient,
        l2BridgeAddress: sourceL2BridgeAddress
      });

      const resolvedAssets = await Promise.all(
        canonicalL1Erc20Tokens.map(async (canonicalToken) => {
          try {
            const predictedL2TokenAddress = await resolvePredictedCetAddress({
              l2PublicClient: sourcePublicClient,
              cetFactoryAddress,
              remoteAsset: canonicalToken.address,
              remoteChainId: l1ChainId
            });

            const tokenCode = await sourcePublicClient.getCode({ address: predictedL2TokenAddress });
            if (!tokenCode || tokenCode === '0x') {
              return undefined;
            }

            const [sourceBalance, destinationBalance] = await Promise.all([
              sourcePublicClient.readContract({
                address: predictedL2TokenAddress,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [walletAddress]
              }),
              l1PublicClient.readContract({
                address: canonicalToken.address,
                abi: erc20Abi,
                functionName: 'balanceOf',
                args: [walletAddress]
              })
            ]);

            return {
              value: getAssetValue(canonicalToken),
              kind: 'erc20',
              symbol: canonicalToken.symbol,
              decimals: canonicalToken.decimals,
              l1TokenAddress: canonicalToken.address,
              l2TokenAddress: predictedL2TokenAddress,
              sourceBalance,
              destinationBalance
            } satisfies ResolvedReturnErc20Asset;
          } catch {
            return undefined;
          }
        })
      );

      const mappedAssets = resolvedAssets.filter((asset): asset is ResolvedReturnErc20Asset => Boolean(asset));

      mappedAssets.sort((left, right) => {
        const leftHasBalance = left.sourceBalance > 0n;
        const rightHasBalance = right.sourceBalance > 0n;
        if (leftHasBalance !== rightHasBalance) return leftHasBalance ? -1 : 1;
        return left.symbol.localeCompare(right.symbol);
      });

      return mappedAssets;
    }
  });

  const returnNativeBalance = returnNativeBalanceQuery.data;
  const l1NativeBalance = l1NativeBalanceQuery.data;
  const resolvedL2BridgeAddress = sourceL2BridgeAddress;
  const settlementContracts = returnRouteQuery.data?.settlementContracts;

  const nativeReturnAsset = useMemo<ReturnAsset>(
    () => ({
      value: getAssetValue(nativeReturnToken),
      kind: 'nativeEthViaWeth',
      symbol: nativeReturnToken.symbol,
      decimals: nativeReturnToken.decimals,
      sourceBalance: returnNativeBalance,
      destinationBalance: l1NativeBalance
    }),
    [l1NativeBalance, nativeReturnToken, returnNativeBalance]
  );

  const returnAssets = useMemo<ReturnAsset[]>(() => {
    return [nativeReturnAsset, ...(returnErc20AssetsQuery.data ?? [])];
  }, [nativeReturnAsset, returnErc20AssetsQuery.data]);

  useEffect(() => {
    if (returnAssets.length === 0) return;
    if (returnAssets.some((asset) => asset.value === returnTokenValue)) return;
    setReturnTokenValue(returnAssets[0].value);
  }, [returnAssets, returnTokenValue]);

  const selectedReturnToken = useMemo<ReturnAsset>(
    () => returnAssets.find((asset) => asset.value === returnTokenValue) ?? returnAssets[0],
    [returnAssets, returnTokenValue]
  );

  const selectedReturnExecutionAsset = useMemo<ReturnExecutionAsset>(() => {
    if (selectedReturnToken.kind === 'nativeEthViaWeth') {
      return {
        kind: 'nativeEthViaWeth',
        symbol: selectedReturnToken.symbol,
        decimals: selectedReturnToken.decimals
      };
    }

    return {
      kind: 'erc20',
      symbol: selectedReturnToken.symbol,
      decimals: selectedReturnToken.decimals,
      l2TokenAddress: selectedReturnToken.l2TokenAddress,
      l1TokenAddress: selectedReturnToken.l1TokenAddress
    };
  }, [selectedReturnToken]);

  const selectedReturnSourceBalance = selectedReturnToken.sourceBalance;
  const selectedReturnDestinationBalance = selectedReturnToken.destinationBalance;
  const selectedReturnTokenDisplayBalance = formatTokenAmount(selectedReturnSourceBalance, selectedReturnToken.decimals);
  const selectedReturnDestinationDisplayBalance = formatTokenAmount(
    selectedReturnDestinationBalance,
    selectedReturnToken.decimals
  );

  const returnTokenOptions: PickerOption<string>[] = useMemo(
    () =>
      returnAssets.map((asset) => ({
        key: `return-token-${asset.value}`,
        value: asset.value,
        left: asset.symbol,
        right: formatTokenAmount(asset.sourceBalance, asset.decimals)
      })),
    [returnAssets]
  );

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
    selectedAsset: selectedReturnExecutionAsset,
    walletAddress,
    sourceChain: returnSourceChain,
    l1FundingConfig,
    sourceL2BridgeAddress: resolvedL2BridgeAddress,
    settlementContracts,
    availableSourceBalance: selectedReturnSourceBalance,
    ensureWalletOnChain,
    onClearErrors,
    onReturnError,
    onReturnSuccess: () => {
      void returnNativeBalanceQuery.refetch();
      void l1NativeBalanceQuery.refetch();
      void returnErc20AssetsQuery.refetch();
    }
  });

  const parsedReturnAmountWei = useMemo(
    () =>
      parsePositiveAssetAmountInput({
        amountInput: returnAmountInput,
        tokenKind: selectedReturnToken.kind,
        tokenDecimals: selectedReturnToken.decimals
      }),
    [returnAmountInput, selectedReturnToken]
  );

  const hasSufficientReturnBalance =
    selectedReturnSourceBalance === undefined
      ? true
      : parsedReturnAmountWei !== undefined && parsedReturnAmountWei <= selectedReturnSourceBalance;

  const canSubmitReturn =
    isConnected &&
    Boolean(l1FundingConfig) &&
    parsedReturnAmountWei !== undefined &&
    hasSufficientReturnBalance &&
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

  const importReturnToken = useCallback(async () => {
    const importedToken = await importCanonicalL1Token();
    if (!importedToken) return;

    setReturnTokenValue(getAssetValue(importedToken));
    void returnErc20AssetsQuery.refetch();
  }, [importCanonicalL1Token, returnErc20AssetsQuery]);

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
        void returnErc20AssetsQuery.refetch();
      }

      return didFinalize;
    },
    [finalizeReturn, l1NativeBalanceQuery, returnErc20AssetsQuery]
  );

  const resetReturnForm = useCallback(() => {
    setReturnAmountInput('');
  }, []);

  return {
    returnSourceChainId,
    returnAmountInput,
    returnTokenValue,
    returnSourceChain,
    selectedReturnToken,
    selectedReturnSourceBalance,
    selectedReturnDestinationBalance,
    selectedReturnTokenDisplayBalance,
    selectedReturnDestinationDisplayBalance,
    selectedReturnSourceChainLabel,
    selectedReturnDestinationChainLabel,
    selectedReturnSourceChainName,
    selectedReturnDestinationChainName,
    returnSourceOptions,
    returnTokenOptions,
    returnNativeBalance,
    returnNativeBalanceQuery,
    l1NativeBalance,
    l1NativeBalanceQuery,
    returnErc20AssetsQuery,
    resolvedL2BridgeAddress,
    returnRouteQuery,
    settlementContracts,
    executeReturn,
    proveReturn: handleProve,
    finalizeReturn: handleFinalize,
    isReturnSubmitting,
    returnPhase,
    clearReturnPhase,
    returnResults,
    canSubmitReturn,
    returnImportTokenAddressInput,
    returnImportTokenError,
    isImportingReturnToken,
    setReturnSourceChainId,
    setReturnAmountInput,
    setReturnTokenValue,
    setReturnImportTokenAddressInput,
    importReturnToken,
    resetReturnForm
  };
}
