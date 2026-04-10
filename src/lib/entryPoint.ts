export const entryPointAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }]
  },
  {
    type: 'function',
    name: 'depositTo',
    stateMutability: 'payable',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: []
  }
] as const;
