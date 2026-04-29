import { useMemo, useSyncExternalStore } from 'react';
import { networkProfile } from '../composeConfig';
import {
  getImportedTokensStorageKey,
  readImportedTokens,
  subscribeToImportedTokens,
  type ImportedToken
} from '../lib/importedTokens';

type UseImportedTokensStorageParams = {
  chainId: number | undefined;
  walletAddress: `0x${string}` | undefined;
};

const EMPTY_IMPORTED_TOKENS: ImportedToken[] = [];

/**
 * Keeps imported tokens for one wallet/chain pair in sync with local storage updates.
 */
export function useImportedTokensStorage({ chainId, walletAddress }: UseImportedTokensStorageParams) {
  const storageKey = useMemo(() => {
    if (!walletAddress || !chainId) return null;

    return getImportedTokensStorageKey({
      networkMode: networkProfile.mode,
      chainId,
      walletAddress
    });
  }, [chainId, walletAddress]);

  return useSyncExternalStore(
    (onStoreChange) => {
      if (!storageKey) {
        return () => undefined;
      }

      return subscribeToImportedTokens({
        onUpdate: ({ storageKey: updatedStorageKey }) => {
          if (updatedStorageKey !== storageKey) return;
          onStoreChange();
        }
      });
    },
    () => {
      if (!walletAddress || !chainId) {
        return EMPTY_IMPORTED_TOKENS;
      }

      return readImportedTokens({
        networkMode: networkProfile.mode,
        chainId,
        walletAddress
      });
    },
    () => EMPTY_IMPORTED_TOKENS
  );
}
