import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { EtheraProvider } from '@ssv-labs/ethera-sdk/react';
import App from './App';
import { composeConfig, wagmiConfig } from './composeConfig';
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <EtheraProvider config={composeConfig}>
          <App />
        </EtheraProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
);
