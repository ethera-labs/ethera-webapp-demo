import { formatUnits } from 'viem';

const formatIntegerPart = (value: string) => {
  const normalized = value.replace(/^0+(?=\d)/, '') || '0';
  return BigInt(normalized).toLocaleString();
};

const trimFraction = (fraction: string) => fraction.replace(/0+$/, '');

export const formatDecimalWithMaxFraction = (value: string, maxFractionDigits: number): string => {
  const [integerRaw, fractionRaw = ''] = value.split('.');
  const integerPart = formatIntegerPart(integerRaw);

  if (maxFractionDigits <= 0) return integerPart;

  const clippedFraction = trimFraction(fractionRaw.slice(0, maxFractionDigits));
  return clippedFraction ? `${integerPart}.${clippedFraction}` : integerPart;
};

export const formatUnitsWithMaxFraction = (
  amount: bigint,
  unitDecimals: number,
  maxFractionDigits: number
): string => formatDecimalWithMaxFraction(formatUnits(amount, unitDecimals), maxFractionDigits);

export const formatUnitsFixedFraction = (
  amount: bigint,
  unitDecimals: number,
  fractionDigits: number
): string => {
  const [integerRaw, fractionRaw = ''] = formatUnits(amount, unitDecimals).split('.');
  const integerPart = formatIntegerPart(integerRaw);

  if (fractionDigits <= 0) return integerPart;

  const paddedFraction = `${fractionRaw}${'0'.repeat(fractionDigits)}`.slice(0, fractionDigits);
  return `${integerPart}.${paddedFraction}`;
};

export const formatTokenAmount = (amount: bigint | undefined, decimals: number) => {
  if (amount === undefined) return '...';

  try {
    return formatUnitsWithMaxFraction(amount, decimals, decimals === 6 ? 4 : 6);
  } catch {
    return '0';
  }
};

export const formatChainLabel = (name: string, chainId: number) => `${name} (${chainId})`;
