import {
  rollupA,
  rollupB,
  rollupsAccountAbstractionContracts
} from '@ssv-labs/ethera-sdk';
import { defineChain, type Chain } from 'viem';
import { base, mainnet, sepolia } from 'viem/chains';
import {
  getEnv,
  getOptionalPositiveIntEnv,
  getRequiredEnv,
  parseNonNegativeInt,
  toAddress,
  toHttpUrl
} from './env';
import { resolvePaymasterByChainId } from './paymaster';
import type { AccountAbstractionContracts, DemoToken, NetworkProfile } from './types';

// Network profile builders for testnet/mainnet compose runtime setup.

const resolveSingleToken = ({
  addressKey,
  decimalsKey,
  symbolKey,
  defaultSymbol,
  defaultDecimals
}: {
  addressKey: string;
  decimalsKey: string;
  symbolKey: string;
  defaultSymbol: string;
  defaultDecimals: number;
}): DemoToken | undefined => {
  const addressValue = getEnv(addressKey);
  if (!addressValue) return undefined;

  const decimalsValue = getEnv(decimalsKey);

  return {
    symbol: getEnv(symbolKey) ?? defaultSymbol,
    address: toAddress(addressValue, addressKey),
    decimals: decimalsValue ? parseNonNegativeInt(decimalsValue, decimalsKey) : defaultDecimals,
    kind: 'erc20'
  };
};

const resolveTestnetTokens = (singleToken: DemoToken): readonly DemoToken[] => {
  const testnetWethAddress = toAddress(getRequiredEnv('VITE_TESTNET_WETH_ADDRESS'), 'VITE_TESTNET_WETH_ADDRESS');

  if (singleToken.symbol.toUpperCase() === 'ETH') {
    throw new Error('VITE_TESTNET_TOKEN_SYMBOL must not be ETH. ETH is reserved for native bridge mode.');
  }

  const ethBridgeToken: DemoToken = {
    symbol: 'ETH',
    address: testnetWethAddress,
    decimals: 18,
    kind: 'nativeEthViaWeth'
  };

  if (singleToken.address.toLowerCase() === ethBridgeToken.address.toLowerCase()) {
    throw new Error('VITE_TESTNET_TOKEN_ADDRESS must not be the WETH bridge token address reserved for ETH mode.');
  }

  return [singleToken, ethBridgeToken];
};

const resolveOptionalAddressEnv = (key: string): `0x${string}` | undefined => {
  const value = getEnv(key);
  return value ? toAddress(value, key) : undefined;
};

const makeTestnetChain = ({
  id,
  name,
  rpc,
  explorer
}: {
  id: number;
  name: string;
  rpc: string;
  explorer: string;
}): Chain =>
  defineChain({
    id,
    name,
    nativeCurrency: {
      name: 'Ethereum',
      symbol: 'ETH',
      decimals: 18
    },
    rpcUrls: {
      default: {
        http: [rpc]
      }
    },
    blockExplorers: {
      default: {
        name,
        url: explorer
      }
    },
    testnet: true
  });

/**
 * Builds the testnet runtime profile from env overrides with SDK defaults as fallback.
 */
export const createTestnetProfile = (): NetworkProfile => {
  const chainAId = getOptionalPositiveIntEnv('VITE_TESTNET_ROLLUP_A_CHAIN_ID') ?? rollupA.id;
  const chainBId = getOptionalPositiveIntEnv('VITE_TESTNET_ROLLUP_B_CHAIN_ID') ?? rollupB.id;

  const chainARpc = toHttpUrl(
    getEnv('VITE_TESTNET_ROLLUP_A_RPC') ?? rollupA.rpcUrls.default.http[0],
    'VITE_TESTNET_ROLLUP_A_RPC'
  );
  const chainBRpc = toHttpUrl(
    getEnv('VITE_TESTNET_ROLLUP_B_RPC') ?? rollupB.rpcUrls.default.http[0],
    'VITE_TESTNET_ROLLUP_B_RPC'
  );

  const chainAName = getEnv('VITE_TESTNET_ROLLUP_A_NAME') ?? rollupA.name;
  const chainBName = getEnv('VITE_TESTNET_ROLLUP_B_NAME') ?? rollupB.name;

  const chainAExplorer = toHttpUrl(
    getEnv('VITE_TESTNET_ROLLUP_A_EXPLORER') ?? rollupA.blockExplorers.default.url,
    'VITE_TESTNET_ROLLUP_A_EXPLORER'
  );
  const chainBExplorer = toHttpUrl(
    getEnv('VITE_TESTNET_ROLLUP_B_EXPLORER') ?? rollupB.blockExplorers.default.url,
    'VITE_TESTNET_ROLLUP_B_EXPLORER'
  );

  const chainAMetaFactory = resolveOptionalAddressEnv('VITE_TESTNET_ROLLUP_A_META_FACTORY');
  const chainBMetaFactory = resolveOptionalAddressEnv('VITE_TESTNET_ROLLUP_B_META_FACTORY');

  const chainAContracts: AccountAbstractionContracts = {
    kernelImpl: toAddress(
      getEnv('VITE_TESTNET_ROLLUP_A_KERNEL_IMPL') ?? rollupsAccountAbstractionContracts.kernelImpl,
      'VITE_TESTNET_ROLLUP_A_KERNEL_IMPL'
    ),
    kernelFactory: toAddress(
      getEnv('VITE_TESTNET_ROLLUP_A_KERNEL_FACTORY') ?? rollupsAccountAbstractionContracts.kernelFactory,
      'VITE_TESTNET_ROLLUP_A_KERNEL_FACTORY'
    ),
    multichainValidator: toAddress(
      getEnv('VITE_TESTNET_ROLLUP_A_MULTICHAIN_VALIDATOR') ?? rollupsAccountAbstractionContracts.multichainValidator,
      'VITE_TESTNET_ROLLUP_A_MULTICHAIN_VALIDATOR'
    ),
    ...(chainAMetaFactory ? { metaFactory: chainAMetaFactory } : {})
  };

  const chainBContracts: AccountAbstractionContracts = {
    kernelImpl: toAddress(
      getEnv('VITE_TESTNET_ROLLUP_B_KERNEL_IMPL') ?? rollupsAccountAbstractionContracts.kernelImpl,
      'VITE_TESTNET_ROLLUP_B_KERNEL_IMPL'
    ),
    kernelFactory: toAddress(
      getEnv('VITE_TESTNET_ROLLUP_B_KERNEL_FACTORY') ?? rollupsAccountAbstractionContracts.kernelFactory,
      'VITE_TESTNET_ROLLUP_B_KERNEL_FACTORY'
    ),
    multichainValidator: toAddress(
      getEnv('VITE_TESTNET_ROLLUP_B_MULTICHAIN_VALIDATOR') ?? rollupsAccountAbstractionContracts.multichainValidator,
      'VITE_TESTNET_ROLLUP_B_MULTICHAIN_VALIDATOR'
    ),
    ...(chainBMetaFactory ? { metaFactory: chainBMetaFactory } : {})
  };

  const chainAResolved = makeTestnetChain({
    id: chainAId,
    name: chainAName,
    rpc: chainARpc,
    explorer: chainAExplorer
  });

  const chainBResolved = makeTestnetChain({
    id: chainBId,
    name: chainBName,
    rpc: chainBRpc,
    explorer: chainBExplorer
  });

  const l1ChainId = getOptionalPositiveIntEnv('VITE_TESTNET_L1_CHAIN_ID') ?? sepolia.id;
  const l1Rpc = toHttpUrl(getEnv('VITE_TESTNET_L1_RPC') ?? sepolia.rpcUrls.default.http[0], 'VITE_TESTNET_L1_RPC');
  const l1Name = getEnv('VITE_TESTNET_L1_NAME') ?? sepolia.name;
  const l1Explorer = toHttpUrl(
    getEnv('VITE_TESTNET_L1_EXPLORER') ?? sepolia.blockExplorers.default.url,
    'VITE_TESTNET_L1_EXPLORER'
  );
  const l1Resolved = makeTestnetChain({
    id: l1ChainId,
    name: l1Name,
    rpc: l1Rpc,
    explorer: l1Explorer
  });

  const l1ToRollupABridge = getEnv('VITE_TESTNET_L1_TO_ROLLUP_A_BRIDGE');
  const l1ToRollupBBridge = getEnv('VITE_TESTNET_L1_TO_ROLLUP_B_BRIDGE');
  const hasAnyL1BridgeConfig = Boolean(l1ToRollupABridge || l1ToRollupBBridge);

  if (hasAnyL1BridgeConfig && (!l1ToRollupABridge || !l1ToRollupBBridge)) {
    throw new Error(
      'L1 bridge config is partial. Define both VITE_TESTNET_L1_TO_ROLLUP_A_BRIDGE and VITE_TESTNET_L1_TO_ROLLUP_B_BRIDGE.'
    );
  }

  const l1Funding = hasAnyL1BridgeConfig
    ? {
        chain: l1Resolved,
        rpc: l1Rpc,
        bridgeByDestinationChainId: {
          [chainAResolved.id]: toAddress(l1ToRollupABridge!, 'VITE_TESTNET_L1_TO_ROLLUP_A_BRIDGE'),
          [chainBResolved.id]: toAddress(l1ToRollupBBridge!, 'VITE_TESTNET_L1_TO_ROLLUP_B_BRIDGE')
        },
        minGasLimit: getOptionalPositiveIntEnv('VITE_TESTNET_L1_BRIDGE_MIN_GAS_LIMIT') ?? 200_000
      }
    : undefined;

  const singleToken = resolveSingleToken({
    addressKey: 'VITE_TESTNET_TOKEN_ADDRESS',
    decimalsKey: 'VITE_TESTNET_TOKEN_DECIMALS',
    symbolKey: 'VITE_TESTNET_TOKEN_SYMBOL',
    defaultSymbol: 'TOKEN',
    defaultDecimals: 18
  });
  if (!singleToken) {
    throw new Error(
      'Missing testnet token config. Define VITE_TESTNET_TOKEN_ADDRESS (and optionally VITE_TESTNET_TOKEN_DECIMALS / VITE_TESTNET_TOKEN_SYMBOL).'
    );
  }

  const paymasterByChainId = resolvePaymasterByChainId({
    defaultEndpointKey: 'VITE_TESTNET_PAYMASTER_URL',
    chainAEndpointKey: 'VITE_TESTNET_ROLLUP_A_PAYMASTER_URL',
    chainBEndpointKey: 'VITE_TESTNET_ROLLUP_B_PAYMASTER_URL',
    baseEndpointKey: 'VITE_TESTNET_PAYMASTER_BASE_URL',
    chainARouteNameKey: 'VITE_TESTNET_ROLLUP_A_PAYMASTER_NAME',
    chainBRouteNameKey: 'VITE_TESTNET_ROLLUP_B_PAYMASTER_NAME',
    chainARouteNameDefault: 'rollupA',
    chainBRouteNameDefault: 'rollupB',
    chainAId: chainAResolved.id,
    chainBId: chainBResolved.id
  });

  return {
    mode: 'testnet',
    label: getEnv('VITE_TESTNET_LABEL') ?? 'Ethera Testnet',
    chains: [chainAResolved, chainBResolved],
    rpcByChainId: {
      [chainAResolved.id]: chainARpc,
      [chainBResolved.id]: chainBRpc,
      ...(l1Funding ? { [l1Funding.chain.id]: l1Funding.rpc } : {})
    },
    bridgeAddress: toAddress(getRequiredEnv('VITE_TESTNET_BRIDGE'), 'VITE_TESTNET_BRIDGE'),
    accountAbstractionContracts: {
      [chainAResolved.id]: chainAContracts,
      [chainBResolved.id]: chainBContracts
    },
    tokens: resolveTestnetTokens(singleToken),
    paymasterByChainId,
    l1Funding
  };
};

/**
 * Builds the mainnet runtime profile from explicit required env values.
 */
export const createMainnetProfile = (): NetworkProfile => {
  const mainnetContracts: AccountAbstractionContracts = {
    kernelImpl: toAddress(getRequiredEnv('VITE_MAINNET_MAINNET_KERNEL_IMPL'), 'VITE_MAINNET_MAINNET_KERNEL_IMPL'),
    kernelFactory: toAddress(
      getRequiredEnv('VITE_MAINNET_MAINNET_KERNEL_FACTORY'),
      'VITE_MAINNET_MAINNET_KERNEL_FACTORY'
    ),
    multichainValidator: toAddress(
      getRequiredEnv('VITE_MAINNET_MAINNET_MULTICHAIN_VALIDATOR'),
      'VITE_MAINNET_MAINNET_MULTICHAIN_VALIDATOR'
    ),
    metaFactory: toAddress(getRequiredEnv('VITE_MAINNET_MAINNET_META_FACTORY'), 'VITE_MAINNET_MAINNET_META_FACTORY')
  };

  const baseContracts: AccountAbstractionContracts = {
    kernelImpl: toAddress(getRequiredEnv('VITE_MAINNET_BASE_KERNEL_IMPL'), 'VITE_MAINNET_BASE_KERNEL_IMPL'),
    kernelFactory: toAddress(getRequiredEnv('VITE_MAINNET_BASE_KERNEL_FACTORY'), 'VITE_MAINNET_BASE_KERNEL_FACTORY'),
    multichainValidator: toAddress(
      getRequiredEnv('VITE_MAINNET_BASE_MULTICHAIN_VALIDATOR'),
      'VITE_MAINNET_BASE_MULTICHAIN_VALIDATOR'
    ),
    metaFactory: toAddress(getRequiredEnv('VITE_MAINNET_BASE_META_FACTORY'), 'VITE_MAINNET_BASE_META_FACTORY')
  };

  const mainnetRpc = toHttpUrl(getRequiredEnv('VITE_MAINNET_RPC_MAINNET'), 'VITE_MAINNET_RPC_MAINNET');
  const baseRpc = toHttpUrl(getRequiredEnv('VITE_MAINNET_RPC_BASE'), 'VITE_MAINNET_RPC_BASE');

  const singleToken = resolveSingleToken({
    addressKey: 'VITE_MAINNET_TOKEN_ADDRESS',
    decimalsKey: 'VITE_MAINNET_TOKEN_DECIMALS',
    symbolKey: 'VITE_MAINNET_TOKEN_SYMBOL',
    defaultSymbol: 'TOKEN',
    defaultDecimals: 18
  });
  if (!singleToken) {
    throw new Error(
      'Missing mainnet token config. Define VITE_MAINNET_TOKEN_ADDRESS (and optionally VITE_MAINNET_TOKEN_DECIMALS / VITE_MAINNET_TOKEN_SYMBOL).'
    );
  }

  const paymasterByChainId = resolvePaymasterByChainId({
    defaultEndpointKey: 'VITE_MAINNET_PAYMASTER_URL',
    chainAEndpointKey: 'VITE_MAINNET_MAINNET_PAYMASTER_URL',
    chainBEndpointKey: 'VITE_MAINNET_BASE_PAYMASTER_URL',
    baseEndpointKey: 'VITE_MAINNET_PAYMASTER_BASE_URL',
    chainARouteNameKey: 'VITE_MAINNET_MAINNET_PAYMASTER_NAME',
    chainBRouteNameKey: 'VITE_MAINNET_BASE_PAYMASTER_NAME',
    chainARouteNameDefault: 'mainnet',
    chainBRouteNameDefault: 'base',
    chainAId: mainnet.id,
    chainBId: base.id
  });

  return {
    mode: 'mainnet',
    label: getEnv('VITE_MAINNET_LABEL') ?? 'Ethera Mainnet (Custom RPC)',
    chains: [mainnet, base],
    rpcByChainId: {
      [mainnet.id]: mainnetRpc,
      [base.id]: baseRpc
    },
    bridgeAddress: toAddress(getRequiredEnv('VITE_MAINNET_BRIDGE'), 'VITE_MAINNET_BRIDGE'),
    accountAbstractionContracts: {
      [mainnet.id]: mainnetContracts,
      [base.id]: baseContracts
    },
    tokens: [singleToken],
    paymasterByChainId
  };
};

const NETWORK_MODE = getEnv('VITE_COMPOSE_NETWORK') === 'mainnet' ? 'mainnet' : 'testnet';

/**
 * Selects active network mode and returns the corresponding runtime profile.
 */
export const createNetworkProfile = (): NetworkProfile =>
  NETWORK_MODE === 'mainnet' ? createMainnetProfile() : createTestnetProfile();
