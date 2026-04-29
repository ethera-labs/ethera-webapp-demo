import { useCallback, useMemo, useState } from 'react';
import { composeConfig, networkProfile, type DemoToken, type L1FundingConfig } from '../composeConfig';
import { resolveImportedTokenMetadata, upsertImportedToken } from '../lib/importedTokens';
import { useImportedTokensStorage } from './useImportedTokensStorage';

type UseCanonicalL1TokenImportParams = {
  walletAddress: `0x${string}` | undefined;
  l1FundingConfig: L1FundingConfig | undefined;
  onImportError?: (message: string) => void;
};

/**
 * Manages imported canonical L1 ERC-20 tokens shared across funding/return flows.
 */
export function useCanonicalL1TokenImport({
  walletAddress,
  l1FundingConfig,
  onImportError
}: UseCanonicalL1TokenImportParams) {
  const [importTokenAddressInput, setImportTokenAddressInput] = useState('');
  const [importTokenError, setImportTokenError] = useState<string | null>(null);
  const [isImportingToken, setIsImportingToken] = useState(false);
  const storedImportedTokens = useImportedTokensStorage({
    chainId: l1FundingConfig?.chain.id,
    walletAddress
  });
  const importedTokens = useMemo<DemoToken[]>(
    () =>
      storedImportedTokens.map((token) => ({
        ...token,
        kind: 'erc20' as const
      })),
    [storedImportedTokens]
  );

  const importCanonicalL1Token = useCallback(async () => {
    if (!walletAddress || !l1FundingConfig) {
      const message = 'Connect a wallet before importing a canonical L1 token.';
      setImportTokenError(message);
      onImportError?.(message);
      return undefined;
    }

    const candidateAddress = importTokenAddressInput.trim();
    if (!candidateAddress) {
      const message = 'Enter a canonical L1 ERC-20 token address.';
      setImportTokenError(message);
      onImportError?.(message);
      return undefined;
    }

    const l1PublicClient = composeConfig.getPublicClient(l1FundingConfig.chain.id);
    if (!l1PublicClient) {
      const message = `L1 public client is not configured for chain ${l1FundingConfig.chain.id}.`;
      setImportTokenError(message);
      onImportError?.(message);
      return undefined;
    }

    try {
      setIsImportingToken(true);
      setImportTokenError(null);

      const token = await resolveImportedTokenMetadata({
        publicClient: l1PublicClient,
        tokenAddress: candidateAddress
      });

      upsertImportedToken({
        networkMode: networkProfile.mode,
        chainId: l1FundingConfig.chain.id,
        walletAddress,
        token
      });

      const importedToken: DemoToken = {
        ...token,
        kind: 'erc20'
      };

      setImportTokenAddressInput('');

      return importedToken;
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : 'Could not import token from address.';
      const message = rawMessage.toLowerCase().includes('valid evm address')
        ? 'Enter a valid canonical L1 ERC-20 token address.'
        : 'Could not import token. Enter the canonical L1 ERC-20 token address.';
      setImportTokenError(message);
      onImportError?.(message);
      return undefined;
    } finally {
      setIsImportingToken(false);
    }
  }, [importTokenAddressInput, l1FundingConfig, onImportError, walletAddress]);

  return {
    importedTokens,
    importTokenAddressInput,
    importTokenError,
    isImportingToken,
    setImportTokenAddressInput,
    importCanonicalL1Token
  };
}
