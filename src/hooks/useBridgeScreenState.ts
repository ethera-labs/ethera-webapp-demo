import { useQuery } from '@tanstack/react-query';
import { useSmartAccount } from '@ssv-labs/ethera-sdk/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { erc20Abi } from 'viem';
import { chainA, chainB, composeConfig, demoTokens, networkProfile, universalContracts, type DemoToken } from '../composeConfig';
import { dedupeErc20TokensByAddress, getAssetValue } from '../lib/assets';
import { formatChainLabel, formatTokenAmount } from '../lib/format';
import { readImportedTokens, resolveImportedTokenMetadata, upsertImportedToken } from '../lib/importedTokens';
import { resolveDestinationPayoutTokenAddress, resolveSourceTokenBridgeMode } from './bridgeExecution';
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
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

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
  const [importedTokens, setImportedTokens] = useState<DemoToken[]>([]);

  const entryPointAddress = composeConfig.entryPoint.address as `0x${string}`;
  const universalBridgeAddress = universalContracts?.l2ToL2Bridge;

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

  useEffect(() => {
    if (!walletAddress) {
      setImportedTokens([]);
      return;
    }

    const storedTokens = readImportedTokens({
      networkMode: networkProfile.mode,
      chainId: sourceChain.id,
      walletAddress
    }).map((token) => ({
      ...token,
      kind: 'erc20' as const
    }));

    setImportedTokens(storedTokens);
  }, [sourceChain.id, walletAddress]);

  const bridgeTokens = useMemo(() => {
    const dedupedErc20Tokens = dedupeErc20TokensByAddress([...curatedErc20BridgeTokens, ...importedTokens]);
    return [nativeBridgeToken, ...dedupedErc20Tokens];
  }, [curatedErc20BridgeTokens, importedTokens, nativeBridgeToken]);

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
        return smart.publicClient.readContract({
          address: selectedToken.address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [eoaAddress]
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

      return smart.publicClient.readContract({
        address: destinationPayoutTokenAddress,
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
      : sourceTokenBalances?.[selectedToken.address.toLowerCase()]
    : undefined;
  const selectedTokenDisplayBalance = selectedToken ? formatTokenAmount(sourceBalance, selectedToken.decimals) : '...';
  const selectedTokenHasBalance = sourceBalance === undefined ? true : sourceBalance > 0n;
  const noBalanceTooltip = selectedToken
    ? `No ${selectedToken.symbol} available on source chain (EOA + smart account).`
    : undefined;

  const importBridgeToken = useCallback(async () => {
    if (!walletAddress) {
      setImportTokenError('Connect a wallet before importing tokens.');
      return undefined;
    }

    const candidateAddress = importTokenAddressInput.trim();
    if (!candidateAddress) {
      setImportTokenError('Enter a token address to import.');
      return undefined;
    }

    const sourcePublicClient = composeConfig.getPublicClient(sourceChain.id);
    if (!sourcePublicClient) {
      setImportTokenError(`Source rollup public client is not configured for chain ${sourceChain.id}.`);
      return undefined;
    }

    try {
      setIsImportingToken(true);
      setImportTokenError(null);

      const token = await resolveImportedTokenMetadata({
        publicClient: sourcePublicClient,
        tokenAddress: candidateAddress
      });

      const nextImportedTokens = upsertImportedToken({
        networkMode: networkProfile.mode,
        chainId: sourceChain.id,
        walletAddress,
        token
      }).map((item) => ({
        ...item,
        kind: 'erc20' as const
      }));

      const importedToken: DemoToken = {
        ...token,
        kind: 'erc20'
      };

      setImportedTokens(nextImportedTokens);
      setImportTokenAddressInput('');
      setSelectedTokenValue(getAssetValue(importedToken));
      void sourceTokenBalancesQuery.refetch();
      void destinationBalanceQuery.refetch();

      return importedToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not import token from address.';
      setImportTokenError(message);
      return undefined;
    } finally {
      setIsImportingToken(false);
    }
  }, [
    destinationBalanceQuery,
    importTokenAddressInput,
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
