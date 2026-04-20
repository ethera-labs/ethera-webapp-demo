import type { ReactNode } from 'react';

type FlowBalanceSummaryRow = {
  title: string;
  value: ReactNode;
  mono?: boolean;
};

type FlowBalanceSummaryProps = {
  rows: readonly FlowBalanceSummaryRow[];
  tag?: string;
};

export function FlowBalanceSummary({ rows, tag = 'Balance' }: FlowBalanceSummaryProps) {
  return (
    <div className="bridge-summary">
      <p className="bridge-summary-tag">{tag}</p>
      {rows.map((row) => (
        <div key={row.title}>
          <p className="summary-title">{row.title}</p>
          <p className={`summary-value${row.mono ? ' mono' : ''}`}>{row.value}</p>
        </div>
      ))}
    </div>
  );
}
