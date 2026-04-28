import { createAbiEncoder } from '@ssv-labs/ethera-sdk';
import { erc20Abi } from 'viem';

export const erc20Encoder = createAbiEncoder(erc20Abi);
