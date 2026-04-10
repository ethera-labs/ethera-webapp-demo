import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { chainA, chainB, composeConfig, l1FundingConfig, networkProfile } from './composeConfig';
import { DepositTopUpModal } from './components/DepositTopUpModal';
import { FundingOutput } from './components/FundingOutput';
import { Picker } from './components/Picker';
import { TransactionOutput } from './components/TransactionOutput';
import { WalletPanel } from './components/WalletPanel';
import { formatTokenAmount } from './lib/format';
import { useBridgeScreenState } from './hooks/useBridgeScreenState';
import { useDepositTopUpOrchestration } from './hooks/useDepositTopUpOrchestration';
import { useFundingScreenState } from './hooks/useFundingScreenState';
import { useWalletOrchestration } from './hooks/useWalletOrchestration';
import './App.css';

// Root container that wires bridge/funding orchestration hooks into the UI.
type OpenMenu = 'source' | 'destination' | 'token' | 'fund-destination' | null;
type FlowMode = 'bridge' | 'fund';

const BASE_SUPPORTED_CHAIN_IDS = [chainA.id, chainB.id] as const;

/**
 * Main demo surface for wallet connect, cross-rollup bridge, and L1 funding modes.
 */
function App() {
  const [flowMode, setFlowMode] = useState<FlowMode>('bridge');
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [error, setError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const dropdownAreaRef = useRef<HTMLDivElement | null>(null);
  const entryPointAddress = composeConfig.entryPoint.address as `0x${string}`;

  const clearErrors = useCallback(() => {
    setError(null);
    setSuccessNotice(null);
  }, []);

  const showError = useCallback((message: string) => {
    setSuccessNotice(null);
    setError(message);
  }, []);

  const supportedChainIds = useMemo(() => {
    const ids = new Set<number>(BASE_SUPPORTED_CHAIN_IDS);
    if (l1FundingConfig) ids.add(l1FundingConfig.chain.id);
    return ids;
  }, []);

  const {
    depositModal,
    isToppingUpDeposit,
    topUpError,
    formatNativeAmount,
    handleDepositRequired,
    closeDepositModal,
    handleDepositTopUpConfirm,
    setTopUpAmountInput
  } = useDepositTopUpOrchestration({
    onClearErrors: clearErrors,
    onTopUpCompleted: () => {
      setSuccessNotice('Native funding complete. Ready to bridge.');
    }
  });

  const {
    walletAddress,
    walletChainId,
    isConnected,
    isConnecting,
    isSwitchingChain,
    isWalletOnSupportedChain,
    normalizedConnectError,
    connectWallet,
    disconnectWallet,
    switchWalletToChain,
    ensureWalletOnChain
  } = useWalletOrchestration({
    supportedChainIds,
    onWalletError: showError
  });

  const {
    sourceChainId,
    destinationChainId,
    selectedTokenSymbol,
    amountInput,
    sourceChain,
    destinationChain,
    selectedToken,
    sourceBalance,
    selectedSourceChainLabel,
    selectedDestinationChainLabel,
    selectedTokenDisplayBalance,
    selectedTokenHasBalance,
    noBalanceTooltip,
    sourceOptions,
    destinationOptions,
    tokenOptions,
    sourceTokenBalancesQuery,
    destinationBalanceQuery,
    accountsLoading,
    canSubmitBridge,
    executeBridge,
    isSubmitting,
    bridgePhase,
    clearBridgePhase,
    results,
    smartByChainId,
    setSelectedTokenSymbol,
    setAmountInput,
    handleSourceChainChange,
    handleDestinationChainChange,
    resetBridgeForm
  } = useBridgeScreenState({
    walletAddress,
    walletChainId,
    isConnected,
    isWalletOnSupportedChain,
    ensureWalletOnChain,
    onClearErrors: clearErrors,
    onBridgeError: showError,
    onDepositRequired: handleDepositRequired
  });

  const {
    fundingDestinationChainId,
    fundingAmountInput,
    fundingDestinationChain,
    selectedFundingSourceChainLabel,
    selectedFundingDestinationChainLabel,
    selectedFundingSourceChainName,
    selectedFundingDestinationChainName,
    fundingDestinationOptions,
    l1NativeBalance,
    l1NativeBalanceQuery,
    executeFunding,
    isFundingSubmitting,
    fundingPhase,
    clearFundingPhase,
    fundingResults,
    canSubmitFunding,
    setFundingDestinationChainId,
    setFundingAmountInput,
    resetFundingForm
  } = useFundingScreenState({
    walletAddress,
    isConnected,
    ensureWalletOnChain,
    onClearErrors: clearErrors,
    onFundingError: showError
  });

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!dropdownAreaRef.current) return;
      if (event.target instanceof Node && !dropdownAreaRef.current.contains(event.target)) {
        setOpenMenu(null);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, []);

  useEffect(() => {
    if (!isConnected || !walletChainId) return;
    if (supportedChainIds.has(walletChainId)) return;

    void switchWalletToChain(sourceChainId);
  }, [isConnected, sourceChainId, supportedChainIds, switchWalletToChain, walletChainId]);

  const handleFlowModeChange = useCallback(
    (nextFlowMode: FlowMode) => {
      setFlowMode(nextFlowMode);
      setError(null);
      setSuccessNotice(null);
      setOpenMenu(null);
      closeDepositModal(clearBridgePhase);
      clearFundingPhase();
    },
    [clearBridgePhase, clearFundingPhase, closeDepositModal]
  );

  const handleDisconnect = useCallback(async () => {
    setError(null);
    setSuccessNotice(null);
    setOpenMenu(null);
    closeDepositModal(clearBridgePhase);
    clearFundingPhase();
    resetBridgeForm();
    resetFundingForm();
    await disconnectWallet();
  }, [clearBridgePhase, clearFundingPhase, closeDepositModal, disconnectWallet, resetBridgeForm, resetFundingForm]);

  const activeFlowMode: FlowMode = l1FundingConfig ? flowMode : 'bridge';

  if (!selectedToken) {
    return (
      <main className="app-shell">
        <section className="panel form-panel">
          <p className="inline-error">No token configuration found. Check your `.env` token values and reload.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <div className="bg-orb bg-orb-left" />
      <div className="bg-orb bg-orb-right" />

      <header className="topbar">
        <div>
          <p className="eyebrow">Ethera Network</p>
          <h1>Ethera Bridge</h1>
        </div>
        <span className="network-chip">{networkProfile.label}</span>
      </header>

      <DepositTopUpModal
        modal={depositModal}
        isToppingUpDeposit={isToppingUpDeposit}
        topUpError={topUpError}
        formatNativeAmount={formatNativeAmount}
        onBackdropClose={() => {
          closeDepositModal(clearBridgePhase);
        }}
        onCancel={() => {
          closeDepositModal(clearBridgePhase);
        }}
        onConfirm={() => {
          void handleDepositTopUpConfirm({
            smartByChainId,
            entryPointAddress,
            ensureWalletOnChain,
            clearBridgePhase
          });
        }}
        onTopUpAmountChange={setTopUpAmountInput}
      />

      <section className="panel hero-panel">
        <div>
          <h2>One-click cross-rollup token movement</h2>
          <p>
            This demo builds two chain-specific user operations, composes them into one cross-rollup payload, and submits
            them atomically with the Ethera SDK.
          </p>
        </div>
        <WalletPanel
          isConnected={isConnected}
          walletAddress={walletAddress}
          isConnecting={isConnecting || isSwitchingChain}
          connectError={!isConnected ? normalizedConnectError : null}
          onConnect={() => {
            setError(null);
            void connectWallet();
          }}
          onDisconnect={() => {
            void handleDisconnect();
          }}
        />
      </section>

      <section className="panel form-panel">
        {error ? (
          <div className="status-banner status-banner-error" role="alert" aria-live="polite">
            <div>
              <p className="status-banner-title">{activeFlowMode === 'fund' ? 'Funding failed' : 'Bridge failed'}</p>
              <p className="status-banner-message">{error}</p>
            </div>
            <button type="button" className="status-banner-close" aria-label="Dismiss error" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}

        {successNotice && !error ? (
          <div className="status-banner status-banner-success" role="status" aria-live="polite">
            <div>
              <p className="status-banner-title">Funding complete</p>
              <p className="status-banner-message">{successNotice}</p>
            </div>
            <button
              type="button"
              className="status-banner-close"
              aria-label="Dismiss success message"
              onClick={() => setSuccessNotice(null)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {l1FundingConfig ? (
          <div className="flow-toggle" role="tablist" aria-label="Flow mode">
            <button
              type="button"
              role="tab"
              aria-selected={activeFlowMode === 'bridge'}
              className={`flow-toggle-btn ${activeFlowMode === 'bridge' ? 'flow-toggle-btn-active' : ''}`}
              onClick={() => handleFlowModeChange('bridge')}
            >
              Rollup Bridge
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeFlowMode === 'fund'}
              className={`flow-toggle-btn ${activeFlowMode === 'fund' ? 'flow-toggle-btn-active' : ''}`}
              onClick={() => handleFlowModeChange('fund')}
            >
              L1 to Rollup Bridge
            </button>
          </div>
        ) : null}

        {activeFlowMode === 'bridge' ? (
          <>
            <div className="grid" ref={dropdownAreaRef}>
              <label className="field">
                <span>Source</span>
                <Picker
                  ariaLabel="Select source chain"
                  open={openMenu === 'source'}
                  valueLeft={selectedSourceChainLabel}
                  onToggle={() => setOpenMenu((prev) => (prev === 'source' ? null : 'source'))}
                  onSelect={(value) => {
                    handleSourceChainChange(value);
                    setOpenMenu(null);
                  }}
                  options={sourceOptions}
                  selectedValue={sourceChainId}
                />
              </label>

              <label className="field">
                <span>Destination</span>
                <Picker
                  ariaLabel="Select destination chain"
                  open={openMenu === 'destination'}
                  valueLeft={selectedDestinationChainLabel}
                  onToggle={() => setOpenMenu((prev) => (prev === 'destination' ? null : 'destination'))}
                  onSelect={(value) => {
                    handleDestinationChainChange(value);
                    setOpenMenu(null);
                  }}
                  options={destinationOptions}
                  selectedValue={destinationChainId}
                />
              </label>

              <label className="field">
                <span>Token</span>
                <Picker
                  ariaLabel="Select token"
                  open={openMenu === 'token'}
                  valueLeft={selectedToken.symbol}
                  valueRight={selectedTokenDisplayBalance}
                  onToggle={() => setOpenMenu((prev) => (prev === 'token' ? null : 'token'))}
                  onSelect={(value) => {
                    setSelectedTokenSymbol(value);
                    setOpenMenu(null);
                  }}
                  options={tokenOptions}
                  selectedValue={selectedTokenSymbol}
                  className="picker-token"
                />
              </label>

              <label className="field" title={!selectedTokenHasBalance ? noBalanceTooltip : undefined}>
                <span>Amount</span>
                <input
                  className={!selectedTokenHasBalance ? 'amount-input amount-input-disabled' : 'amount-input'}
                  value={amountInput}
                  onChange={(event) => setAmountInput(event.target.value)}
                  inputMode="decimal"
                  disabled={!selectedTokenHasBalance}
                  title={!selectedTokenHasBalance ? noBalanceTooltip : undefined}
                  placeholder="0"
                />
              </label>
            </div>

            <p className="hint">
              Funds route from <strong>{sourceChain.name}</strong> to <strong>{destinationChain.name}</strong>.
            </p>

            <div className="bridge-summary">
              <p className="bridge-summary-tag">Balance</p>
              <div>
                <p className="summary-title">Source ({sourceChain.name})</p>
                <p className="summary-value">
                  {formatTokenAmount(sourceBalance, selectedToken.decimals)} {selectedToken.symbol}
                </p>
              </div>
              <div>
                <p className="summary-title">Destination ({destinationChain.name})</p>
                <p className="summary-value">
                  {formatTokenAmount(destinationBalanceQuery.data, selectedToken.decimals)} {selectedToken.symbol}
                </p>
              </div>
            </div>

            <button
              className={`btn btn-primary big ${isSubmitting ? 'btn-loading' : ''}`}
              disabled={!canSubmitBridge}
              aria-busy={isSubmitting}
              onClick={() => {
                void executeBridge();
              }}
            >
              <span className="btn-label">{isSubmitting ? 'Executing cross-rollup bridge...' : 'Bridge Across Rollups'}</span>
            </button>
            {isSubmitting && bridgePhase ? <p className="hint">{bridgePhase}</p> : null}

            {!isConnected ? <p className="hint">Connect a wallet to initialize smart accounts.</p> : null}
            {!networkProfile.paymasterByChainId ? <p className="hint hint-warning">Paymaster disabled</p> : null}
            {networkProfile.paymasterByChainId ? <p className="hint hint-success">Paymaster enabled</p> : null}
            {accountsLoading ? <p className="hint">Creating smart accounts on both chains...</p> : null}
            {sourceTokenBalancesQuery.isLoading ? <p className="hint">Checking source token balances...</p> : null}
          </>
        ) : (
          <>
            <div className="grid" ref={dropdownAreaRef}>
              <label className="field">
                <span>Source (L1)</span>
                <input className="readonly-input" value={selectedFundingSourceChainLabel} readOnly />
              </label>

              <label className="field">
                <span>Destination Rollup</span>
                <Picker
                  ariaLabel="Select funding destination chain"
                  open={openMenu === 'fund-destination'}
                  valueLeft={selectedFundingDestinationChainLabel}
                  onToggle={() => setOpenMenu((prev) => (prev === 'fund-destination' ? null : 'fund-destination'))}
                  onSelect={(value) => {
                    setFundingDestinationChainId(value);
                    setOpenMenu(null);
                  }}
                  options={fundingDestinationOptions}
                  selectedValue={fundingDestinationChainId}
                />
              </label>

              <label className="field">
                <span>Recipient</span>
                <input className="readonly-input mono" value={walletAddress ?? 'Connect wallet first'} readOnly />
              </label>

              <label className="field">
                <span>ETH amount</span>
                <input
                  className="amount-input"
                  value={fundingAmountInput}
                  onChange={(event) => setFundingAmountInput(event.target.value)}
                  inputMode="decimal"
                  placeholder="0.01"
                />
              </label>
            </div>

            <p className="hint">
              Send native ETH from <strong>{selectedFundingSourceChainName}</strong> to <strong>{selectedFundingDestinationChainName}</strong>.
            </p>

            <div className="bridge-summary">
              <p className="bridge-summary-tag">Balance</p>
              <div>
                <p className="summary-title">L1 Balance</p>
                <p className="summary-value">{formatTokenAmount(l1NativeBalance, 18)} ETH</p>
              </div>
              <div>
                <p className="summary-title">L1 Bridge Contract</p>
                <p className="summary-value mono">
                  {l1FundingConfig?.bridgeByDestinationChainId[fundingDestinationChain.id] &&
                  l1FundingConfig?.chain.blockExplorers?.default?.url ? (
                    <a
                      href={`${l1FundingConfig.chain.blockExplorers.default.url.replace(/\/$/, '')}/address/${l1FundingConfig.bridgeByDestinationChainId[fundingDestinationChain.id]}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {l1FundingConfig.bridgeByDestinationChainId[fundingDestinationChain.id]}
                    </a>
                  ) : (
                    l1FundingConfig?.bridgeByDestinationChainId[fundingDestinationChain.id] ?? 'Not configured'
                  )}
                </p>
              </div>
            </div>

            <button
              className={`btn btn-primary big ${isFundingSubmitting ? 'btn-loading' : ''}`}
              disabled={!canSubmitFunding}
              aria-busy={isFundingSubmitting}
              onClick={() => {
                void executeFunding();
              }}
            >
              <span className="btn-label">{isFundingSubmitting ? 'Submitting L1 funding...' : 'Fund Rollup from L1'}</span>
            </button>
            {isFundingSubmitting && fundingPhase ? <p className="hint">{fundingPhase}</p> : null}

            {!isConnected ? <p className="hint">Connect a wallet to fund rollups from L1.</p> : null}
            {!l1FundingConfig ? (
              <p className="hint">L1 funding is not configured. Set L1 bridge env vars to enable this flow.</p>
            ) : null}
            {l1NativeBalanceQuery.isLoading ? <p className="hint">Checking L1 balance...</p> : null}
          </>
        )}
      </section>

      {activeFlowMode === 'bridge' ? <TransactionOutput results={results} /> : <FundingOutput results={fundingResults} />}
    </main>
  );
}

export default App;
