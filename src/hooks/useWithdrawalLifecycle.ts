import { useQuery } from '@tanstack/react-query';
import { getWithdrawals } from 'viem/op-stack';
import { composeConfig, l1FundingConfig } from '../composeConfig';
import { getComposeWithdrawalStatus } from '../lib/composeSettlement';
import type { ReturnResult, WithdrawalLifecycleStatus } from '../types/funding';

type WithdrawalLifecycleData = {
  status: WithdrawalLifecycleStatus;
  timeToProveSeconds?: number;
};

type UseWithdrawalLifecycleParams = {
  result: ReturnResult;
};

const STATUS_POLL_INTERVAL_MS = 8_000;

/**
 * Tracks withdrawal lifecycle state on L1 for a submitted rollup withdrawal.
 */
export function useWithdrawalLifecycle({ result }: UseWithdrawalLifecycleParams) {
  const isTrackable =
    Boolean(l1FundingConfig) &&
    result.status === 'success' &&
    result.lifecycleStatus !== 'proving' &&
    result.lifecycleStatus !== 'finalizing' &&
    result.lifecycleStatus !== 'finalized';

  return useQuery<WithdrawalLifecycleData>({
    queryKey: [
      'withdrawal-lifecycle',
      result.hash,
      result.sourceChainId,
      result.settlementContracts.l1PortalAddress,
      result.settlementContracts.l1DisputeGameFactoryAddress,
      result.lifecycleStatus
    ],
    enabled: isTrackable,
    queryFn: async () => {
      const l1Chain = l1FundingConfig?.chain;
      if (!l1Chain) {
        throw new Error('L1 funding is not configured.');
      }

      const l1PublicClient = composeConfig.getPublicClient(l1Chain.id);
      if (!l1PublicClient) {
        throw new Error(`L1 public client is not configured for chain ${l1Chain.id}.`);
      }

      const sourcePublicClient = composeConfig.getPublicClient(result.sourceChainId);
      if (!sourcePublicClient) {
        throw new Error(`Rollup public client is not configured for chain ${result.sourceChainId}.`);
      }

      const receipt = await sourcePublicClient.getTransactionReceipt({ hash: result.hash });
      const [withdrawal] = getWithdrawals(receipt);
      if (!withdrawal) {
        throw new Error(`No withdrawal log found in source transaction ${result.hash}.`);
      }

      const { status } = await getComposeWithdrawalStatus({
        l1PublicClient,
        portalAddress: result.settlementContracts.l1PortalAddress,
        disputeGameFactoryAddress: result.settlementContracts.l1DisputeGameFactoryAddress,
        sourceChainId: result.sourceChainId,
        withdrawal,
        withdrawalL2BlockNumber: receipt.blockNumber
      });

      const data: WithdrawalLifecycleData = { status };

      return data;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status) return STATUS_POLL_INTERVAL_MS;
      if (status === 'finalized') return false;
      return STATUS_POLL_INTERVAL_MS;
    },
    refetchIntervalInBackground: true
  });
}
