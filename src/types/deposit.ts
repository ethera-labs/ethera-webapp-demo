export type DepositRequirement = {
  chainId: number;
  chainLabel: string;
  smartAccount: `0x${string}`;
  currentDeposit: bigint;
  estimatedRequired: bigint;
  recommendedTopUp: bigint;
};

export type DepositModalState = {
  requirements: DepositRequirement[];
  currentIndex: number;
  completedChainIds: number[];
  topUpAmountInput: string;
};
