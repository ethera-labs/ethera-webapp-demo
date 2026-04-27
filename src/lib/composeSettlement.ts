import { buildProveWithdrawal, type BuildProveWithdrawalReturnType, type GetWithdrawalsReturnType } from 'viem/op-stack';
import { ContractFunctionRevertedError, decodeAbiParameters, type PublicClient } from 'viem';

export type ComposeWithdrawalStatus =
  | 'waiting-to-prove'
  | 'ready-to-prove'
  | 'waiting-to-finalize'
  | 'ready-to-finalize'
  | 'finalized';

type BasicWithdrawal = {
  sender: `0x${string}`;
  withdrawalHash: `0x${string}`;
};

type Withdrawal = GetWithdrawalsReturnType[number];

type OutputRootProof = BuildProveWithdrawalReturnType['outputRootProof'];
type WithdrawalProof = BuildProveWithdrawalReturnType['withdrawalProof'];
type ProveableWithdrawal = BuildProveWithdrawalReturnType['withdrawal'];

type SuperRootProof = {
  version: `0x${string}`;
  timestamp: bigint;
  outputRoots: {
    chainId: bigint;
    root: `0x${string}`;
  }[];
};

type RawComposeGame = {
  index: bigint;
  metadata: `0x${string}`;
  timestamp: bigint;
  rootClaim: `0x${string}`;
  extraData: `0x${string}`;
};

type DecodedPerChainOutput = {
  index: bigint;
  chainId: bigint;
  l2BlockNumber: bigint;
  root: `0x${string}`;
};

export type ComposeGameForProve = {
  index: bigint;
  metadata: `0x${string}`;
  timestamp: bigint;
  rootClaim: `0x${string}`;
  extraData: `0x${string}`;
  l2BlockNumber: bigint;
};

export type ComposeWithdrawalStatusResult = {
  status: ComposeWithdrawalStatus;
  game?: ComposeGameForProve;
  proofSubmitter?: `0x${string}`;
};

export type ComposeProveWithdrawalArgs = {
  withdrawal: ProveableWithdrawal;
  disputeGameProxy: `0x${string}`;
  outputRootIndex: bigint;
  superRootProof: SuperRootProof;
  outputRootProof: OutputRootProof;
  withdrawalProof: WithdrawalProof;
};

const GAME_SCAN_LIMIT = 50n;

const disputeGameFactoryAbi = [
  {
    type: 'function',
    name: 'gameCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'findLatestGames',
    stateMutability: 'view',
    inputs: [{ type: 'uint32' }, { type: 'uint256' }, { type: 'uint256' }],
    outputs: [
      {
        components: [
          { name: 'index', type: 'uint256' },
          { name: 'metadata', type: 'bytes32' },
          { name: 'timestamp', type: 'uint64' },
          { name: 'rootClaim', type: 'bytes32' },
          { name: 'extraData', type: 'bytes' }
        ],
        type: 'tuple[]'
      }
    ]
  },
  {
    type: 'function',
    name: 'gameAtIndex',
    stateMutability: 'view',
    inputs: [{ type: 'uint256' }],
    outputs: [{ type: 'uint32' }, { type: 'uint64' }, { type: 'address' }]
  }
] as const;

const portalStatusAbi = [
  {
    type: 'function',
    name: 'respectedGameType',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint32' }]
  },
  {
    type: 'function',
    name: 'finalizedWithdrawals',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }],
    outputs: [{ type: 'bool' }]
  },
  {
    type: 'function',
    name: 'numProofSubmitters',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'proofSubmitters',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'uint256' }],
    outputs: [{ type: 'address' }]
  },
  {
    type: 'function',
    name: 'provenWithdrawals',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'address' }],
    outputs: [{ type: 'address', name: 'disputeGameProxy' }, { type: 'uint64', name: 'timestamp' }]
  },
  {
    type: 'function',
    name: 'checkWithdrawal',
    stateMutability: 'view',
    inputs: [{ type: 'bytes32' }, { type: 'address' }],
    outputs: []
  },
  {
    type: 'function',
    name: 'proofMaturityDelaySeconds',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'superRootsActive',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'bool' }]
  }
] as const;

const decodeComposeOutputs = (
  extraData: `0x${string}`
): { superRootProof: SuperRootProof; perChainOutputs: DecodedPerChainOutput[] } => {
  const [aggregationOutputs, superRootProof] = decodeAbiParameters(
    [
      {
        type: 'tuple',
        components: [
          { name: 'superblockNumber', type: 'uint256' },
          { name: 'parentSuperblockBatchHash', type: 'bytes32' },
          {
            name: 'bootInfo',
            type: 'tuple[]',
            components: [
              { name: 'l1Head', type: 'bytes32' },
              { name: 'l2PreRoot', type: 'bytes32' },
              { name: 'l2PostRoot', type: 'bytes32' },
              { name: 'l2BlockNumber', type: 'uint64' },
              { name: 'rollupConfigHash', type: 'bytes32' }
            ]
          }
        ]
      },
      {
        type: 'tuple',
        components: [
          { name: 'version', type: 'bytes1' },
          { name: 'timestamp', type: 'uint64' },
          {
            name: 'outputRoots',
            type: 'tuple[]',
            components: [
              { name: 'chainId', type: 'uint256' },
              { name: 'root', type: 'bytes32' }
            ]
          }
        ]
      },
      { type: 'bytes' }
    ],
    extraData
  );

  const outputCount = Math.min(aggregationOutputs.bootInfo.length, superRootProof.outputRoots.length);
  const perChainOutputs: DecodedPerChainOutput[] = [];

  for (let index = 0; index < outputCount; index += 1) {
    perChainOutputs.push({
      index: BigInt(index),
      chainId: superRootProof.outputRoots[index].chainId,
      l2BlockNumber: BigInt(aggregationOutputs.bootInfo[index].l2BlockNumber),
      root: superRootProof.outputRoots[index].root
    });
  }

  return {
    superRootProof: {
      version: superRootProof.version,
      timestamp: BigInt(superRootProof.timestamp),
      outputRoots: superRootProof.outputRoots.map((outputRoot) => ({
        chainId: outputRoot.chainId,
        root: outputRoot.root
      }))
    },
    perChainOutputs
  };
};

const extractCheckWithdrawalStatus = (error: unknown): ComposeWithdrawalStatus | undefined => {
  const revertedError =
    error instanceof ContractFunctionRevertedError
      ? error
      : error instanceof Error && error.cause instanceof ContractFunctionRevertedError
        ? error.cause
        : undefined;

  if (!revertedError) return undefined;

  const candidates = [
    revertedError.data?.errorName,
    typeof revertedError.data?.args?.[0] === 'string' ? revertedError.data.args[0] : undefined
  ].filter((value): value is string => Boolean(value));

  const readyToProveReasons = new Set([
    'OptimismPortal: invalid game type',
    'OptimismPortal: withdrawal has not been proven yet',
    'OptimismPortal: withdrawal has not been proven by proof submitter address yet',
    'OptimismPortal: dispute game created before respected game type was updated',
    'InvalidGameType',
    'LegacyGame',
    'Unproven',
    'OptimismPortal_Unproven',
    'OptimismPortal_InvalidProofTimestamp',
    'OptimismPortal_InvalidRootClaim'
  ]);

  const waitingToFinalizeReasons = new Set([
    'OptimismPortal: proven withdrawal has not matured yet',
    'OptimismPortal: output proposal has not been finalized yet',
    'OptimismPortal: output proposal in air-gap',
    'OptimismPortal_ProofNotOldEnough'
  ]);

  if (candidates.some((reason) => readyToProveReasons.has(reason))) {
    return 'ready-to-prove';
  }

  if (candidates.some((reason) => waitingToFinalizeReasons.has(reason))) {
    return 'waiting-to-finalize';
  }

  return undefined;
};

const getLatestComposeGames = async ({
  l1PublicClient,
  portalAddress,
  disputeGameFactoryAddress
}: {
  l1PublicClient: Pick<PublicClient, 'readContract'>;
  portalAddress: `0x${string}`;
  disputeGameFactoryAddress: `0x${string}`;
}): Promise<readonly RawComposeGame[]> => {
  const [respectedGameType, gameCount] = await Promise.all([
    l1PublicClient.readContract({
      address: portalAddress,
      abi: portalStatusAbi,
      functionName: 'respectedGameType'
    }),
    l1PublicClient.readContract({
      address: disputeGameFactoryAddress,
      abi: disputeGameFactoryAbi,
      functionName: 'gameCount'
    })
  ]);

  if (gameCount === 0n) return [];

  const limit = gameCount < GAME_SCAN_LIMIT ? gameCount : GAME_SCAN_LIMIT;
  const startIndex = gameCount - 1n;

  return (await l1PublicClient.readContract({
    address: disputeGameFactoryAddress,
    abi: disputeGameFactoryAbi,
    functionName: 'findLatestGames',
    args: [respectedGameType, startIndex, limit]
  })) as readonly RawComposeGame[];
};

export const findComposeGameForWithdrawal = async ({
  l1PublicClient,
  portalAddress,
  disputeGameFactoryAddress,
  sourceChainId,
  withdrawalL2BlockNumber
}: {
  l1PublicClient: Pick<PublicClient, 'readContract'>;
  portalAddress: `0x${string}`;
  disputeGameFactoryAddress: `0x${string}`;
  sourceChainId: number;
  withdrawalL2BlockNumber: bigint;
}): Promise<ComposeGameForProve | null> => {
  const games = await getLatestComposeGames({
    l1PublicClient,
    portalAddress,
    disputeGameFactoryAddress
  });

  for (const game of games) {
    const { perChainOutputs } = decodeComposeOutputs(game.extraData);
    const sourceChainOutput = perChainOutputs.find((output) => output.chainId === BigInt(sourceChainId));

    if (!sourceChainOutput) {
      continue;
    }

    if (sourceChainOutput.l2BlockNumber > withdrawalL2BlockNumber) {
      return {
        index: game.index,
        metadata: game.metadata,
        timestamp: game.timestamp,
        rootClaim: game.rootClaim,
        extraData: game.extraData,
        l2BlockNumber: sourceChainOutput.l2BlockNumber
      };
    }
  }

  return null;
};

const assertSuperRootPortal = async ({
  l1PublicClient,
  portalAddress
}: {
  l1PublicClient: Pick<PublicClient, 'readContract'>;
  portalAddress: `0x${string}`;
}): Promise<void> => {
  const superRootsActive = await l1PublicClient.readContract({
    address: portalAddress,
    abi: portalStatusAbi,
    functionName: 'superRootsActive'
  });

  if (!superRootsActive) {
    throw new Error('Configured portal is not using super-root proving. This app only supports the universal bridge settlement path.');
  }
};

const resolveComposeGameProxy = async ({
  l1PublicClient,
  disputeGameFactoryAddress,
  gameIndex
}: {
  l1PublicClient: Pick<PublicClient, 'readContract'>;
  disputeGameFactoryAddress: `0x${string}`;
  gameIndex: bigint;
}): Promise<`0x${string}`> => {
  const [, , proxyAddress] = await l1PublicClient.readContract({
    address: disputeGameFactoryAddress,
    abi: disputeGameFactoryAbi,
    functionName: 'gameAtIndex',
    args: [gameIndex]
  });

  if (!proxyAddress || /^0x0{40}$/i.test(proxyAddress)) {
    throw new Error(`Could not resolve dispute game proxy for game index ${gameIndex}.`);
  }

  return proxyAddress;
};

export const buildComposeProveWithdrawalArgs = async ({
  sourcePublicClient,
  l1PublicClient,
  portalAddress,
  disputeGameFactoryAddress,
  sourceChainId,
  game,
  withdrawal,
  withdrawalL2BlockNumber
}: {
  sourcePublicClient: unknown;
  l1PublicClient: Pick<PublicClient, 'readContract'>;
  portalAddress: `0x${string}`;
  disputeGameFactoryAddress: `0x${string}`;
  sourceChainId: number;
  game?: ComposeGameForProve;
  withdrawal: Withdrawal;
  withdrawalL2BlockNumber: bigint;
}): Promise<ComposeProveWithdrawalArgs> => {
  const [, resolvedGame] = await Promise.all([
    assertSuperRootPortal({
      l1PublicClient,
      portalAddress
    }),
    game
      ? Promise.resolve(game)
      : findComposeGameForWithdrawal({
          l1PublicClient,
          portalAddress,
          disputeGameFactoryAddress,
          sourceChainId,
          withdrawalL2BlockNumber
        })
  ]);

  if (!resolvedGame) {
    throw new Error('Could not resolve an eligible Compose dispute game for this withdrawal yet.');
  }

  const proveArgs = await buildProveWithdrawal(sourcePublicClient as never, {
    game: {
      index: resolvedGame.index,
      l2BlockNumber: resolvedGame.l2BlockNumber
    },
    withdrawal
  } as never);

  const { superRootProof, perChainOutputs } = decodeComposeOutputs(resolvedGame.extraData);
  const outputRoot = perChainOutputs.find((output) => output.chainId === BigInt(sourceChainId));

  if (!outputRoot) {
    throw new Error(`Could not find source-chain output root for chain ${sourceChainId}.`);
  }

  const disputeGameProxy = await resolveComposeGameProxy({
    l1PublicClient,
    disputeGameFactoryAddress,
    gameIndex: resolvedGame.index
  });

  return {
    withdrawal: proveArgs.withdrawal,
    disputeGameProxy,
    outputRootIndex: outputRoot.index,
    superRootProof,
    outputRootProof: proveArgs.outputRootProof,
    withdrawalProof: proveArgs.withdrawalProof
  };
};

export const getLatestProofSubmitter = async ({
  l1PublicClient,
  portalAddress,
  withdrawalHash
}: {
  l1PublicClient: Pick<PublicClient, 'readContract'>;
  portalAddress: `0x${string}`;
  withdrawalHash: `0x${string}`;
}): Promise<`0x${string}` | null> => {
  const numProofSubmitters = await l1PublicClient.readContract({
    address: portalAddress,
    abi: portalStatusAbi,
    functionName: 'numProofSubmitters',
    args: [withdrawalHash]
  });

  if (numProofSubmitters === 0n) {
    return null;
  }

  return l1PublicClient.readContract({
    address: portalAddress,
    abi: portalStatusAbi,
    functionName: 'proofSubmitters',
    args: [withdrawalHash, numProofSubmitters - 1n]
  });
};

export const getComposeWithdrawalStatus = async ({
  l1PublicClient,
  portalAddress,
  disputeGameFactoryAddress,
  sourceChainId,
  withdrawal,
  withdrawalL2BlockNumber
}: {
  l1PublicClient: Pick<PublicClient, 'readContract'>;
  portalAddress: `0x${string}`;
  disputeGameFactoryAddress: `0x${string}`;
  sourceChainId: number;
  withdrawal: BasicWithdrawal;
  withdrawalL2BlockNumber: bigint;
}): Promise<ComposeWithdrawalStatusResult> => {
  await assertSuperRootPortal({
    l1PublicClient,
    portalAddress
  });

  const finalized = await l1PublicClient.readContract({
    address: portalAddress,
    abi: portalStatusAbi,
    functionName: 'finalizedWithdrawals',
    args: [withdrawal.withdrawalHash]
  });

  if (finalized) {
    return { status: 'finalized' };
  }

  const latestProofSubmitter = await getLatestProofSubmitter({
    l1PublicClient,
    portalAddress,
    withdrawalHash: withdrawal.withdrawalHash
  });

  if (latestProofSubmitter) {
    const [, proveTimestamp] = await l1PublicClient.readContract({
      address: portalAddress,
      abi: portalStatusAbi,
      functionName: 'provenWithdrawals',
      args: [withdrawal.withdrawalHash, latestProofSubmitter]
    });

    if (proveTimestamp > 0n) {
      try {
        await l1PublicClient.readContract({
          address: portalAddress,
          abi: portalStatusAbi,
          functionName: 'checkWithdrawal',
          args: [withdrawal.withdrawalHash, latestProofSubmitter]
        });

        return { status: 'ready-to-finalize', proofSubmitter: latestProofSubmitter };
      } catch (error) {
        const checkStatus = extractCheckWithdrawalStatus(error);
        if (checkStatus) {
          return { status: checkStatus, proofSubmitter: latestProofSubmitter };
        }
      }

      const proofMaturityDelaySeconds = await l1PublicClient.readContract({
        address: portalAddress,
        abi: portalStatusAbi,
        functionName: 'proofMaturityDelaySeconds'
      });

      const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
      const maturityTime = BigInt(proveTimestamp) + proofMaturityDelaySeconds;

      return {
        status: nowSeconds < maturityTime ? 'waiting-to-finalize' : 'ready-to-finalize',
        proofSubmitter: latestProofSubmitter
      };
    }
  }

  const game = await findComposeGameForWithdrawal({
    l1PublicClient,
    portalAddress,
    disputeGameFactoryAddress,
    sourceChainId,
    withdrawalL2BlockNumber
  });

  if (!game) {
    return { status: 'waiting-to-prove' };
  }

  return {
    status: 'ready-to-prove',
    game
  };
};
