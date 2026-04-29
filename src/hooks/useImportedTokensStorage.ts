import { useMemo, useSyncExternalStore } from 'react';
import { networkProfile } from '../composeConfig';
import {
  getImportedTokensStorageKey,
  parseImportedTokens,
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

  const storageSnapshot = useSyncExternalStore(
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
      if (!storageKey || typeof window === 'undefined') {
        return null;
      }

      return window.localStorage.getItem(storageKey);
    },
    () => null
  );

  return useMemo(() => {
    if (!walletAddress || !chainId) {
      return EMPTY_IMPORTED_TOKENS;
    }

    return parseImportedTokens(storageSnapshot);
  }, [chainId, storageSnapshot, walletAddress]);
}
