import { erc20Abi } from 'viem';
import { erc20Encoder } from '../../lib/bridge';
import { resolveCetFactoryAddressFromL2Bridge, resolvePredictedCetAddress } from '../../lib/l1Bridge';
import { toUniversalBridgeMessageHeader, universalL2ToL2BridgeEncoder } from '../../lib/universalL2L2Bridge';
import type { BridgeMessageLabel } from '../../types/bridge';
import type {
  BridgeCall,
  BuildBridgeCallsParams,
  SourceFundingContext,
  SourceTokenBridgeMode,
  SmartAccountData
} from './types';

const composableErc20IntrospectionAbi = [
  {
    type: 'function',
    name: 'supportsInterface',
    stateMutability: 'view',
    inputs: [{ name: 'interfaceId', type: 'bytes4' }],
    outputs: [{ name: '', type: 'bool' }]
  }
] as const;

const COMPOSABLE_ERC20_INTERFACE_ID = '0x8387278f' as const;
const CORE_CET_TYPE = 0;

const composableErc20RemoteIdentityAbi = [
  {
    type: 'function',
    name: 'remoteAsset',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }]
  },
  {
    type: 'function',
    name: 'remoteChainID',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }]
  }
] as const;

const composableErc20TypeAbi = [
  {
    type: 'function',
    name: 'cetType',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }]
  }
] as const;

// User-op call construction and source-funding context helpers.
/**
 * Loads source-chain token balances/allowance needed to decide EOA pull + approval behavior.
 */
export const loadSourceFundingContext = async ({
  sourceSmart,
  selectedToken,
  sender,
  walletAddress,
  amount
}: {
  sourceSmart: SmartAccountData;
  selectedToken: BuildBridgeCallsParams['selectedToken'];
  sender: `0x${string}`;
  walletAddress: `0x${string}`;
  amount: bigint;
}): Promise<SourceFundingContext> => {
  // ETH mode uses native balances because bridgeEthTo is payable from the source smart account.
  if (selectedToken.kind === 'nativeEthViaWeth') {
    const [sourceSmartNativeBalance, sourceEoaNativeBalance] = await Promise.all([
      sourceSmart.publicClient.getBalance({ address: sender }),
      sourceSmart.publicClient.getBalance({ address: walletAddress })
    ]);

    const sourceTotalBalanceOnChain = sourceSmartNativeBalance + sourceEoaNativeBalance;
    const amountToFundSmartAccountFromEoa = amount > sourceSmartNativeBalance ? amount - sourceSmartNativeBalance : 0n;

    return {
      kind: 'nativeEthViaWeth',
      sourceTotalBalanceOnChain,
      amountToFundSmartAccountFromEoa
    };
  }

  const [sourceSmartBalanceOnChain, sourceEoaBalanceOnChain] = await Promise.all([
    sourceSmart.publicClient.readContract({
      address: selectedToken.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [sender]
    }),
    sourceSmart.publicClient.readContract({
      address: selectedToken.address,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [walletAddress]
    })
  ]);

  const sourceTotalBalanceOnChain = sourceSmartBalanceOnChain + sourceEoaBalanceOnChain;
  const amountToPullFromEoa = amount > sourceSmartBalanceOnChain ? amount - sourceSmartBalanceOnChain : 0n;

  const sourceAllowance =
    amountToPullFromEoa > 0n
      ? await sourceSmart.publicClient.readContract({
          address: selectedToken.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [walletAddress, sender]
        })
      : 0n;

  return {
    kind: 'erc20',
    sourceTotalBalanceOnChain,
    amountToPullFromEoa,
    sourceAllowance
  };
};

/**
 * Detects whether the selected source token should use CET bridge mode or plain ERC20 mode.
 */
export const resolveSourceTokenBridgeMode = async ({
  sourceSmart,
  selectedToken
}: {
  sourceSmart: SmartAccountData;
  selectedToken: BuildBridgeCallsParams['selectedToken'];
}): Promise<SourceTokenBridgeMode> => {
  if (selectedToken.kind === 'nativeEthViaWeth') {
    return 'erc20';
  }

  const configuredMode = selectedToken.bridgeMode;
  const tokenCode = await sourceSmart.publicClient.getCode({ address: selectedToken.address });
  if (!tokenCode || tokenCode === '0x') {
    return configuredMode ?? 'erc20';
  }

  try {
    const isComposableToken = await sourceSmart.publicClient.readContract({
      address: selectedToken.address,
      abi: composableErc20IntrospectionAbi,
      functionName: 'supportsInterface',
      args: [COMPOSABLE_ERC20_INTERFACE_ID]
    });

    return isComposableToken ? 'cet' : 'erc20';
  } catch {
    return configuredMode ?? 'erc20';
  }
};

/**
 * Resolves the token address that receiveTokens will credit on destination.
 */
export const resolveDestinationPayoutTokenAddress = async ({
  sourceSmart,
  destinationSmart,
  selectedToken,
  sourceTokenBridgeMode,
  sourceChainId,
  destinationChainId,
  universalBridgeAddress
}: {
  sourceSmart: SmartAccountData;
  destinationSmart: SmartAccountData;
  selectedToken: BuildBridgeCallsParams['selectedToken'];
  sourceTokenBridgeMode: SourceTokenBridgeMode;
  sourceChainId: number;
  destinationChainId: number;
  universalBridgeAddress: `0x${string}`;
}): Promise<`0x${string}`> => {
  if (selectedToken.kind === 'nativeEthViaWeth') {
    return selectedToken.address;
  }

  const resolveRemotePayloadIdentity = async (): Promise<{
    remoteAsset: `0x${string}`;
    remoteChainId: number;
  }> => {
    if (sourceTokenBridgeMode !== 'cet') {
      return {
        remoteAsset: selectedToken.address,
        remoteChainId: sourceChainId
      };
    }

    const [remoteAsset, remoteChainID] = await Promise.all([
      sourceSmart.publicClient.readContract({
        address: selectedToken.address,
        abi: composableErc20RemoteIdentityAbi,
        functionName: 'remoteAsset'
      }),
      sourceSmart.publicClient.readContract({
        address: selectedToken.address,
        abi: composableErc20RemoteIdentityAbi,
        functionName: 'remoteChainID'
      })
    ]);

    return {
      remoteAsset,
      remoteChainId: Number(remoteChainID)
    };
  };

  const { remoteAsset, remoteChainId } = await resolveRemotePayloadIdentity();
  if (remoteChainId === destinationChainId) {
    return remoteAsset;
  }

  const remoteAssetCode = await destinationSmart.publicClient.getCode({ address: remoteAsset });
  if (remoteAssetCode && remoteAssetCode !== '0x') {
    try {
      const cetType = await destinationSmart.publicClient.readContract({
        address: remoteAsset,
        abi: composableErc20TypeAbi,
        functionName: 'cetType'
      });

      if (cetType === CORE_CET_TYPE) {
        return remoteAsset;
      }
    } catch {
      // Non-CET contracts revert on cetType(); fallback to wrapped CET prediction.
    }
  }

  const cetFactoryAddress = await resolveCetFactoryAddressFromL2Bridge({
    l2PublicClient: destinationSmart.publicClient,
    l2BridgeAddress: universalBridgeAddress
  });

  return resolvePredictedCetAddress({
    l2PublicClient: destinationSmart.publicClient,
    cetFactoryAddress,
    remoteAsset,
    remoteChainId
  });
};

/**
 * Builds source and destination call bundles that are later turned into user operations.
 */
export const buildBridgeCalls = ({
  selectedToken,
  walletAddress,
  sender,
  receiver,
  destinationEoaReceiver,
  destinationPayoutTokenAddress,
  universalBridgeAddress,
  sourceChainId,
  destinationChainId,
  amount,
  sessionId,
  amountToPullFromEoa,
  sourceTokenBridgeMode
}: BuildBridgeCallsParams): { sourceCalls: BridgeCall[]; destinationCalls: BridgeCall[] } => {
  // Select universal source method for ERC20 mode; composable CET tokens use bridgeCETTo.
  const resolveTokenSourceMethod = () =>
    sourceTokenBridgeMode === 'cet'
      ? universalL2ToL2BridgeEncoder.bridgeCETTo({
          chainDest: BigInt(destinationChainId),
          cetTokenSrc: selectedToken.address,
          amount,
          receiver,
          sessionId
        })
      : universalL2ToL2BridgeEncoder.bridgeERC20To({
          chainDest: BigInt(destinationChainId),
          tokenSrc: selectedToken.address,
          amount,
          receiver,
          sessionId
        });

  // Build deterministic mailbox header in compose phase so destination receive call can be prepared before source execution.
  const buildMessageHeader = (label: BridgeMessageLabel) =>
    toUniversalBridgeMessageHeader({
      chainSrc: BigInt(sourceChainId),
      chainDest: BigInt(destinationChainId),
      sender: universalBridgeAddress,
      receiver,
      sessionId,
      label
    });

  // Build source + destination bundles for one composed payload (source bridge + destination receive + optional EOA transfer).
  if (selectedToken.kind === 'nativeEthViaWeth') {
    const sourceCalls: BridgeCall[] = [
      {
        to: universalBridgeAddress,
        value: amount,
        data: universalL2ToL2BridgeEncoder.bridgeEthTo({
          sessionId,
          chainDest: BigInt(destinationChainId),
          receiver
        })
      }
    ];

    const destinationCalls: BridgeCall[] = [
      {
        to: universalBridgeAddress,
        value: 0n,
        data: universalL2ToL2BridgeEncoder.receiveETH({
          msgHeader: buildMessageHeader('SEND_ETH')
        })
      },
      {
        to: destinationEoaReceiver,
        value: amount,
        data: '0x'
      }
    ];

    return { sourceCalls, destinationCalls };
  }

  const sourceCalls: BridgeCall[] = [
    ...(amountToPullFromEoa > 0n
      ? [
          {
            to: selectedToken.address,
            value: 0n,
            data: erc20Encoder.transferFrom({
              sender: walletAddress,
              recipient: sender,
              amount: amountToPullFromEoa
            })
          }
        ]
      : []),
    {
      to: selectedToken.address,
      value: 0n,
      data: erc20Encoder.approve({
        spender: universalBridgeAddress,
        amount
      })
    },
    {
      to: universalBridgeAddress,
      value: 0n,
      data: resolveTokenSourceMethod()
    }
  ];

  const destinationCalls: BridgeCall[] = [
    {
      to: universalBridgeAddress,
      value: 0n,
      data: universalL2ToL2BridgeEncoder.receiveTokens({
        msgHeader: buildMessageHeader('SEND_TOKENS')
      })
    },
    {
      to: destinationPayoutTokenAddress,
      value: 0n,
      data: erc20Encoder.transfer({
        recipient: destinationEoaReceiver,
        amount
      })
    }
  ];

  return { sourceCalls, destinationCalls };
};
