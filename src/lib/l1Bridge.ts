import type { PublicClient } from 'viem';

const isHexAddress = (value: unknown): value is `0x${string}` =>
  typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value);

const isZeroAddress = (value: `0x${string}`) => /^0x0{40}$/i.test(value);

export const standardBridgeEthAbi = [
  {
    type: 'function',
    name: 'bridgeETHTo',
    stateMutability: 'payable',
    inputs: [
      { name: '_to', type: 'address' },
      { name: '_minGasLimit', type: 'uint32' },
      { name: '_extraData', type: 'bytes' }
    ],
    outputs: []
  }
] as const;

export const standardBridgeErc20Abi = [
  {
    type: 'function',
    name: 'bridgeERC20To',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_localToken', type: 'address' },
      { name: '_remoteToken', type: 'address' },
      { name: '_to', type: 'address' },
      { name: '_amount', type: 'uint256' },
      { name: '_minGasLimit', type: 'uint32' },
      { name: '_extraData', type: 'bytes' }
    ],
    outputs: []
  }
] as const;

export const l1StandardBridgeAbi = [...standardBridgeEthAbi, ...standardBridgeErc20Abi] as const;
export const l2StandardBridgeAbi = standardBridgeEthAbi;

export const standardBridgeCounterpartAbi = [
  {
    type: 'function',
    name: 'otherBridge',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function',
    name: 'OTHER_BRIDGE',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  }
] as const;

export const l1BridgeMessengerAbi = [
  {
    type: 'function',
    name: 'messenger',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function',
    name: 'MESSENGER',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  }
] as const;

export const l1MessengerPortalAbi = [
  {
    type: 'function',
    name: 'portal',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function',
    name: 'PORTAL',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  }
] as const;

export const optimismPortalGameFactoryAbi = [
  {
    type: 'function',
    name: 'disputeGameFactory',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  }
] as const;

export const composeL2BridgeCetFactoryAbi = [
  {
    type: 'function',
    name: 'cetFactory',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  }
] as const;

export const cetFactoryPredictAddressAbi = [
  {
    type: 'function',
    name: 'predictAddress',
    stateMutability: 'view',
    inputs: [
      { name: 'remoteAsset', type: 'address' },
      { name: 'remoteChainID', type: 'uint256' }
    ],
    outputs: [{ name: '', type: 'address' }]
  }
] as const;

type StandardBridgeReadClient = Pick<PublicClient, 'readContract'>;

/**
 * Resolves the L2 bridge counterpart from an L1 bridge using canonical getter names.
 */
export const resolveL2BridgeAddressFromL1Bridge = async ({
  l1PublicClient,
  l1BridgeAddress
}: {
  l1PublicClient: StandardBridgeReadClient;
  l1BridgeAddress: `0x${string}`;
}): Promise<`0x${string}`> => {
  try {
    const bridgeAddress = await l1PublicClient.readContract({
      address: l1BridgeAddress,
      abi: standardBridgeCounterpartAbi,
      functionName: 'otherBridge'
    });

    if (isHexAddress(bridgeAddress)) {
      if (isZeroAddress(bridgeAddress)) {
        throw new Error(`L2 bridge counterpart for ${l1BridgeAddress} is zero address.`);
      }

      return bridgeAddress;
    }
  } catch {
    // Fallback to OTHER_BRIDGE below.
  }

  const bridgeAddress = await l1PublicClient.readContract({
    address: l1BridgeAddress,
    abi: standardBridgeCounterpartAbi,
    functionName: 'OTHER_BRIDGE'
  });

  if (!isHexAddress(bridgeAddress)) {
    throw new Error(`Could not resolve L2 bridge counterpart for L1 bridge ${l1BridgeAddress}.`);
  }

  if (isZeroAddress(bridgeAddress)) {
    throw new Error(`L2 bridge counterpart for ${l1BridgeAddress} is zero address.`);
  }

  return bridgeAddress;
};

/**
 * Resolves address getters that can differ by casing across bridge/messenger versions.
 */
const readAddressWithFallback = async ({
  publicClient,
  address,
  abi,
  primaryFunctionName,
  fallbackFunctionName
}: {
  publicClient: StandardBridgeReadClient;
  address: `0x${string}`;
  abi: readonly unknown[];
  primaryFunctionName: string;
  fallbackFunctionName?: string;
}): Promise<`0x${string}`> => {
  const readByName = async (functionName: string) =>
    publicClient.readContract({
      address,
      abi,
      functionName
    } as never);

  let resolved: unknown;
  try {
    resolved = await readByName(primaryFunctionName);
  } catch {
    if (!fallbackFunctionName) {
      throw new Error(`Could not call ${primaryFunctionName} on ${address}.`);
    }

    resolved = await readByName(fallbackFunctionName);
  }

  if (!isHexAddress(resolved)) {
    throw new Error(`Invalid address resolved via ${primaryFunctionName} on ${address}.`);
  }

  if (isZeroAddress(resolved)) {
    throw new Error(`Resolved zero address via ${primaryFunctionName} on ${address}.`);
  }

  return resolved;
};

export const resolveL1MessengerAddressFromL1Bridge = async ({
  l1PublicClient,
  l1BridgeAddress
}: {
  l1PublicClient: StandardBridgeReadClient;
  l1BridgeAddress: `0x${string}`;
}): Promise<`0x${string}`> =>
  readAddressWithFallback({
    publicClient: l1PublicClient,
    address: l1BridgeAddress,
    abi: l1BridgeMessengerAbi,
    primaryFunctionName: 'messenger',
    fallbackFunctionName: 'MESSENGER'
  });

export const resolveL1PortalAddressFromMessenger = async ({
  l1PublicClient,
  l1MessengerAddress
}: {
  l1PublicClient: StandardBridgeReadClient;
  l1MessengerAddress: `0x${string}`;
}): Promise<`0x${string}`> =>
  readAddressWithFallback({
    publicClient: l1PublicClient,
    address: l1MessengerAddress,
    abi: l1MessengerPortalAbi,
    primaryFunctionName: 'portal',
    fallbackFunctionName: 'PORTAL'
  });

export const resolveDisputeGameFactoryAddressFromPortal = async ({
  l1PublicClient,
  l1PortalAddress
}: {
  l1PublicClient: StandardBridgeReadClient;
  l1PortalAddress: `0x${string}`;
}): Promise<`0x${string}`> =>
  readAddressWithFallback({
    publicClient: l1PublicClient,
    address: l1PortalAddress,
    abi: optimismPortalGameFactoryAbi,
    primaryFunctionName: 'disputeGameFactory'
  });

export const resolveCetFactoryAddressFromL2Bridge = async ({
  l2PublicClient,
  l2BridgeAddress
}: {
  l2PublicClient: StandardBridgeReadClient;
  l2BridgeAddress: `0x${string}`;
}): Promise<`0x${string}`> =>
  readAddressWithFallback({
    publicClient: l2PublicClient,
    address: l2BridgeAddress,
    abi: composeL2BridgeCetFactoryAbi,
    primaryFunctionName: 'cetFactory'
  });

export const resolvePredictedCetAddress = async ({
  l2PublicClient,
  cetFactoryAddress,
  remoteAsset,
  remoteChainId
}: {
  l2PublicClient: StandardBridgeReadClient;
  cetFactoryAddress: `0x${string}`;
  remoteAsset: `0x${string}`;
  remoteChainId: number;
}): Promise<`0x${string}`> => {
  const predicted = await l2PublicClient.readContract({
    address: cetFactoryAddress,
    abi: cetFactoryPredictAddressAbi,
    functionName: 'predictAddress',
    args: [remoteAsset, BigInt(remoteChainId)]
  });

  if (!isHexAddress(predicted)) {
    throw new Error(`Invalid CET predicted address for ${remoteAsset} on chain ${remoteChainId}.`);
  }

  if (isZeroAddress(predicted)) {
    throw new Error(`Predicted CET address resolved to zero for ${remoteAsset} on chain ${remoteChainId}.`);
  }

  return predicted;
};
