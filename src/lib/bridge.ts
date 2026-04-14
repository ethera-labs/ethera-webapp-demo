import { createAbiEncoder } from '@ssv-labs/ethera-sdk';
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

// WETH ABI used by ETH-mode bridge path to wrap before send and unwrap after receive.
export const wethAbi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [],
    outputs: []
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'wad', type: 'uint256' }],
    outputs: []
  }
] as const;

export const erc20Encoder = createAbiEncoder(erc20Abi);
export const bridgeEncoder = createAbiEncoder(bridgeAbi);
// Encoder for ETH-mode internal WETH calls in L2->L2 flow.
export const wethEncoder = createAbiEncoder(wethAbi);
