import { useCallback, useEffect, useState } from 'react';
import { composeConfig, networkProfile, type DemoToken, type L1FundingConfig } from '../composeConfig';
import { readImportedTokens, resolveImportedTokenMetadata, upsertImportedToken } from '../lib/importedTokens';

type UseCanonicalL1TokenImportParams = {
  walletAddress: `0x${string}` | undefined;
  l1FundingConfig: L1FundingConfig | undefined;
};

/**
 * Manages imported canonical L1 ERC-20 tokens shared across funding/return flows.
 */
export function useCanonicalL1TokenImport({ walletAddress, l1FundingConfig }: UseCanonicalL1TokenImportParams) {
  const [importTokenAddressInput, setImportTokenAddressInput] = useState('');
  const [importTokenError, setImportTokenError] = useState<string | null>(null);
  const [isImportingToken, setIsImportingToken] = useState(false);
  const [importedTokens, setImportedTokens] = useState<DemoToken[]>([]);

  useEffect(() => {
    if (!walletAddress || !l1FundingConfig) {
      setImportedTokens([]);
      return;
    }

    const storedTokens = readImportedTokens({
      networkMode: networkProfile.mode,
      chainId: l1FundingConfig.chain.id,
      walletAddress
    }).map((token) => ({
      ...token,
      kind: 'erc20' as const
    }));

    setImportedTokens(storedTokens);
  }, [l1FundingConfig, walletAddress]);

  const importCanonicalL1Token = useCallback(async () => {
    if (!walletAddress || !l1FundingConfig) {
      setImportTokenError('Connect a wallet and configure L1 funding before importing tokens.');
      return undefined;
    }

    const candidateAddress = importTokenAddressInput.trim();
    if (!candidateAddress) {
      setImportTokenError('Enter a token address to import.');
      return undefined;
    }

    const l1PublicClient = composeConfig.getPublicClient(l1FundingConfig.chain.id);
    if (!l1PublicClient) {
      setImportTokenError(`L1 public client is not configured for chain ${l1FundingConfig.chain.id}.`);
      return undefined;
    }

    try {
      setIsImportingToken(true);
      setImportTokenError(null);

      const token = await resolveImportedTokenMetadata({
        publicClient: l1PublicClient,
        tokenAddress: candidateAddress
      });

      const nextImportedTokens = upsertImportedToken({
        networkMode: networkProfile.mode,
        chainId: l1FundingConfig.chain.id,
        walletAddress,
        token
      }).map((item) => ({
        ...item,
        kind: 'erc20' as const
      }));

      const importedToken: DemoToken = {
        ...token,
        kind: 'erc20'
      };

      setImportedTokens(nextImportedTokens);
      setImportTokenAddressInput('');

      return importedToken;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not import token from address.';
      setImportTokenError(message);
      return undefined;
    } finally {
      setIsImportingToken(false);
    }
  }, [importTokenAddressInput, l1FundingConfig, walletAddress]);

  return {
    importedTokens,
    importTokenAddressInput,
    importTokenError,
    isImportingToken,
    setImportTokenAddressInput,
    importCanonicalL1Token
  };
}
