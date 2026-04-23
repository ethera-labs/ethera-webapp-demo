import type { Chain } from 'viem';

export type AccountAbstractionContracts = {
  kernelImpl: `0x${string}`;
  kernelFactory: `0x${string}`;
  multichainValidator: `0x${string}`;
  metaFactory?: `0x${string}`;
};

export type DemoTokenKind = 'erc20' | 'nativeEthViaWeth';
export type DemoTokenBridgeMode = 'erc20' | 'cet';

export type DemoToken = {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  kind: DemoTokenKind;
  bridgeMode?: DemoTokenBridgeMode;
};

export type L1FundingConfig = {
  chain: Chain;
  rpc: string;
  bridgeByDestinationChainId: Record<number, `0x${string}`>;
  composePortalBySourceChainId?: Record<number, `0x${string}`>;
  minGasLimit: number;
};

export type UniversalContractsConfig = {
  l2ToL2Bridge?: `0x${string}`;
  mailbox?: `0x${string}`;
  cetFactory?: `0x${string}`;
  ethLiquidity?: `0x${string}`;
  l2BridgeByChainId?: Record<number, `0x${string}`>;
  composePortalByChainId?: Record<number, `0x${string}`>;
};

export type NetworkProfile = {
  mode: 'testnet' | 'mainnet';
  label: string;
  chains: readonly [Chain, Chain];
  rpcByChainId: Record<number, string>;
  bridgeAddress: `0x${string}`;
  accountAbstractionContracts: Record<number, AccountAbstractionContracts>;
  tokens: readonly DemoToken[];
  paymasterByChainId?: Record<number, string>;
  l1Funding?: L1FundingConfig;
  universal?: UniversalContractsConfig;
};
