import { parseEther } from 'viem';

// Shared limits/timeouts for cross-rollup bridge execution.
export const FALLBACK_CALL_GAS_LIMIT = 900_000n;
export const PRE_VERIFICATION_GAS = 90_000n;
export const MIN_VERIFICATION_GAS_LIMIT = 1_200_000n;

export const USER_OP_BUILD_TIMEOUT_MS = 90_000;
export const COMPOSE_BUILD_TIMEOUT_MS = 90_000;
export const COMPOSE_SEND_TIMEOUT_MS = 60_000;
export const RECEIPT_WAIT_TIMEOUT_MS = 180_000;

export const HASH_PRESENCE_POLL_INTERVAL_MS = 1_500;
export const HASH_PRESENCE_POLL_ATTEMPTS = 8;

export const MIN_RECOMMENDED_TOP_UP = parseEther('0.01');
export const MAX_TRANSACTION_HISTORY = 12;
