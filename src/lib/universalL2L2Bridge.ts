import { createAbiEncoder } from '@ssv-labs/ethera-sdk';
import type { BridgeMessageHeader } from '../types/bridge';

export const MESSAGE_NOT_FOUND_SELECTOR = '0x28915ac7';

export const universalL2ToL2BridgeAbi = [
  {
    type: 'function',
    name: 'bridgeCETTo',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'chainDest', type: 'uint256' },
      { name: 'cetTokenSrc', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'sessionId', type: 'uint256' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'bridgeERC20To',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'chainDest', type: 'uint256' },
      { name: 'tokenSrc', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'receiver', type: 'address' },
      { name: 'sessionId', type: 'uint256' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'bridgeEthTo',
    stateMutability: 'payable',
    inputs: [
      { name: 'sessionId', type: 'uint256' },
      { name: 'chainDest', type: 'uint256' },
      { name: 'receiver', type: 'address' }
    ],
    outputs: []
  },
  {
    type: 'function',
    name: 'receiveTokens',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'msgHeader',
        type: 'tuple',
        components: [
          { name: 'chainSrc', type: 'uint256' },
          { name: 'chainDest', type: 'uint256' },
          { name: 'sender', type: 'address' },
          { name: 'receiver', type: 'address' },
          { name: 'sessionId', type: 'uint256' },
          { name: 'label', type: 'string' }
        ]
      }
    ],
    outputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ]
  },
  {
    type: 'function',
    name: 'receiveETH',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'msgHeader',
        type: 'tuple',
        components: [
          { name: 'chainSrc', type: 'uint256' },
          { name: 'chainDest', type: 'uint256' },
          { name: 'sender', type: 'address' },
          { name: 'receiver', type: 'address' },
          { name: 'sessionId', type: 'uint256' },
          { name: 'label', type: 'string' }
        ]
      }
    ],
    outputs: [{ name: 'amount', type: 'uint256' }]
  },
  {
    type: 'event',
    name: 'TokensSendQueued',
    anonymous: false,
    inputs: [
      { name: 'chainDest', type: 'uint256', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'receiver', type: 'address', indexed: true },
      { name: 'remoteAsset', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'sessionId', type: 'uint256', indexed: false },
      { name: 'messageId', type: 'bytes32', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'ETHBridged',
    anonymous: false,
    inputs: [
      { name: 'chainDest', type: 'uint256', indexed: true },
      { name: 'sender', type: 'address', indexed: true },
      { name: 'receiver', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'sessionId', type: 'uint256', indexed: false },
      { name: 'messageId', type: 'bytes32', indexed: false }
    ]
  },
  {
    type: 'event',
    name: 'MailboxWrite',
    anonymous: false,
    inputs: [
      { name: 'chainId', type: 'uint256', indexed: true },
      { name: 'account', type: 'address', indexed: true },
      { name: 'sessionId', type: 'uint256', indexed: true },
      { name: 'label', type: 'string', indexed: false }
    ]
  }
] as const;

export const universalL2ToL2BridgeEncoder = createAbiEncoder(universalL2ToL2BridgeAbi);

/**
 * Converts our stored message header into the exact tuple shape expected by receiveTokens/receiveETH.
 */
export const toUniversalBridgeMessageHeader = (messageHeader: BridgeMessageHeader) => ({
  chainSrc: messageHeader.chainSrc,
  chainDest: messageHeader.chainDest,
  sender: messageHeader.sender,
  receiver: messageHeader.receiver,
  sessionId: messageHeader.sessionId,
  label: messageHeader.label
});
