import { normalizeExecutionErrorMessage } from '../../lib/errors';
import type { BridgeReceiptStatus } from '../../types/bridge';

// Error/status helpers for bridge execution UI state updates.
/**
 * Normalizes execution errors into user-facing messages.
 */
export const resolveBridgeExecutionError = (executionError: unknown) => {
  const rawMessage = executionError instanceof Error ? executionError.message : 'Unknown execution error';
  return {
    rawMessage,
    normalizedMessage: normalizeExecutionErrorMessage(rawMessage)
  };
};

/**
 * Converts any non-success status into failed for final terminal UI state.
 */
export const markNonSuccessfulStatusesFailed = (statuses: BridgeReceiptStatus[]): BridgeReceiptStatus[] =>
  statuses.map((status) => (status === 'success' ? 'success' : 'failed'));
