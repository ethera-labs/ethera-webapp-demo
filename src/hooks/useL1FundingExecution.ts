import { useCallback, useState } from 'react';
import { erc20Abi, parseEther, parseUnits, type Chain } from 'viem';
import { getL2TransactionHashes } from 'viem/op-stack';
import { composeConfig, type DemoToken, type L1FundingConfig } from '../composeConfig';
import { normalizeExecutionErrorMessage } from '../lib/errors';
import { formatChainLabel } from '../lib/format';
import {
  l1StandardBridgeAbi,
  resolveCetFactoryAddressFromL2Bridge,
  resolveL2BridgeAddressFromL1Bridge,
  resolvePredictedCetAddress
} from '../lib/l1Bridge';
import type { FundingResult } from '../types/funding';

// Handles L1 -> rollup funding transaction lifecycle and history.
type WalletClientLike = {
  writeContract: (...args: unknown[]) => Promise<`0x${string}`>;
  getChainId: () => Promise<number>;
};

type UseL1FundingExecutionParams = {
  amountInput: string;
  selectedToken: DemoToken;
  walletAddress: `0x${string}` | undefined;
  destinationChain: Chain;
  l1FundingConfig: L1FundingConfig | undefined;
  availableSourceBalance: bigint | undefined;
  ensureWalletOnChain: (targetChainId: number) => Promise<unknown>;
  onClearErrors: () => void;
  onFundingError: (message: string) => void;
  onFundingSuccess: () => void;
};

const MAX_FUNDING_HISTORY = 12;

type FundingResultContext = Omit<FundingResult, 'status' | 'destinationTxStatus'>;

/**
 * Builds a funding result from shared context plus lifecycle statuses.
 */
const buildFundingResult = ({
  context,
  status,
  destinationTxStatus
}: {
  context: FundingResultContext;
  status: FundingResult['status'];
  destinationTxStatus?: FundingResult['destinationTxStatus'];
}): FundingResult => ({
  ...context,
  status,
  ...(destinationTxStatus ? { destinationTxStatus } : {})
});

const fundingResultToContext = (result: FundingResult): FundingResultContext => ({
  hash: result.hash,
  explorerUrl: result.explorerUrl,
  destinationTxHash: result.destinationTxHash,
  destinationTxExplorerUrl: result.destinationTxExplorerUrl,
  destinationTokenAddress: result.destinationTokenAddress,
  destinationTokenExplorerUrl: result.destinationTokenExplorerUrl,
  sourceChainLabel: result.sourceChainLabel,
  destinationChainLabel: result.destinationChainLabel,
  recipient: result.recipient,
  amountWei: result.amountWei,
  tokenSymbol: result.tokenSymbol,
  tokenDecimals: result.tokenDecimals,
  sessionId: result.sessionId
});

/**
 * Executes L1 bridge funding and exposes submission/phase/result state for UI consumption.
 */
export function useL1FundingExecution({
  amountInput,
  selectedToken,
  walletAddress,
  destinationChain,
  l1FundingConfig,
  availableSourceBalance,
  ensureWalletOnChain,
  onClearErrors,
  onFundingError,
  onFundingSuccess
}: UseL1FundingExecutionParams) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [phase, setPhase] = useState<string | null>(null);
  const [results, setResults] = useState<FundingResult[]>([]);

  const clearPhase = useCallback(() => {
    setPhase(null);
  }, []);

  const upsertResult = useCallback((sessionId: bigint, build: (existing?: FundingResult) => FundingResult) => {
    setResults((previous) => {
      const index = previous.findIndex((item) => item.sessionId === sessionId);

      if (index === -1) {
        return [build(undefined), ...previous].slice(0, MAX_FUNDING_HISTORY);
      }

      const next = [...previous];
      next[index] = build(next[index]);
      return next;
    });
  }, []);

  const executeFunding = useCallback(async () => {
    onClearErrors();

    if (!l1FundingConfig) {
      onFundingError('L1 funding is not configured for this environment.');
      return;
    }

    if (!walletAddress) {
      onFundingError('Connected wallet address is unavailable. Reconnect wallet and retry.');
      return;
    }

    if (!amountInput.trim()) {
      onFundingError(`Enter a ${selectedToken.symbol} amount.`);
      return;
    }

    const bridgeContract = l1FundingConfig.bridgeByDestinationChainId[destinationChain.id];
    if (!bridgeContract) {
      onFundingError(`L1 bridge contract is not configured for destination chain ${destinationChain.id}.`);
      return;
    }

    let amountWei: bigint;
    try {
      amountWei =
        selectedToken.kind === 'nativeEthViaWeth'
          ? parseEther(amountInput)
          : parseUnits(amountInput, selectedToken.decimals);
    } catch {
      onFundingError(`Invalid ${selectedToken.symbol} amount.`);
      return;
    }

    if (amountWei <= 0n) {
      onFundingError('Amount must be greater than zero.');
      return;
    }

    if (availableSourceBalance !== undefined && amountWei > availableSourceBalance) {
      onFundingError(`Amount exceeds available ${selectedToken.symbol} balance on the source L1 chain.`);
      return;
    }

    const sessionId = BigInt(Date.now());
    const sourceChainLabel = formatChainLabel(l1FundingConfig.chain.name, l1FundingConfig.chain.id);
    const destinationChainLabel = formatChainLabel(destinationChain.name, destinationChain.id);

    let submittedHash: `0x${string}` | null = null;
    let explorerUrl = '';
    let destinationTxHash: `0x${string}` | undefined;
    let destinationTxExplorerUrl: string | undefined;
    let destinationTokenAddress: `0x${string}` | undefined;
    let destinationTokenExplorerUrl: string | undefined;

    const buildResultContext = (): FundingResultContext => ({
      hash: submittedHash!,
      explorerUrl,
      destinationTxHash,
      destinationTxExplorerUrl,
      destinationTokenAddress,
      destinationTokenExplorerUrl,
      sourceChainLabel,
      destinationChainLabel,
      recipient: walletAddress,
      amountWei,
      tokenSymbol: selectedToken.symbol,
      tokenDecimals: selectedToken.decimals,
      sessionId
    });

    const resolveResultContext = (existing?: FundingResult): FundingResultContext => ({
      ...(existing ? fundingResultToContext(existing) : {}),
      ...buildResultContext()
    });

    try {
      setIsSubmitting(true);
      setPhase(`Switching wallet to ${l1FundingConfig.chain.name}...`);

      const walletClient = (await ensureWalletOnChain(l1FundingConfig.chain.id)) as WalletClientLike;
      const activeChainId = await walletClient.getChainId();
      if (activeChainId !== l1FundingConfig.chain.id) {
        throw new Error(
          `Wallet chain mismatch after switch. Active: ${activeChainId}, expected: ${l1FundingConfig.chain.id}.`
        );
      }

      const l1PublicClient = composeConfig.getPublicClient(l1FundingConfig.chain.id);
      if (!l1PublicClient) {
        throw new Error(`Could not resolve L1 public client for chain ${l1FundingConfig.chain.id}.`);
      }

      if (selectedToken.kind === 'nativeEthViaWeth') {
        setPhase('Submitting L1 ETH bridge transaction...');
        submittedHash = await walletClient.writeContract({
          address: bridgeContract,
          abi: l1StandardBridgeAbi,
          functionName: 'bridgeETHTo',
          args: [walletAddress, l1FundingConfig.minGasLimit, '0x'],
          value: amountWei
        });
      } else {
        setPhase(`Checking ${selectedToken.symbol} allowance...`);
        const allowance = await l1PublicClient.readContract({
          address: selectedToken.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [walletAddress, bridgeContract]
        });

        if (allowance < amountWei) {
          setPhase(`Approving ${selectedToken.symbol} for bridge...`);
          const approvalHash = await walletClient.writeContract({
            address: selectedToken.address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [bridgeContract, amountWei]
          });

          await l1PublicClient.waitForTransactionReceipt({ hash: approvalHash });
        }

        setPhase('Resolving destination CET route...');
        const destinationPublicClient = composeConfig.getPublicClient(destinationChain.id);
        if (!destinationPublicClient) {
          throw new Error(`Could not resolve destination public client for chain ${destinationChain.id}.`);
        }

        const destinationL2BridgeAddress = await resolveL2BridgeAddressFromL1Bridge({
          l1PublicClient,
          l1BridgeAddress: bridgeContract
        });
        const destinationCetFactoryAddress = await resolveCetFactoryAddressFromL2Bridge({
          l2PublicClient: destinationPublicClient,
          l2BridgeAddress: destinationL2BridgeAddress
        });
        const predictedCetAddress = await resolvePredictedCetAddress({
          l2PublicClient: destinationPublicClient,
          cetFactoryAddress: destinationCetFactoryAddress,
          remoteAsset: selectedToken.address,
          remoteChainId: l1FundingConfig.chain.id
        });
        destinationTokenAddress = predictedCetAddress;

        const destinationExplorerBaseUrl = destinationChain.blockExplorers?.default?.url;
        destinationTokenExplorerUrl = destinationExplorerBaseUrl
          ? new URL(`token/${predictedCetAddress}`, destinationExplorerBaseUrl).toString()
          : undefined;

        setPhase(`Submitting L1 ${selectedToken.symbol} bridge transaction...`);
        submittedHash = await walletClient.writeContract({
          address: bridgeContract,
          abi: l1StandardBridgeAbi,
          functionName: 'bridgeERC20To',
          args: [
            selectedToken.address,
            predictedCetAddress,
            walletAddress,
            amountWei,
            l1FundingConfig.minGasLimit,
            '0x'
          ]
        });
      }

      const explorerBaseUrl = l1FundingConfig.chain.blockExplorers?.default?.url;
      explorerUrl = explorerBaseUrl ? new URL(`tx/${submittedHash}`, explorerBaseUrl).toString() : '';

      upsertResult(sessionId, () =>
        buildFundingResult({
          context: resolveResultContext(),
          status: 'pending'
        })
      );

      setPhase('Waiting for L1 confirmation...');
      const receipt = await l1PublicClient.waitForTransactionReceipt({ hash: submittedHash });
      const status = receipt.status === 'success' ? 'success' : 'failed';

      const [derivedDestinationTxHash] = getL2TransactionHashes({ logs: receipt.logs });
      const destinationExplorerBaseUrl = destinationChain.blockExplorers?.default?.url;
      destinationTxHash = derivedDestinationTxHash;
      destinationTxExplorerUrl =
        destinationExplorerBaseUrl && destinationTxHash
          ? new URL(`tx/${destinationTxHash}`, destinationExplorerBaseUrl).toString()
          : undefined;

      upsertResult(sessionId, (existing) =>
        buildFundingResult({
          context: resolveResultContext(existing),
          status,
          destinationTxStatus: status === 'success' && destinationTxHash ? 'pending' : undefined
        })
      );

      if (status === 'failed') {
        onFundingError('L1 bridge transaction reverted. Please retry.');
        return;
      }

      if (destinationTxHash) {
        const destinationPublicClient = composeConfig.getPublicClient(destinationChain.id);
        if (destinationPublicClient) {
          void destinationPublicClient
            .waitForTransactionReceipt({ hash: destinationTxHash })
            .then((destinationReceipt) => {
              const destinationTxStatus = destinationReceipt.status === 'success' ? 'success' : 'failed';

              upsertResult(sessionId, (existing) => {
                return buildFundingResult({
                  context: resolveResultContext(existing),
                  status: existing?.status ?? status,
                  destinationTxStatus
                });
              });
            })
            .catch((destinationReceiptError) => {
              console.error('Could not resolve destination rollup transaction receipt', destinationReceiptError);
            });
        }
      }

      onFundingSuccess();
    } catch (executionError) {
      const rawMessage = executionError instanceof Error ? executionError.message : 'Unknown funding error.';
      const normalizedMessage = normalizeExecutionErrorMessage(rawMessage);

      if (submittedHash) {
        upsertResult(sessionId, (existing) =>
          buildFundingResult({
            context: resolveResultContext(existing),
            status: 'failed',
            destinationTxStatus: existing?.destinationTxStatus
          })
        );
      }

      onFundingError(normalizedMessage);
      console.error('L1 funding failed', executionError);
    } finally {
      setPhase(null);
      setIsSubmitting(false);
    }
  }, [
    amountInput,
    availableSourceBalance,
    destinationChain,
    ensureWalletOnChain,
    l1FundingConfig,
    onClearErrors,
    onFundingError,
    onFundingSuccess,
    selectedToken,
    upsertResult,
    walletAddress
  ]);

  return {
    executeFunding,
    isSubmitting,
    phase,
    clearPhase,
    results
  };
}
