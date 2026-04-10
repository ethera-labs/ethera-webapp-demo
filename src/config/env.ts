import { isAddress } from 'viem';

// Environment parsing/validation helpers used by profile builders.
export const getEnv = (key: string): string | undefined => {
  const value = import.meta.env[key] as string | undefined;
  return value?.trim();
};

/**
 * Returns a required env var and fails fast with a descriptive error when missing.
 */
export const getRequiredEnv = (key: string): string => {
  const value = getEnv(key);
  if (!value) {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value;
};

export const parsePositiveInt = (value: string, key: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer for ${key}, got: ${value}`);
  }
  return parsed;
};

export const parseNonNegativeInt = (value: string, key: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Expected a non-negative integer for ${key}, got: ${value}`);
  }
  return parsed;
};

export const getOptionalPositiveIntEnv = (key: string): number | undefined => {
  const value = getEnv(key);
  return value ? parsePositiveInt(value, key) : undefined;
};

/**
 * Validates and narrows an address-like env value into an EVM address string.
 */
export const toAddress = (value: string, key: string): `0x${string}` => {
  if (!isAddress(value)) {
    throw new Error(`Expected a valid address for ${key}, got: ${value}`);
  }
  return value;
};

/**
 * Validates that an env value is an http/https URL.
 */
export const toHttpUrl = (value: string, key: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Expected a valid URL for ${key}, got: ${value}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Expected an http/https URL for ${key}, got: ${value}`);
  }

  return value;
};
