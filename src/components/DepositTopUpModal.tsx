import type { DepositModalState } from '../types/deposit';

type DepositTopUpModalProps = {
  modal: DepositModalState | null;
  isToppingUpDeposit: boolean;
  topUpError: string | null;
  formatNativeAmount: (value: bigint) => string;
  onBackdropClose: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onTopUpAmountChange: (nextValue: string) => void;
};

export function DepositTopUpModal({
  modal,
  isToppingUpDeposit,
  topUpError,
  formatNativeAmount,
  onBackdropClose,
  onCancel,
  onConfirm,
  onTopUpAmountChange
}: DepositTopUpModalProps) {
  if (!modal) return null;

  const activeRequirement = modal.requirements[modal.currentIndex];
  const stepNumber = modal.currentIndex + 1;
  const stepCount = modal.requirements.length;
  const parsedTopUpAmount = Number(modal.topUpAmountInput);
  const isTopUpAmountValid = Number.isFinite(parsedTopUpAmount) && parsedTopUpAmount > 0;
  const showTopUpAmountValidationError = modal.topUpAmountInput.trim().length > 0 && !isTopUpAmountValid;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="deposit-modal-title"
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        if (isToppingUpDeposit) return;
        onBackdropClose();
      }}
    >
      <div className="modal-card">
        <div className="modal-title-row">
          <h3 id="deposit-modal-title">Deposit Required</h3>
          <span className="modal-help-wrap">
            <span className="modal-help" tabIndex={0} role="img" aria-label="Why this is required">
              ?
            </span>
            <span className="modal-help-tooltip" role="tooltip">
              Paymaster is disabled. Your smart account needs enough native gas deposit on each chain before the bridge can execute.
            </span>
          </span>
        </div>
        <p className="hint modal-hint">We detected low deposit. Top up each chain to avoid bridge failure.</p>

        <div className="deposit-progress">
          <p className="deposit-progress-title">
            Step {stepNumber} of {stepCount}
          </p>
          <div className="deposit-progress-steps">
            {modal.requirements.map((requirement, index) => {
              const isDone = modal.completedChainIds.includes(requirement.chainId);
              const isCurrent = index === modal.currentIndex;
              const tone = isDone ? 'done' : isCurrent ? 'current' : 'pending';
              const label = isDone ? 'Done' : isCurrent ? 'Current' : 'Pending';

              return (
                <div key={requirement.chainId} className={`deposit-step deposit-step-${tone}`}>
                  <span className="deposit-step-chain">{requirement.chainLabel}</span>
                  <span className={`deposit-step-tag deposit-step-tag-${tone}`}>{label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {activeRequirement ? (
          <div className="deposit-grid">
            <div className="deposit-row deposit-row-current">
              <p className="summary-title">{activeRequirement.chainLabel}</p>
              <p className="hint">Current deposit: {formatNativeAmount(activeRequirement.currentDeposit)}</p>
              <p className="hint">Estimated required: {formatNativeAmount(activeRequirement.estimatedRequired)}</p>
            </div>
          </div>
        ) : null}

        <label className="field">
          <span>Top-up amount for this chain</span>
          <input
            className="amount-input"
            value={modal.topUpAmountInput}
            onChange={(event) => onTopUpAmountChange(event.target.value)}
            inputMode="decimal"
            min="0"
            step="any"
            placeholder="0.01"
          />
        </label>
        {showTopUpAmountValidationError ? <p className="inline-error">Top-up amount must be greater than zero.</p> : null}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" disabled={isToppingUpDeposit} onClick={onCancel}>
            Cancel Bridge
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isToppingUpDeposit || !isTopUpAmountValid}
            onClick={onConfirm}
          >
            {isToppingUpDeposit ? 'Topping up...' : 'Top Up'}
          </button>
        </div>

        {topUpError ? <p className="inline-error">{topUpError}</p> : null}
      </div>
    </div>
  );
}
