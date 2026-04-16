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

export const l1StandardBridgeAbi = standardBridgeEthAbi;
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
