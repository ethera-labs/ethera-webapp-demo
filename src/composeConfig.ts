import type { Chain } from 'viem';
import { createComposeRuntimeConfig, createWagmiRuntimeConfig, createWalletChains } from './config/clients';
import { createNetworkProfile } from './config/profiles';
export type { AccountAbstractionContracts, DemoToken, L1FundingConfig, NetworkProfile } from './config/types';

// Public runtime config surface consumed by the app and hooks.
export const networkProfile = createNetworkProfile();

export const chainA = networkProfile.chains[0];
export const chainB = networkProfile.chains[1];
export const l1FundingConfig = networkProfile.l1Funding;
export const walletChains = createWalletChains(networkProfile) as [Chain, ...Chain[]];

export const wagmiConfig = createWagmiRuntimeConfig(networkProfile, walletChains);

export const composeConfig = createComposeRuntimeConfig({
  networkProfile,
  wagmiConfig
});

export const bridgeAddress = networkProfile.bridgeAddress;
export const demoTokens = networkProfile.tokens;
