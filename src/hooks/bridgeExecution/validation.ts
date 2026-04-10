import { parseUnits } from 'viem';
import type { ValidateBridgeExecutionInputParams, ValidateBridgeExecutionInputResult } from './types';

// Input guards for bridge submissions.
/**
 * Validates bridge form input and smart-account readiness before any RPC work starts.
 */
export const validateBridgeExecutionInput = ({
  amountInput,
  selectedToken,
  sourceBalance,
  walletAddress,
  sourceChain,
  destinationChain,
  sourceSmart,
  destinationSmart
}: ValidateBridgeExecutionInputParams): ValidateBridgeExecutionInputResult => {
  if (!selectedToken) {
    return { ok: false, error: 'No token configured for this environment.' };
  }

  if (sourceChain.id === destinationChain.id) {
    return { ok: false, error: 'Source and destination chains must be different.' };
  }

  if (!sourceSmart || !destinationSmart) {
    return { ok: false, error: 'Smart accounts are not ready yet. Connect wallet and wait for initialization.' };
  }

  if (!amountInput.trim()) {
    return { ok: false, error: 'Enter an amount.' };
  }

  let amount: bigint;
  try {
    amount = parseUnits(amountInput, selectedToken.decimals);
  } catch {
    return { ok: false, error: `Invalid amount for ${selectedToken.symbol}.` };
  }

  if (amount <= 0n) {
    return { ok: false, error: 'Amount must be greater than zero.' };
  }

  if (!walletAddress) {
    return { ok: false, error: 'Connected wallet address is unavailable. Reconnect wallet and retry.' };
  }

  if (sourceBalance !== undefined && amount > sourceBalance) {
    return { ok: false, error: `Amount exceeds available ${selectedToken.symbol} balance on the source chain.` };
  }

  return {
    ok: true,
    value: {
      amount,
      selectedToken,
      walletAddress,
      sourceSmart,
      destinationSmart
    }
  };
};
