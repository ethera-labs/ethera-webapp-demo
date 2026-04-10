import { getEnv, toHttpUrl } from './env';

// Paymaster endpoint resolution for shared, per-chain, and base+route env modes.
const buildPaymasterEndpointFromBase = ({
  baseEndpoint,
  baseEndpointKey,
  chainRouteName,
  chainRouteNameKey
}: {
  baseEndpoint: string;
  baseEndpointKey: string;
  chainRouteName: string;
  chainRouteNameKey: string;
}): string => {
  const normalizedBase = toHttpUrl(baseEndpoint, baseEndpointKey);
  const routeName = chainRouteName.trim().replace(/^\/+|\/+$/g, '');

  if (!routeName) {
    throw new Error(`Expected a non-empty paymaster route name for ${chainRouteNameKey}.`);
  }

  const baseUrl = new URL(normalizedBase);
  const basePath = baseUrl.pathname.replace(/\/+$/, '');
  baseUrl.pathname = `${basePath}/${routeName}`.replace(/\/{2,}/g, '/');
  return baseUrl.toString();
};

/**
 * Resolves paymaster endpoints per chain and enforces all-or-nothing configuration.
 */
export const resolvePaymasterByChainId = ({
  defaultEndpointKey,
  chainAEndpointKey,
  chainBEndpointKey,
  baseEndpointKey,
  chainARouteNameKey,
  chainBRouteNameKey,
  chainARouteNameDefault,
  chainBRouteNameDefault,
  chainAId,
  chainBId
}: {
  defaultEndpointKey: string;
  chainAEndpointKey: string;
  chainBEndpointKey: string;
  baseEndpointKey?: string;
  chainARouteNameKey?: string;
  chainBRouteNameKey?: string;
  chainARouteNameDefault?: string;
  chainBRouteNameDefault?: string;
  chainAId: number;
  chainBId: number;
}): Record<number, string> | undefined => {
  const defaultEndpoint = getEnv(defaultEndpointKey);
  const baseEndpoint = baseEndpointKey ? getEnv(baseEndpointKey) : undefined;
  const chainARouteName =
    (chainARouteNameKey ? getEnv(chainARouteNameKey) : undefined) ?? (baseEndpoint ? chainARouteNameDefault : undefined);
  const chainBRouteName =
    (chainBRouteNameKey ? getEnv(chainBRouteNameKey) : undefined) ?? (baseEndpoint ? chainBRouteNameDefault : undefined);

  const derivedChainAEndpoint =
    baseEndpoint && chainARouteName && baseEndpointKey && chainARouteNameKey
      ? buildPaymasterEndpointFromBase({
          baseEndpoint,
          baseEndpointKey,
          chainRouteName: chainARouteName,
          chainRouteNameKey: chainARouteNameKey
        })
      : undefined;

  const derivedChainBEndpoint =
    baseEndpoint && chainBRouteName && baseEndpointKey && chainBRouteNameKey
      ? buildPaymasterEndpointFromBase({
          baseEndpoint,
          baseEndpointKey,
          chainRouteName: chainBRouteName,
          chainRouteNameKey: chainBRouteNameKey
        })
      : undefined;

  const chainAEndpoint = getEnv(chainAEndpointKey) ?? derivedChainAEndpoint ?? defaultEndpoint;
  const chainBEndpoint = getEnv(chainBEndpointKey) ?? derivedChainBEndpoint ?? defaultEndpoint;

  if (!chainAEndpoint && !chainBEndpoint) {
    return undefined;
  }

  if (!chainAEndpoint || !chainBEndpoint) {
    const dynamicKeysHint =
      baseEndpointKey && chainARouteNameKey && chainBRouteNameKey
        ? `, or set ${baseEndpointKey} together with ${chainARouteNameKey} and ${chainBRouteNameKey}`
        : '';
    throw new Error(
      `Paymaster config is partial. Define both ${chainAEndpointKey} and ${chainBEndpointKey}, or set ${defaultEndpointKey}${dynamicKeysHint}.`
    );
  }

  return {
    [chainAId]: toHttpUrl(chainAEndpoint, chainAEndpointKey),
    [chainBId]: toHttpUrl(chainBEndpoint, chainBEndpointKey)
  };
};
