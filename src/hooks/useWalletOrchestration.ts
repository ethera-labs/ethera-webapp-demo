import { useQueryClient } from '@tanstack/react-query';
import { getWalletClient } from '@wagmi/core';
import { useCallback, useMemo } from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { wagmiConfig } from '../composeConfig';
import { getPreferredConnector, normalizeWalletErrorMessage } from '../lib/wallet';

// Wallet lifecycle helper: connect/disconnect, chain sync, and wagmi cache cleanup.
type UseWalletOrchestrationParams = {
  supportedChainIds: Set<number>;
  onWalletError: (message: string) => void;
};

const WALLET_CHAIN_SYNC_TIMEOUT_MS = 12_000;
const WALLET_CHAIN_SYNC_POLL_MS = 250;

/**
 * Encapsulates wallet behavior so UI components can consume a stable interface.
 */
export function useWalletOrchestration({
  supportedChainIds,
  onWalletError
}: UseWalletOrchestrationParams) {
  const queryClient = useQueryClient();

  const { address: walletAddress, isConnected, chainId: walletChainId } = useAccount();
  const { connectAsync, connectors, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnectAsync } = useDisconnect();
  const { switchChainAsync, isPending: isSwitchingChain } = useSwitchChain();

  const normalizedConnectError = connectError ? normalizeWalletErrorMessage(connectError.message) : null;
  const isWalletOnSupportedChain = walletChainId ? supportedChainIds.has(walletChainId) : false;

  const connectWallet = useCallback(async () => {
    if (isConnected) return;

    const preferredConnector = getPreferredConnector(connectors);

    if (!preferredConnector) {
      onWalletError('No wallet connector available. Install MetaMask or another injected wallet.');
      return;
    }

    try {
      await connectAsync({ connector: preferredConnector });
    } catch (connectExecutionError) {
      const message =
        connectExecutionError instanceof Error ? connectExecutionError.message.toLowerCase() : 'unknown wallet error';

      if (message.includes('connector already connected')) {
        try {
          await disconnectAsync({ connector: preferredConnector });
          await connectAsync({ connector: preferredConnector });
          return;
        } catch (retryError) {
          const retryMessage = retryError instanceof Error ? normalizeWalletErrorMessage(retryError.message) : null;
          if (retryMessage) onWalletError(retryMessage);
          return;
        }
      }

      const normalizedMessage =
        connectExecutionError instanceof Error ? normalizeWalletErrorMessage(connectExecutionError.message) : null;
      if (normalizedMessage) onWalletError(normalizedMessage);
    }
  }, [connectAsync, connectors, disconnectAsync, isConnected, onWalletError]);

  const switchWalletToChain = useCallback(
    async (targetChainId: number) => {
      try {
        await switchChainAsync({ chainId: targetChainId });
      } catch (switchError) {
        const normalizedMessage = switchError instanceof Error ? normalizeWalletErrorMessage(switchError.message) : null;
        if (normalizedMessage) {
          onWalletError(`Connected, but could not switch network automatically. ${normalizedMessage}`);
        }
      }
    },
    [onWalletError, switchChainAsync]
  );

  const waitForWalletChain = useCallback(async (targetChainId: number) => {
    const startedAt = Date.now();

    while (Date.now() - startedAt < WALLET_CHAIN_SYNC_TIMEOUT_MS) {
      try {
        const walletClient = await getWalletClient(wagmiConfig);
        if (walletClient) {
          const activeChainId = await walletClient.getChainId();
          if (activeChainId === targetChainId) return walletClient;
        }
      } catch {
        // Wagmi can briefly report connector/connection chain mismatch while wallet state is converging.
      }

      await new Promise((resolve) => setTimeout(resolve, WALLET_CHAIN_SYNC_POLL_MS));
    }

    throw new Error(`Wallet did not switch to chain ${targetChainId} in time. Please switch network in MetaMask and retry.`);
  }, []);

  const ensureWalletOnChain = useCallback(
    async (targetChainId: number) => {
      try {
        const currentWalletClient = await getWalletClient(wagmiConfig);
        if (currentWalletClient) {
          const activeChainId = await currentWalletClient.getChainId();
          if (activeChainId === targetChainId) return currentWalletClient;
        }
      } catch {
        // Ignore and attempt explicit chain switch below.
      }

      try {
        await switchChainAsync({ chainId: targetChainId });
      } catch {
        // Some connectors report temporary chain mismatch while wallet state is still settling.
      }

      return waitForWalletChain(targetChainId);
    },
    [switchChainAsync, waitForWalletChain]
  );

  const disconnectWallet = useCallback(async () => {
    try {
      await disconnectAsync();
    } catch (disconnectError) {
      const normalizedMessage = disconnectError instanceof Error ? normalizeWalletErrorMessage(disconnectError.message) : null;
      if (normalizedMessage) onWalletError(normalizedMessage);
    }

    queryClient.removeQueries({ queryKey: ['smart-account'] });
    queryClient.removeQueries({ queryKey: ['source-token-balances'] });
    queryClient.removeQueries({ queryKey: ['destination-balance'] });
    queryClient.removeQueries({ queryKey: ['l1-native-balance'] });
  }, [disconnectAsync, onWalletError, queryClient]);

  return useMemo(
    () => ({
      walletAddress,
      walletChainId,
      isConnected,
      isConnecting,
      isSwitchingChain,
      isWalletOnSupportedChain,
      normalizedConnectError,
      connectWallet,
      disconnectWallet,
      switchWalletToChain,
      ensureWalletOnChain
    }),
    [
      connectWallet,
      disconnectWallet,
      ensureWalletOnChain,
      isConnected,
      isConnecting,
      isSwitchingChain,
      isWalletOnSupportedChain,
      normalizedConnectError,
      switchWalletToChain,
      walletAddress,
      walletChainId
    ]
  );
}
