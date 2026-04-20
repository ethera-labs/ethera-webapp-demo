import { erc20Abi, isAddress, type PublicClient } from 'viem';

export type ImportedToken = {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
};

const STORAGE_KEY_PREFIX = 'importedTokens';

const hasWindow = () => typeof window !== 'undefined' && Boolean(window.localStorage);

export const getImportedTokensStorageKey = ({
  networkMode,
  chainId,
  walletAddress
}: {
  networkMode: 'testnet' | 'mainnet';
  chainId: number;
  walletAddress: `0x${string}`;
}) => `${STORAGE_KEY_PREFIX}:${networkMode}:${chainId}:${walletAddress.toLowerCase()}`;

export const readImportedTokens = ({
  networkMode,
  chainId,
  walletAddress
}: {
  networkMode: 'testnet' | 'mainnet';
  chainId: number;
  walletAddress: `0x${string}`;
}): ImportedToken[] => {
  if (!hasWindow()) return [];

  const key = getImportedTokensStorageKey({ networkMode, chainId, walletAddress });
  const raw = window.localStorage.getItem(key);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as ImportedToken[];
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item): item is ImportedToken =>
        Boolean(item) &&
        isAddress(item.address) &&
        typeof item.symbol === 'string' &&
        item.symbol.trim().length > 0 &&
        Number.isInteger(item.decimals) &&
        item.decimals >= 0
    );
  } catch {
    return [];
  }
};

export const upsertImportedToken = ({
  networkMode,
  chainId,
  walletAddress,
  token
}: {
  networkMode: 'testnet' | 'mainnet';
  chainId: number;
  walletAddress: `0x${string}`;
  token: ImportedToken;
}): ImportedToken[] => {
  const current = readImportedTokens({ networkMode, chainId, walletAddress });
  const next = [token, ...current.filter((item) => item.address.toLowerCase() !== token.address.toLowerCase())];

  if (hasWindow()) {
    const key = getImportedTokensStorageKey({ networkMode, chainId, walletAddress });
    window.localStorage.setItem(key, JSON.stringify(next));
  }

  return next;
};

const normalizeSymbol = (value: string, address: `0x${string}`) => {
  const normalized = value.trim();
  if (!normalized) return `TOKEN-${address.slice(2, 6).toUpperCase()}`;
  return normalized.length > 16 ? normalized.slice(0, 16) : normalized;
};

export const resolveImportedTokenMetadata = async ({
  publicClient,
  tokenAddress
}: {
  publicClient: Pick<PublicClient, 'readContract'>;
  tokenAddress: string;
}): Promise<ImportedToken> => {
  if (!isAddress(tokenAddress)) {
    throw new Error('Token address is not a valid EVM address.');
  }

  const address = tokenAddress as `0x${string}`;
  const [symbol, decimals] = await Promise.all([
    publicClient.readContract({
      address,
      abi: erc20Abi,
      functionName: 'symbol'
    }),
    publicClient.readContract({
      address,
      abi: erc20Abi,
      functionName: 'decimals'
    })
  ]);

  return {
    address,
    symbol: normalizeSymbol(String(symbol), address),
    decimals: Number(decimals)
  };
};
