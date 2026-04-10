import { useCallback, useState } from 'react';
import { parseEther, type Chain } from 'viem';
import { composeConfig, type L1FundingConfig } from '../composeConfig';
import { normalizeExecutionErrorMessage } from '../lib/errors';
import { formatChainLabel } from '../lib/format';
import { l1StandardBridgeAbi } from '../lib/l1Bridge';
import type { FundingResult } from '../types/funding';

// Handles L1 -> rollup native funding transaction lifecycle and history.
type WalletClientLike = {
  writeContract: (...args: unknown[]) => Promise<`0x${string}`>;
  getChainId: () => Promise<number>;
};

type UseL1FundingExecutionParams = {
  amountInput: string;
  walletAddress: `0x${string}` | undefined;
  destinationChain: Chain;
  l1FundingConfig: L1FundingConfig | undefined;
  availableL1Balance: bigint | undefined;
  ensureWalletOnChain: (targetChainId: number) => Promise<unknown>;
  onClearErrors: () => void;
  onFundingError: (message: string) => void;
  onFundingSuccess: () => void;
};

const MAX_FUNDING_HISTORY = 12;

/**
 * Executes L1 bridge funding and exposes submission/phase/result state for UI consumption.
 */
export function useL1FundingExecution({
  amountInput,
  walletAddress,
  destinationChain,
  l1FundingConfig,
  availableL1Balance,
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
      onFundingError('Enter an ETH amount.');
      return;
    }

    const bridgeContract = l1FundingConfig.bridgeByDestinationChainId[destinationChain.id];
    if (!bridgeContract) {
      onFundingError(`L1 bridge contract is not configured for destination chain ${destinationChain.id}.`);
      return;
    }

    let amountWei: bigint;
    try {
      amountWei = parseEther(amountInput);
    } catch {
      onFundingError('Invalid ETH amount.');
      return;
    }

    if (amountWei <= 0n) {
      onFundingError('Amount must be greater than zero.');
      return;
    }

    if (availableL1Balance !== undefined && amountWei > availableL1Balance) {
      onFundingError('Amount exceeds available ETH balance on the source L1 chain.');
      return;
    }

    const sessionId = BigInt(Date.now());
    const sourceChainLabel = formatChainLabel(l1FundingConfig.chain.name, l1FundingConfig.chain.id);
    const destinationChainLabel = formatChainLabel(destinationChain.name, destinationChain.id);

    let submittedHash: `0x${string}` | null = null;
    let explorerUrl = '';

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

      setPhase('Submitting L1 bridge transaction...');
      submittedHash = await walletClient.writeContract({
        address: bridgeContract,
        abi: l1StandardBridgeAbi,
        functionName: 'bridgeETHTo',
        args: [walletAddress, l1FundingConfig.minGasLimit, '0x'],
        value: amountWei
      });
      const explorerBaseUrl = l1FundingConfig.chain.blockExplorers?.default?.url;
      explorerUrl = explorerBaseUrl ? new URL(`tx/${submittedHash}`, explorerBaseUrl).toString() : '';

      upsertResult(sessionId, () => ({
        hash: submittedHash!,
        explorerUrl,
        sourceChainLabel,
        destinationChainLabel,
        recipient: walletAddress,
        amountWei,
        status: 'pending',
        sessionId
      }));

      const l1PublicClient = composeConfig.getPublicClient(l1FundingConfig.chain.id);
      if (!l1PublicClient) {
        throw new Error(`Could not resolve L1 public client for chain ${l1FundingConfig.chain.id}.`);
      }

      setPhase('Waiting for L1 confirmation...');
      const receipt = await l1PublicClient.waitForTransactionReceipt({ hash: submittedHash });
      const status = receipt.status === 'success' ? 'success' : 'failed';

      upsertResult(sessionId, (existing) => ({
        ...(existing ?? {
          hash: submittedHash!,
          explorerUrl,
          sourceChainLabel,
          destinationChainLabel,
          recipient: walletAddress,
          amountWei,
          sessionId
        }),
        status
      }));

      if (status === 'failed') {
        onFundingError('L1 bridge transaction reverted. Please retry.');
        return;
      }

      onFundingSuccess();
    } catch (executionError) {
      const rawMessage = executionError instanceof Error ? executionError.message : 'Unknown funding error.';
      const normalizedMessage = normalizeExecutionErrorMessage(rawMessage);

      if (submittedHash) {
        upsertResult(sessionId, (existing) => ({
          ...(existing ?? {
            hash: submittedHash!,
            explorerUrl,
            sourceChainLabel,
            destinationChainLabel,
            recipient: walletAddress,
            amountWei,
            sessionId
          }),
          status: 'failed'
        }));
      }

      onFundingError(normalizedMessage);
      console.error('L1 funding failed', executionError);
    } finally {
      setPhase(null);
      setIsSubmitting(false);
    }
  }, [
    amountInput,
    availableL1Balance,
    destinationChain,
    ensureWalletOnChain,
    l1FundingConfig,
    onClearErrors,
    onFundingError,
    onFundingSuccess,
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
