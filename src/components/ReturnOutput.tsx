import { formatEther } from 'viem';
import type { ReturnResult, WithdrawalLifecycleStatus } from '../types/funding';
import { useWithdrawalLifecycle } from '../hooks/useWithdrawalLifecycle';
import { TransactionHistorySection } from './transactionOutput.shared';
import { formatRunTimestamp } from './transactionOutput.utils';

type ReturnOutputProps = {
  results: ReturnResult[];
  onProve: (sessionId: bigint) => Promise<boolean>;
  onFinalize: (sessionId: bigint) => Promise<boolean>;
};

type LifecycleTag = {
  label: string;
  tone: 'warning' | 'success' | 'error';
};

const lifecycleTagByStatus: Record<WithdrawalLifecycleStatus, LifecycleTag> = {
  'waiting-to-prove': { label: 'Waiting to prove', tone: 'warning' },
  'ready-to-prove': { label: 'Ready to prove', tone: 'warning' },
  proving: { label: 'Proving on L1', tone: 'warning' },
  'waiting-to-finalize': { label: 'Waiting to finalize', tone: 'warning' },
  'ready-to-finalize': { label: 'Ready to finalize', tone: 'warning' },
  finalizing: { label: 'Finalizing on L1', tone: 'warning' },
  finalized: { label: 'Finalized on L1', tone: 'success' }
};

const formatSecondsLabel = (seconds: number) => {
  if (!Number.isFinite(seconds)) return null;

  const normalized = Math.max(0, Math.ceil(seconds));
  if (normalized < 60) return `${normalized}s`;

  const minutes = Math.floor(normalized / 60);
  const remainder = normalized % 60;
  if (minutes < 60) return `${minutes}m ${remainder}s`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
};

const ReturnCard = ({
  result,
  onProve,
  onFinalize
}: {
  result: ReturnResult;
  onProve: (sessionId: bigint) => Promise<boolean>;
  onFinalize: (sessionId: bigint) => Promise<boolean>;
}) => {
  const lifecycleQuery = useWithdrawalLifecycle({ result });
  const observedStatus = lifecycleQuery.data?.status;

  const lifecycleStatus: WithdrawalLifecycleStatus =
    result.lifecycleStatus === 'proving' || result.lifecycleStatus === 'finalizing' || result.lifecycleStatus === 'finalized'
      ? result.lifecycleStatus
      : observedStatus ?? result.lifecycleStatus;

  const lifecycleTag = lifecycleTagByStatus[lifecycleStatus];
  const isInitialPending = result.status === 'pending';
  const isInitialFailed = result.status === 'failed';
  const canProve = lifecycleStatus === 'ready-to-prove' && !isInitialPending && !isInitialFailed;
  const canFinalize = lifecycleStatus === 'ready-to-finalize' && !isInitialPending && !isInitialFailed;
  const formattedTimeToProve =
    typeof lifecycleQuery.data?.timeToProveSeconds === 'number'
      ? formatSecondsLabel(lifecycleQuery.data.timeToProveSeconds)
      : null;

  return (
    <div className="transactions-card" key={result.sessionId.toString()}>
      <div className="transactions-card-header">
        <div className="transactions-card-meta">
          <span className="transactions-card-time">{formatRunTimestamp(result.sessionId)}</span>
        </div>
        <div className="receipt-status-tags">
          <span className={`receipt-status-tag receipt-status-tag-${lifecycleTag.tone}`}>{lifecycleTag.label}</span>
        </div>
      </div>

      {isInitialPending ? <p className="hint tx-progress-note">Waiting for rollup confirmation.</p> : null}
      {isInitialFailed ? <p className="hint tx-progress-note">Rollup initiation failed.</p> : null}

      {!isInitialPending && !isInitialFailed && lifecycleStatus === 'waiting-to-prove' ? (
        <p className="hint tx-progress-note">
          Waiting until proof becomes available on L1
          {formattedTimeToProve ? ` (~${formattedTimeToProve}).` : '.'}
        </p>
      ) : null}

      {!isInitialPending && !isInitialFailed && lifecycleStatus === 'waiting-to-finalize' ? (
        <p className="hint tx-progress-note">Proof accepted. Waiting until withdrawal is ready to finalize.</p>
      ) : null}

      {!isInitialPending && !isInitialFailed && lifecycleStatus === 'proving' ? (
        <p className="hint tx-progress-note">Submitting prove transaction on L1...</p>
      ) : null}

      {!isInitialPending && !isInitialFailed && lifecycleStatus === 'finalizing' ? (
        <p className="hint tx-progress-note">Submitting finalize transaction on L1...</p>
      ) : null}

      {!isInitialPending && !isInitialFailed && lifecycleQuery.isError ? (
        <p className="hint hint-warning">Could not refresh withdrawal status automatically.</p>
      ) : null}

      <div className="tx-list">
        <div className="tx-item">
          <span className="tx-label">Route</span>
          <span className="mono tx-hash">
            {result.sourceChainLabel}
            {' -> '}
            {result.destinationChainLabel}
          </span>
        </div>
        <div className="tx-item">
          <span className="tx-label">Amount</span>
          <span className="mono tx-hash">{formatEther(result.amountWei)} ETH</span>
        </div>
        <div className="tx-item">
          <span className="tx-label">Recipient</span>
          <span className="mono tx-hash">{result.recipient}</span>
        </div>
        <div className="tx-item">
          <span className="tx-label">Rollup Tx</span>
          {result.explorerUrl ? (
            <a href={result.explorerUrl} target="_blank" rel="noreferrer" className="mono tx-hash" title={result.hash}>
              {result.hash}
            </a>
          ) : (
            <span className="mono tx-hash">{result.hash}</span>
          )}
        </div>
        {result.proveTxHash ? (
          <div className="tx-item">
            <span className="tx-label">Prove Tx</span>
            {result.proveTxExplorerUrl ? (
              <a
                href={result.proveTxExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="mono tx-hash"
                title={result.proveTxHash}
              >
                {result.proveTxHash}
              </a>
            ) : (
              <span className="mono tx-hash">{result.proveTxHash}</span>
            )}
          </div>
        ) : null}
        {result.finalizeTxHash ? (
          <div className="tx-item">
            <span className="tx-label">Finalize Tx</span>
            {result.finalizeTxExplorerUrl ? (
              <a
                href={result.finalizeTxExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="mono tx-hash"
                title={result.finalizeTxHash}
              >
                {result.finalizeTxHash}
              </a>
            ) : (
              <span className="mono tx-hash">{result.finalizeTxHash}</span>
            )}
          </div>
        ) : null}
      </div>

      {!isInitialPending && !isInitialFailed ? (
        <div className="return-actions">
          {canProve ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void onProve(result.sessionId);
              }}
            >
              Prove on L1
            </button>
          ) : null}
          {canFinalize ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void onFinalize(result.sessionId);
              }}
            >
              Finalize on L1
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export function ReturnOutput({ results, onProve, onFinalize }: ReturnOutputProps) {
  return (
    <TransactionHistorySection
      title="Return Transactions"
      emptyMessage="Submit a return transaction, then prove and finalize it on L1."
      archiveSummaryLabel="Show previous return transactions"
      results={results}
      renderCard={(result) => <ReturnCard result={result} onProve={onProve} onFinalize={onFinalize} />}
    />
  );
}
