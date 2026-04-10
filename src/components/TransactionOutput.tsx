import type { BridgeResult } from '../types/bridge';
import { TransactionHistorySection } from './transactionOutput.shared';
import { formatRunTimestamp, getAggregatedStatusTag } from './transactionOutput.utils';

type TransactionOutputProps = {
  results: BridgeResult[];
};

const resolveChainLabel = (result: BridgeResult, index: number): string => {
  const explicitLabel = result.chainLabels?.[index]?.trim();
  if (explicitLabel) return explicitLabel;

  const explorerUrl = result.explorerUrls[index];
  if (!explorerUrl) return `Chain ${index + 1}`;

  try {
    const hostname = new URL(explorerUrl).hostname.toLowerCase();
    if (hostname.includes('rollup-a')) return 'Rollup A';
    if (hostname.includes('rollup-b')) return 'Rollup B';
    return hostname.replace(/^www\./, '');
  } catch {
    return `Chain ${index + 1}`;
  }
};

const renderTransactionCard = (result: BridgeResult) => {
  const bridgeStatus = getAggregatedStatusTag(result.receiptStatuses);

  return (
    <div className="transactions-card" key={result.sessionId.toString()}>
      <div className="transactions-card-header">
        <div className="transactions-card-meta">
          <span className="transactions-card-time">{formatRunTimestamp(result.sessionId)}</span>
        </div>
        <div className="receipt-status-tags">
          <span className={`receipt-status-tag receipt-status-tag-${bridgeStatus.tone}`}>{bridgeStatus.label}</span>
        </div>
      </div>
      {result.receiptStatuses.some((status) => status === 'pending') ? (
        <p className="hint tx-progress-note">Waiting for confirmations on both rollups.</p>
      ) : null}
      <div className="tx-list">
        {result.hashes.map((hash, index) => (
          <div className="tx-item" key={hash}>
            <span className="tx-label">{resolveChainLabel(result, index)} Tx</span>
            <a href={result.explorerUrls[index]} target="_blank" rel="noreferrer" className="mono tx-hash" title={hash}>
              {hash}
            </a>
          </div>
        ))}
      </div>
    </div>
  );
};

export function TransactionOutput({ results }: TransactionOutputProps) {
  return (
    <TransactionHistorySection
      title="Transactions"
      emptyMessage="Run a bridge to see hashes and explorer links."
      archiveSummaryLabel="Show previous transactions"
      results={results}
      renderCard={renderTransactionCard}
    />
  );
}
