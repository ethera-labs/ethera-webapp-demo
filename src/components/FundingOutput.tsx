import { formatUnits } from 'viem';
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

/**
 * Renders a clickable explorer value when URL is available.
 */
const renderExplorerValue = ({ value, url }: { value: string; url?: string }) =>
  url ? (
    <a href={url} target="_blank" rel="noreferrer" className="mono tx-hash" title={value}>
      {value}
    </a>
  ) : (
    <span className="mono tx-hash">{value}</span>
  );

const renderFundingCard = (result: FundingResult, pendingMessage: string) => {
  const status = getStatusTag(result.status);
  const destinationTxStatusTag = result.destinationTxStatus ? getStatusTag(result.destinationTxStatus) : null;

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
      {result.status === 'success' && result.destinationTxStatus === 'pending' ? (
        <p className="hint tx-progress-note">L1 confirmed. Waiting for destination rollup confirmation.</p>
      ) : null}
      {result.status === 'success' && result.destinationTxStatus === 'failed' ? (
        <p className="hint hint-warning">Destination rollup transaction failed. Open the rollup tx for details.</p>
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
          <span className="mono tx-hash">
            {formatUnits(result.amountWei, result.tokenDecimals)} {result.tokenSymbol}
          </span>
        </div>
        <div className="tx-item">
          <span className="tx-label">Recipient</span>
          <span className="mono tx-hash">{result.recipient}</span>
        </div>
        <div className="tx-item">
          <span className="tx-label">{result.sourceChainLabel} Tx</span>
          {renderExplorerValue({ value: result.hash, url: result.explorerUrl })}
        </div>
        {result.destinationTxHash ? (
          <div className="tx-item">
            <span className="tx-label">{result.destinationChainLabel} Tx</span>
            {renderExplorerValue({ value: result.destinationTxHash, url: result.destinationTxExplorerUrl })}
          </div>
        ) : null}
        {result.destinationTxHash && destinationTxStatusTag ? (
          <div className="tx-item">
            <span className="tx-label">{result.destinationChainLabel} Status</span>
            <span className="tx-hash">
              <span className={`receipt-status-tag receipt-status-tag-${destinationTxStatusTag.tone}`}>
                {destinationTxStatusTag.label}
              </span>
            </span>
          </div>
        ) : null}
        {result.destinationTokenAddress ? (
          <div className="tx-item">
            <span className="tx-label">Destination Token</span>
            {renderExplorerValue({ value: result.destinationTokenAddress, url: result.destinationTokenExplorerUrl })}
          </div>
        ) : null}
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
