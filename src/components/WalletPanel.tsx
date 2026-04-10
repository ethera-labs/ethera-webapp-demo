type WalletPanelProps = {
  isConnected: boolean;
  walletAddress?: string;
  isConnecting: boolean;
  connectError?: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
};

export function WalletPanel({
  isConnected,
  walletAddress,
  isConnecting,
  connectError,
  onConnect,
  onDisconnect
}: WalletPanelProps) {
  return (
    <div className="wallet-box">
      {isConnected ? (
        <>
          <span className="wallet-address">{walletAddress}</span>
          <button className="btn btn-secondary" onClick={onDisconnect}>
            Disconnect
          </button>
        </>
      ) : (
        <button className="btn btn-primary" disabled={isConnecting} onClick={onConnect}>
          {isConnecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      )}
      {!isConnected && connectError ? <p className="inline-error">{connectError}</p> : null}
    </div>
  );
}
