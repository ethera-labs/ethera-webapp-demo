import type { ReactNode } from 'react';

type TransactionHistorySectionProps<T> = {
  title: string;
  emptyMessage: string;
  archiveSummaryLabel: string;
  results: readonly T[];
  renderCard: (result: T) => ReactNode;
};

export const TransactionHistorySection = <T,>({
  title,
  emptyMessage,
  archiveSummaryLabel,
  results,
  renderCard
}: TransactionHistorySectionProps<T>) => {
  const latestResult = results[0];
  const previousResults = results.slice(1);

  return (
    <section className="panel telemetry-panel">
      <h3 className="telemetry-title">{title}</h3>
      {results.length === 0 ? <p className="hint">{emptyMessage}</p> : null}

      {latestResult ? (
        <div className="transactions-history">
          {renderCard(latestResult)}
          {previousResults.length > 0 ? (
            <details className="transactions-archive">
              <summary>
                {archiveSummaryLabel} ({previousResults.length})
              </summary>
              <div className="transactions-archive-content">{previousResults.map((result) => renderCard(result))}</div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
};
