import { createAbiEncoder } from '@ssv-labs/ethera-sdk';
import { erc20Abi, parseEventLogs, type Log } from 'viem';
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

/**
 * Extracts the universal mailbox message header from source bridge receipt logs.
 */
export const extractMessageHeaderFromBridgeReceipt = ({
  logs,
  sourceChainId,
  universalBridgeAddress,
  fallbackReceiver
}: {
  logs: Log[];
  sourceChainId: number;
  universalBridgeAddress: `0x${string}`;
  fallbackReceiver: `0x${string}`;
}): BridgeMessageHeader => {
  const queuedTokenEvents = parseEventLogs({
    abi: universalL2ToL2BridgeAbi,
    eventName: 'TokensSendQueued',
    logs,
    strict: false
  });
  const queuedEthEvents = parseEventLogs({
    abi: universalL2ToL2BridgeAbi,
    eventName: 'ETHBridged',
    logs,
    strict: false
  });

  const queuedEvent = queuedTokenEvents[0] ?? queuedEthEvents[0];
  if (!queuedEvent) {
    throw new Error('Could not extract universal bridge message from source transaction logs.');
  }

  const chainDest = queuedEvent.args.chainDest;
  const sessionId = queuedEvent.args.sessionId;
  if (chainDest === undefined || sessionId === undefined) {
    throw new Error('Universal bridge message is missing chain destination or session id.');
  }

  const mailboxWrites = parseEventLogs({
    abi: universalL2ToL2BridgeAbi,
    eventName: 'MailboxWrite',
    logs,
    strict: false
  });
  const mailboxWrite = mailboxWrites.find(
    (eventLog) => eventLog.args.chainId === chainDest && eventLog.args.sessionId === sessionId
  );
  const label = mailboxWrite?.args.label;
  if (label !== 'SEND_ETH' && label !== 'SEND_TOKENS') {
    throw new Error('Could not resolve universal bridge message label from source transaction logs.');
  }

  return {
    chainSrc: BigInt(sourceChainId),
    chainDest,
    sender: universalBridgeAddress,
    receiver: queuedEvent.args.receiver ?? fallbackReceiver,
    sessionId,
    label
  };
};

const extractErrorStrings = (value: unknown): string[] => {
  if (value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (typeof value !== 'object') return [];

  const record = value as Record<string, unknown>;
  return [
    ...extractErrorStrings(record.message),
    ...extractErrorStrings(record.shortMessage),
    ...extractErrorStrings(record.details),
    ...extractErrorStrings(record.data),
    ...extractErrorStrings(record.cause)
  ];
};

export const isMessageNotFoundError = (error: unknown): boolean => {
  const candidates = extractErrorStrings(error).map((entry) => entry.toLowerCase());
  return candidates.some(
    (entry) => entry.includes('messagenotfound') || entry.includes(MESSAGE_NOT_FOUND_SELECTOR)
  );
};

/**
 * Detects which ERC-20 was credited to receiver during receiveTokens execution.
 */
export const resolveReceivedTokenAddressFromReceipt = ({
  logs,
  receiver,
  expectedAmount
}: {
  logs: Log[];
  receiver: `0x${string}`;
  expectedAmount: bigint;
}): `0x${string}` | undefined => {
  const transferEvents = parseEventLogs({
    abi: erc20Abi,
    eventName: 'Transfer',
    logs,
    strict: false
  });

  const exactMatch = transferEvents.find(
    (eventLog) => eventLog.args.to?.toLowerCase() === receiver.toLowerCase() && eventLog.args.value === expectedAmount
  );
  if (exactMatch) {
    return exactMatch.address;
  }

  const fallbackMatch = transferEvents.find((eventLog) => eventLog.args.to?.toLowerCase() === receiver.toLowerCase());
  return fallbackMatch?.address;
};
