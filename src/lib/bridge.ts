import { createAbiEncoder } from '@ssv-labs/compose-sdk';
import { erc20Abi } from 'viem';

export const bridgeAbi = [
  {
    type: 'function',
    name: 'send',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'otherChainId', type: 'uint256' },
      { name: 'token', type: 'address' },
      { name: 'sender', type: 'address' },
      { name: 'receiver', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'sessionId', type: 'uint256' },
      { name: 'destBridge', type: 'address' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'receiveTokens',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'otherChainId', type: 'uint256' },
      { name: 'sender', type: 'address' },
      { name: 'receiver', type: 'address' },
      { name: 'sessionId', type: 'uint256' },
      { name: 'srcBridge', type: 'address' }
    ],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ]
  }
] as const;

export const erc20Encoder = createAbiEncoder(erc20Abi);
export const bridgeEncoder = createAbiEncoder(bridgeAbi);
