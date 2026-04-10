import type { Connector } from 'wagmi';

export const normalizeWalletErrorMessage = (rawMessage: string): string | null => {
  const cleanMessage = rawMessage.split(' Version:')[0].trim();
  const message = cleanMessage.toLowerCase();

  if (message.includes('connector already connected')) {
    return null;
  }

  if (message.includes('wallet must has at least one account')) {
    return 'Wallet has no available account. Open MetaMask, unlock it, and create or select at least one account.';
  }

  if (message.includes('user rejected')) {
    return 'Wallet connection was rejected. Open MetaMask and approve the connection request.';
  }

  return cleanMessage;
};

export const getPreferredConnector = (connectors: readonly Connector[]) => {
  return (
    connectors.find((connector) => {
      const connectorId = connector.id.toLowerCase();
      const connectorName = connector.name.toLowerCase();
      return connectorId.includes('metamask') || connectorName.includes('metamask');
    }) ??
    connectors.find((connector) => connector.type === 'injected') ??
    connectors[0]
  );
};
