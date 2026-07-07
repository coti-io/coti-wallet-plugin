import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  PrivacyBridgeProvider,
  WagmiRainbowKitProvider,
  type OnboardModalTheme,
} from '@coti-io/coti-wallet-plugin';
import '@rainbow-me/rainbowkit/styles.css';
import App from './App';

const ONBOARD_MODAL_THEME: OnboardModalTheme = {
  checkboxText: {
    color: 'rgba(255, 255, 255, 0.86)',
  },
  tooltipButton: {
    color: 'rgba(255, 255, 255, 0.86)',
  },
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <WagmiRainbowKitProvider
      walletConnectProjectId={import.meta.env.VITE_WALLETCONNECT_PROJECT_ID}
    >
      <PrivacyBridgeProvider
        privateUnlock={{
          theme: ONBOARD_MODAL_THEME,
          warning:
            'The example dApp never stores or receives the AES key. Onboarding, backup restore, Snap storage, and decrypt/encrypt operations stay inside the plugin.',
        }}
      >
        <App />
      </PrivacyBridgeProvider>
    </WagmiRainbowKitProvider>
  </React.StrictMode>
);
