import type { Chain } from 'viem';

export type AccountAbstractionContracts = {
  kernelImpl: `0x${string}`;
  kernelFactory: `0x${string}`;
  multichainValidator: `0x${string}`;
  metaFactory: `0x${string}`;
};

export type DemoTokenKind = 'erc20' | 'nativeEthViaWeth';

export type DemoToken = {
  symbol: string;
  address: `0x${string}`;
  decimals: number;
  kind: DemoTokenKind;
};

export type L1FundingConfig = {
  chain: Chain;
  rpc: string;
  bridgeByDestinationChainId: Record<number, `0x${string}`>;
  minGasLimit: number;
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
};
