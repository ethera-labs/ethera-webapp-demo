import { formatEther } from 'viem';
import type { FundingResult } from '../types/funding';
import { TransactionHistorySection } from './transactionOutput.shared';
import { formatRunTimestamp, getStatusTag } from './transactionOutput.utils';

type FundingOutputProps = {
  results: FundingResult[];
  title?: string;
  emptyMessage?: string;
  archiveSummaryLabel?: string;
  pendingMessage?: string;
};

const renderFundingCard = (result: FundingResult, pendingMessage: string) => {
  const status = getStatusTag(result.status);

  return (
    <div className="transactions-card" key={result.sessionId.toString()}>
      <div className="transactions-card-header">
        <div className="transactions-card-meta">
          <span className="transactions-card-time">{formatRunTimestamp(result.sessionId)}</span>
        </div>
        <div className="receipt-status-tags">
          <span className={`receipt-status-tag receipt-status-tag-${status.tone}`}>{status.label}</span>
        </div>
      </div>

      {result.status === 'pending' ? <p className="hint tx-progress-note">{pendingMessage}</p> : null}

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
          <span className="tx-label">{result.sourceChainLabel} Tx</span>
          {result.explorerUrl ? (
            <a href={result.explorerUrl} target="_blank" rel="noreferrer" className="mono tx-hash" title={result.hash}>
              {result.hash}
            </a>
          ) : (
            <span className="mono tx-hash">{result.hash}</span>
          )}
        </div>
      </div>
    </div>
  );
};

export function FundingOutput({
  results,
  title = 'Transactions',
  emptyMessage = 'Run an L1 transaction to see hashes and explorer links.',
  archiveSummaryLabel = 'Show previous transactions',
  pendingMessage = 'Waiting for L1 confirmation.'
}: FundingOutputProps) {
  return (
    <TransactionHistorySection
      title={title}
      emptyMessage={emptyMessage}
      archiveSummaryLabel={archiveSummaryLabel}
      results={results}
      renderCard={(result) => renderFundingCard(result, pendingMessage)}
    />
  );
}
