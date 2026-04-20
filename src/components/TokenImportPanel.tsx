type TokenImportPanelProps = {
  isOpen: boolean;
  toggleLabel: string;
  addressInput: string;
  isImporting: boolean;
  importError: string | null;
  helperText: string;
  secondaryHelperText?: string;
  onToggle: () => void;
  onAddressChange: (value: string) => void;
  onImport: () => void;
};

/**
 * Shared import-token UI used by funding and return flows.
 */
export function TokenImportPanel({
  isOpen,
  toggleLabel,
  addressInput,
  isImporting,
  importError,
  helperText,
  secondaryHelperText,
  onToggle,
  onAddressChange,
  onImport
}: TokenImportPanelProps) {
  return (
    <>
      <div className="funding-import-toggle-row">
        <button type="button" className="btn btn-secondary btn-compact" onClick={onToggle}>
          <span className="btn-label">{toggleLabel}</span>
        </button>
      </div>

      {isOpen ? (
        <div className="funding-import-panel">
          <div className="funding-import-row">
            <label className="field">
              <span>Import token</span>
              <input
                className="mono"
                value={addressInput}
                onChange={(event) => onAddressChange(event.target.value)}
                placeholder="0x..."
              />
            </label>

            <button
              type="button"
              className={`btn btn-secondary btn-compact ${isImporting ? 'btn-loading' : ''}`}
              disabled={!addressInput.trim() || isImporting}
              aria-busy={isImporting}
              onClick={onImport}
            >
              <span className="btn-label">{isImporting ? 'Importing...' : 'Import token'}</span>
            </button>
          </div>
          <p className="hint">{helperText}</p>
          {secondaryHelperText ? <p className="hint">{secondaryHelperText}</p> : null}
          {importError ? <p className="inline-error">{importError}</p> : null}
        </div>
      ) : null}
    </>
  );
}
