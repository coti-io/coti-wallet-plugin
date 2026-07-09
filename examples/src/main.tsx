import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  WagmiRainbowKitProvider,
} from '@coti-io/coti-wallet-plugin';
import '@rainbow-me/rainbowkit/styles.css';
import App from './App';
import { ExampleThemeProvider } from './ExampleThemeContext';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiRainbowKitProvider
      walletConnectProjectId={import.meta.env.VITE_WALLETCONNECT_PROJECT_ID}
    >
      <ExampleThemeProvider>
        <App />
      </ExampleThemeProvider>
    </WagmiRainbowKitProvider>
  </React.StrictMode>
);
