import type { useSmartAccount } from '@ssv-labs/ethera-sdk/react';
import type { Chain } from 'viem';
import type { DemoToken } from '../../composeConfig';
import type { BridgeReceiptStatus } from '../../types/bridge';
import type { DepositRequirement } from '../../types/deposit';

// Shared bridge-execution types used across modular helper files.
export type SmartAccountData = NonNullable<ReturnType<typeof useSmartAccount>['data']>;

export type BridgeCall = {
  to: `0x${string}`;
  value: bigint;
  data: `0x${string}`;
};

export type WalletClientLike = {
  writeContract: (...args: unknown[]) => Promise<`0x${string}`>;
  sendTransaction: (...args: unknown[]) => Promise<`0x${string}`>;
  getChainId: () => Promise<number>;
};

export type ValidateBridgeExecutionInputParams = {
  amountInput: string;
  selectedToken: DemoToken | undefined;
  sourceBalance: bigint | undefined;
  walletAddress: `0x${string}` | undefined;
  sourceChain: Chain;
  destinationChain: Chain;
  sourceSmart: SmartAccountData | undefined;
  destinationSmart: SmartAccountData | undefined;
};

export type ValidBridgeExecutionInput = {
  amount: bigint;
  selectedToken: DemoToken;
  walletAddress: `0x${string}`;
  sourceSmart: SmartAccountData;
  destinationSmart: SmartAccountData;
};

export type ValidateBridgeExecutionInputResult =
  | { ok: true; value: ValidBridgeExecutionInput }
  | { ok: false; error: string };

export type SourceFundingContext =
  | {
      kind: 'erc20';
      sourceTotalBalanceOnChain: bigint;
      amountToPullFromEoa: bigint;
      sourceAllowance: bigint;
    }
  | {
      kind: 'nativeEthViaWeth';
      sourceTotalBalanceOnChain: bigint;
      amountToFundSmartAccountFromEoa: bigint;
    };

export type BuildBridgeCallsParams = {
  selectedToken: DemoToken;
  walletAddress: `0x${string}`;
  sender: `0x${string}`;
  receiver: `0x${string}`;
  destinationEoaReceiver: `0x${string}`;
  bridgeAddress: `0x${string}`;
  sourceChainId: number;
  destinationChainId: number;
  amount: bigint;
  sessionId: bigint;
  amountToPullFromEoa: bigint;
};

export type ResolveEntryPointDepositRequirementsParams = {
  sourceSmartAccount: SmartAccountData;
  destinationSmartAccount: SmartAccountData;
  sourceCalls: BridgeCall[];
  destinationCalls: BridgeCall[];
  sourceChainLabel: string;
  destinationChainLabel: string;
  entryPointAddress: `0x${string}`;
};

export type ExecuteComposedBridgeFlowParams = {
  sourceSmartAccount: SmartAccountData;
  destinationSmartAccount: SmartAccountData;
  sourceChain: Chain;
  sourceCalls: BridgeCall[];
  destinationCalls: BridgeCall[];
  selectedToken: DemoToken;
  walletAddress: `0x${string}`;
  sender: `0x${string}`;
  fundingContext: SourceFundingContext;
  ensureWalletOnChain: (targetChainId: number) => Promise<unknown>;
  setBridgePhase: (value: string | null) => void;
  onPayloadSubmitted: (params: { hashesToTrack: `0x${string}`[]; explorerUrls: string[] }) => void;
};

export type ExecuteComposedBridgeFlowResult = {
  hashesToTrack: `0x${string}`[];
  explorerUrls: string[];
  receiptStatuses: BridgeReceiptStatus[];
};

export type EstimateEntryPointRequirementParams = {
  smart: SmartAccountData;
  calls: BridgeCall[];
  chainLabel: string;
  entryPointAddress: `0x${string}`;
};

export type EntryPointRequirement = DepositRequirement;
