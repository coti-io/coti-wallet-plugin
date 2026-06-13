import React from 'react';
import ReactDOM from 'react-dom/client';
import { WagmiRainbowKitProvider } from '@coti-io/coti-wallet-plugin';
import '@rainbow-me/rainbowkit/styles.css';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiRainbowKitProvider
      walletConnectProjectId={import.meta.env.VITE_WALLETCONNECT_PROJECT_ID}
    >
      <App />
    </WagmiRainbowKitProvider>
  </React.StrictMode>
);
