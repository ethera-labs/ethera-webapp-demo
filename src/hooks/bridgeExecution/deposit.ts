import { entryPointAbi } from '../../lib/entryPoint';
import {
  FALLBACK_CALL_GAS_LIMIT,
  MIN_RECOMMENDED_TOP_UP,
  MIN_VERIFICATION_GAS_LIMIT,
  PRE_VERIFICATION_GAS
} from './constants';
import type {
  EntryPointRequirement,
  EstimateEntryPointRequirementParams,
  ResolveEntryPointDepositRequirementsParams
} from './types';

// EntryPoint deposit requirement estimation for non-paymaster mode.
const withGasMargin = (value: bigint, marginPct = 25n) => value + (value * marginPct) / 100n;

const estimateCallGasWithFallback = async ({
  smart,
  call
}: {
  smart: EstimateEntryPointRequirementParams['smart'];
  call: EstimateEntryPointRequirementParams['calls'][number];
}) => {
  try {
    return withGasMargin(
      await smart.publicClient.estimateGas({
        account: smart.account,
        to: call.to,
        data: call.data,
        value: call.value
      })
    );
  } catch {
    if (call.value > 0n) {
      try {
        // Value-bearing calls can fail estimation when the smart account is not funded yet.
        // Estimating with value=0 keeps gas prechecks stable for the non-paymaster modal path.
        return withGasMargin(
          await smart.publicClient.estimateGas({
            account: smart.account,
            to: call.to,
            data: call.data,
            value: 0n
          })
        );
      } catch {
        // Fall through to conservative fallback below.
      }
    }

    return FALLBACK_CALL_GAS_LIMIT;
  }
};

const estimateEntryPointRequirementForChain = async ({
  smart,
  calls,
  chainLabel,
  entryPointAddress
}: EstimateEntryPointRequirementParams): Promise<EntryPointRequirement> => {
  const callGasEstimates = await Promise.all(
    calls.map((call) => estimateCallGasWithFallback({ smart, call }))
  );

  const callGasLimit = callGasEstimates.reduce((acc, gas) => acc + gas, 0n);
  const verificationGasLimit =
    callGasLimit + PRE_VERIFICATION_GAS > MIN_VERIFICATION_GAS_LIMIT
      ? callGasLimit + PRE_VERIFICATION_GAS
      : MIN_VERIFICATION_GAS_LIMIT;

  const feeEstimate = await smart.publicClient.estimateFeesPerGas();
  const maxFeePerGas = feeEstimate.maxFeePerGas ?? feeEstimate.gasPrice ?? feeEstimate.maxPriorityFeePerGas ?? 1n;
  const estimatedRequired = (callGasLimit + verificationGasLimit + PRE_VERIFICATION_GAS) * maxFeePerGas;

  const currentDeposit = await smart.publicClient.readContract({
    address: entryPointAddress,
    abi: entryPointAbi,
    functionName: 'balanceOf',
    args: [smart.account.address]
  });

  const shortfall = estimatedRequired > currentDeposit ? estimatedRequired - currentDeposit : 0n;
  const recommendedTopUp =
    shortfall > 0n ? (shortfall > MIN_RECOMMENDED_TOP_UP ? withGasMargin(shortfall, 100n) : MIN_RECOMMENDED_TOP_UP) : 0n;

  return {
    chainId: smart.publicClient.chain!.id,
    chainLabel,
    smartAccount: smart.account.address,
    currentDeposit,
    estimatedRequired,
    recommendedTopUp
  };
};

/**
 * Returns chains where current EntryPoint deposit is below estimated requirement.
 */
export const resolveEntryPointDepositRequirements = async ({
  sourceSmartAccount,
  destinationSmartAccount,
  sourceCalls,
  destinationCalls,
  sourceChainLabel,
  destinationChainLabel,
  entryPointAddress
}: ResolveEntryPointDepositRequirementsParams) => {
  const [sourceRequirement, destinationRequirement] = await Promise.all([
    estimateEntryPointRequirementForChain({
      smart: sourceSmartAccount,
      calls: sourceCalls,
      chainLabel: sourceChainLabel,
      entryPointAddress
    }),
    estimateEntryPointRequirementForChain({
      smart: destinationSmartAccount,
      calls: destinationCalls,
      chainLabel: destinationChainLabel,
      entryPointAddress
    })
  ]);

  return [sourceRequirement, destinationRequirement].filter((item) => item.currentDeposit < item.estimatedRequired);
};
