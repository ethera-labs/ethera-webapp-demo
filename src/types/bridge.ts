export type BridgeReceiptStatus = 'pending' | 'success' | 'failed';

export type BridgeResult = {
  hashes: `0x${string}`[];
  explorerUrls: string[];
  chainLabels?: string[];
  sessionId: bigint;
  receiptStatuses: BridgeReceiptStatus[];
};

export type TokenBalances = Record<string, bigint>;
