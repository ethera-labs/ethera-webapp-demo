import { parseEther, parseUnits } from 'viem';
import type { DemoToken, DemoTokenKind } from '../config/types';

type TokenIdentity = Pick<DemoToken, 'kind' | 'address'>;

/**
 * Creates a stable picker/storage value for an asset token.
 */
export const getAssetValue = ({ kind, address }: TokenIdentity) => `${kind}:${address.toLowerCase()}`;

/**
 * Parses a token amount input and returns only positive values.
 */
export const parsePositiveAssetAmountInput = ({
  amountInput,
  tokenKind,
  tokenDecimals
}: {
  amountInput: string;
  tokenKind: DemoTokenKind;
  tokenDecimals: number;
}): bigint | undefined => {
  const trimmedAmountInput = amountInput.trim();
  if (!trimmedAmountInput) return undefined;

  try {
    const amountWei =
      tokenKind === 'nativeEthViaWeth'
        ? parseEther(trimmedAmountInput)
        : parseUnits(trimmedAmountInput, tokenDecimals);

    return amountWei > 0n ? amountWei : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Deduplicates ERC-20 tokens by canonical address, keeping the latest entry.
 */
export const dedupeErc20TokensByAddress = (tokens: readonly DemoToken[]): DemoToken[] => {
  const tokenByAddress = new Map<string, DemoToken>();

  for (const token of tokens) {
    if (token.kind !== 'erc20') continue;
    tokenByAddress.set(token.address.toLowerCase(), token);
  }

  return [...tokenByAddress.values()];
};
