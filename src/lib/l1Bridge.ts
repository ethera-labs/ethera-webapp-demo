export const l1StandardBridgeAbi = [
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

