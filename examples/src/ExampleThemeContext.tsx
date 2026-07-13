import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { PrivacyBridgeProvider } from '@coti-io/coti-wallet-plugin';
import {
  buildExampleOnboardTheme,
  getExamplePageColors,
  type ExampleThemeMode,
} from './onboardTheme';

interface ExampleThemeContextValue {
  mode: ExampleThemeMode;
  toggleMode: () => void;
  pageColors: ReturnType<typeof getExamplePageColors>;
}

const ExampleThemeContext = createContext<ExampleThemeContextValue | undefined>(undefined);

const THEME_STORAGE_KEY = 'coti-example-theme';

function readStoredMode(): ExampleThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

export function ExampleThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ExampleThemeMode>(readStoredMode);
  const onboardTheme = useMemo(() => buildExampleOnboardTheme(mode), [mode]);
  const pageColors = useMemo(() => getExamplePageColors(mode), [mode]);

  const toggleMode = () => {
    setMode((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
      return next;
    });
  };

  const value = useMemo(
    () => ({ mode, toggleMode, pageColors }),
    [mode, pageColors],
  );

  useLayoutEffect(() => {
    document.documentElement.style.backgroundColor = pageColors.backgroundColor;
    document.body.style.backgroundColor = pageColors.backgroundColor;
    document.body.style.color = pageColors.color;
    document.body.style.margin = '0';
  }, [pageColors.backgroundColor, pageColors.color]);

  return (
    <ExampleThemeContext.Provider value={value}>
      <div
        style={{
          minHeight: '100vh',
          backgroundColor: pageColors.backgroundColor,
          color: pageColors.color,
        }}
      >
        <PrivacyBridgeProvider
          privateUnlock={{
            theme: onboardTheme,
            warnings: {
              intro:
                'The example dApp never stores or receives the AES key. Onboarding, backup restore, Snap storage, and decrypt/encrypt operations stay inside the plugin.',
            },
          }}
        >
          {children}
        </PrivacyBridgeProvider>
      </div>
    </ExampleThemeContext.Provider>
  );
}

export function useExampleTheme() {
  const context = useContext(ExampleThemeContext);
  if (!context) {
    throw new Error('useExampleTheme must be used within ExampleThemeProvider');
  }
  return context;
}
