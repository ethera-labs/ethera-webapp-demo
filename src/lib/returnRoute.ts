import type { PublicClient } from 'viem';
import type { L1FundingConfig, UniversalContractsConfig } from '../config/types';
import { resolveDisputeGameFactoryAddressFromPortal } from './l1Bridge';
import type { ReturnSettlementContracts } from '../types/funding';

export type ReturnRouteResolution = {
  l2BridgeAddress: `0x${string}`;
  settlementContracts: ReturnSettlementContracts;
};

/**
 * Resolves the L2->L1 return route from universal configuration only.
 */
export const resolveReturnRouteForSourceChain = async ({
  sourceChainId,
  l1FundingConfig,
  universalContracts,
  l1PublicClient
}: {
  sourceChainId: number;
  l1FundingConfig: L1FundingConfig;
  universalContracts: UniversalContractsConfig | undefined;
  l1PublicClient: { readContract: PublicClient['readContract'] };
}): Promise<ReturnRouteResolution> => {
  const universalL2BridgeAddress = universalContracts?.l2BridgeByChainId?.[sourceChainId];
  const configuredPortalAddress =
    l1FundingConfig.composePortalBySourceChainId?.[sourceChainId] ?? universalContracts?.composePortalByChainId?.[sourceChainId];

  if (!universalL2BridgeAddress) {
    throw new Error(
      `Missing universal L2 bridge mapping for source chain ${sourceChainId}. Configure universal.l2BridgeByChainId.`
    );
  }

  if (!configuredPortalAddress) {
    throw new Error(
      `Missing universal portal mapping for source chain ${sourceChainId}. Configure l1Funding.composePortalBySourceChainId or universal.composePortalByChainId.`
    );
  }

  const l1DisputeGameFactoryAddress = await resolveDisputeGameFactoryAddressFromPortal({
    l1PublicClient,
    l1PortalAddress: configuredPortalAddress
  });

  return {
    l2BridgeAddress: universalL2BridgeAddress,
    settlementContracts: {
      l1PortalAddress: configuredPortalAddress,
      l1DisputeGameFactoryAddress
    }
  };
};
