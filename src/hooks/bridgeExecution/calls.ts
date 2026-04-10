import { erc20Abi } from 'viem';
import { bridgeEncoder, erc20Encoder } from '../../lib/bridge';
import type { BridgeCall, BuildBridgeCallsParams, SourceFundingContext, SmartAccountData } from './types';

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
    sourceTotalBalanceOnChain,
    amountToPullFromEoa,
    sourceAllowance
  };
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
  bridgeAddress,
  sourceChainId,
  destinationChainId,
  amount,
  sessionId,
  amountToPullFromEoa
}: BuildBridgeCallsParams): { sourceCalls: BridgeCall[]; destinationCalls: BridgeCall[] } => {
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
        spender: bridgeAddress,
        amount
      })
    },
    {
      to: bridgeAddress,
      value: 0n,
      data: bridgeEncoder.send({
        otherChainId: BigInt(destinationChainId),
        token: selectedToken.address,
        sender,
        receiver,
        amount,
        sessionId,
        destBridge: bridgeAddress
      })
    }
  ];

  const destinationCalls: BridgeCall[] = [
    {
      to: bridgeAddress,
      value: 0n,
      data: bridgeEncoder.receiveTokens({
        otherChainId: BigInt(sourceChainId),
        sender,
        receiver,
        sessionId,
        srcBridge: bridgeAddress
      })
    },
    {
      to: selectedToken.address,
      value: 0n,
      data: erc20Encoder.transfer({
        recipient: destinationEoaReceiver,
        amount
      })
    }
  ];

  return { sourceCalls, destinationCalls };
};
