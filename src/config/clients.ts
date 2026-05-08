import { createEtheraConfig, type EtheraRpcSchema } from '@ssv-labs/ethera-sdk';
import { createConfig, http } from '@wagmi/core';
import { createPublicClient, rpcSchema, type Chain } from 'viem';
import { injected, metaMask } from 'wagmi/connectors';
import type { NetworkProfile } from './types';

// Wagmi/Compose client factories derived from the selected runtime profile.
/**
 * Returns wallet-visible chains for wagmi, including optional L1 funding chain.
 */
export const createWalletChains = (networkProfile: NetworkProfile): [Chain, ...Chain[]] => {
  const chainA = networkProfile.chains[0];
  const chainB = networkProfile.chains[1];
  const l1FundingConfig = networkProfile.l1Funding;
  return (l1FundingConfig ? [chainA, chainB, l1FundingConfig.chain] : [chainA, chainB]) as [Chain, ...Chain[]];
};

/**
 * Creates wagmi config with compose RPC schema enabled on each configured chain client.
 */
export const createWagmiRuntimeConfig = (networkProfile: NetworkProfile, walletChains: [Chain, ...Chain[]]) =>
  createConfig({
    chains: walletChains,
    connectors: [metaMask(), injected({ target: 'metaMask' }), injected()],
    client(parameters) {
      return createPublicClient({
        chain: parameters.chain,
        transport: http(networkProfile.rpcByChainId[parameters.chain.id]),
        rpcSchema: rpcSchema<EtheraRpcSchema>()
      });
    }
  });

/**
 * Creates Compose SDK runtime config and wires optional paymaster endpoint resolution.
 */
export const createComposeRuntimeConfig = ({
  networkProfile,
  wagmiConfig
}: {
  networkProfile: NetworkProfile;
  wagmiConfig: ReturnType<typeof createWagmiRuntimeConfig>;
}) =>
  createEtheraConfig({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    wagmi: wagmiConfig as any,
    accountAbstractionContracts: networkProfile.accountAbstractionContracts,
    ...(networkProfile.paymasterByChainId
      ? {
          getPaymasterEndpoint: ({ chainId }: { chainId: number }) => {
            const endpoint = networkProfile.paymasterByChainId?.[chainId];
            if (!endpoint) {
              throw new Error(`Paymaster endpoint not configured for chainId ${chainId}.`);
            }
            return endpoint;
          }
        }
      : {})
  });
