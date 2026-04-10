import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { ComposeProvider } from '@ssv-labs/compose-sdk/react';
import App from './App';
import { composeConfig, wagmiConfig } from './composeConfig';
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ComposeProvider config={composeConfig}>
          <App />
        </ComposeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>
);
