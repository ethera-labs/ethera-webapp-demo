import type { PublicClient } from 'viem';

// Structural subset used in place of Pick<PublicClient, 'readContract'> to stay compatible across viem minor bumps.
export type ContractReader = { readContract: PublicClient['readContract'] };
