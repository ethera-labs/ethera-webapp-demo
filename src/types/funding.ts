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

export type WithdrawalLifecycleStatus =
  | 'waiting-to-prove'
  | 'ready-to-prove'
  | 'proving'
  | 'waiting-to-finalize'
  | 'ready-to-finalize'
  | 'finalizing'
  | 'finalized';

export type ReturnSettlementContracts = {
  l1MessengerAddress: `0x${string}`;
  l1PortalAddress: `0x${string}`;
  l1DisputeGameFactoryAddress: `0x${string}`;
};

export type ReturnResult = FundingResult & {
  sourceChainId: number;
  destinationChainId: number;
  settlementContracts: ReturnSettlementContracts;
  lifecycleStatus: WithdrawalLifecycleStatus;
  proveTxHash?: `0x${string}`;
  proveTxExplorerUrl?: string;
  finalizeTxHash?: `0x${string}`;
  finalizeTxExplorerUrl?: string;
};
