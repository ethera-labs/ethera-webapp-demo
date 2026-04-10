export type FundingReceiptStatus = 'pending' | 'success' | 'failed';

export type FundingResult = {
  hash: `0x${string}`;
  explorerUrl: string;
  sourceChainLabel: string;
  destinationChainLabel: string;
  recipient: `0x${string}`;
  amountWei: bigint;
  status: FundingReceiptStatus;
  sessionId: bigint;
};

