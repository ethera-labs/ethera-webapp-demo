const stripViemVersion = (message: string) => message.split(' Version:')[0].trim();

const truncate = (value: string, max = 240) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

export const normalizeExecutionErrorMessage = (rawMessage: string): string => {
  const cleanMessage = stripViemVersion(rawMessage);
  const normalized = cleanMessage.toLowerCase();

  if (normalized.includes('insufficientdeposit')) {
    return 'Insufficient EntryPoint deposit for the smart account on one rollup. Fund the smart account with native gas token and ensure EntryPoint deposit is available on both chains, or enable a funded paymaster.';
  }

  if (normalized.includes('compose_buildsigneduseropstx') && normalized.includes('not supported')) {
    return 'Compose RPC build method failed on one rollup endpoint. Verify both rollup RPC URLs support compose_buildSignedUserOpsTx.';
  }

  if (normalized.includes('eth_sendxtransaction') && normalized.includes('not supported')) {
    return 'Cross-rollup submit method is unavailable on the configured RPC. Verify the endpoint supports eth_sendXTransaction.';
  }

  if (normalized.includes('messagenotfound') || normalized.includes('0x28915ac7')) {
    return 'Destination mailbox message is not available yet. Wait for relay/sequencer propagation, then retry destination receive.';
  }

  return truncate(cleanMessage);
};
