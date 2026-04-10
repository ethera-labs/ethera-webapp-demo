type StatusTone = 'warning' | 'success' | 'error';

export type TransactionLifecycleStatus = 'pending' | 'success' | 'failed';

export const getStatusTag = (
  status: TransactionLifecycleStatus
): { label: string; tone: StatusTone } => {
  if (status === 'pending') return { label: 'In progress', tone: 'warning' };
  if (status === 'success') return { label: 'Completed', tone: 'success' };
  return { label: 'Failed', tone: 'error' };
};

export const getAggregatedStatusTag = (
  statuses: readonly TransactionLifecycleStatus[]
): { label: string; tone: StatusTone } => {
  if (statuses.some((status) => status === 'pending')) return getStatusTag('pending');
  if (statuses.every((status) => status === 'success')) return getStatusTag('success');
  return getStatusTag('failed');
};

export const formatRunTimestamp = (sessionId: bigint): string => {
  const epochMs = Number(sessionId);
  if (!Number.isFinite(epochMs)) return 'Unknown time';

  return new Date(epochMs).toLocaleString(undefined, {
    hour12: false,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};
