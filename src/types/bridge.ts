export type BridgeReceiptStatus = 'pending' | 'success' | 'failed';

export type BridgeResult = {
  hashes: `0x${string}`[];
  explorerUrls: string[];
  chainLabels?: string[];
  stepLabels?: string[];
  sessionId: bigint;
  receiptStatuses: BridgeReceiptStatus[];
};

export type TokenBalances = Record<string, bigint>;

export type BridgeMessageLabel = 'SEND_ETH' | 'SEND_TOKENS';

export type BridgeMessageHeader = {
  chainSrc: bigint;
  chainDest: bigint;
  sender: `0x${string}`;
  receiver: `0x${string}`;
  sessionId: bigint;
  label: BridgeMessageLabel;
};
