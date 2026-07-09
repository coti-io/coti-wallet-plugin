# Onboard modal theming

The unlock/onboarding modal is rendered by the plugin (`PrivateUnlockProvider`). **Colors and typography are owned by the host app**, not hard-coded to match a specific product skin.

## Wire-up

Pass a theme object when you mount `PrivacyBridgeProvider`:

```tsx
import {
  PrivacyBridgeProvider,
  type OnboardModalTheme,
} from '@coti-io/coti-wallet-plugin';

const lightOnboardTheme: OnboardModalTheme = {
  backdrop: { backgroundColor: 'rgba(4, 19, 61, 0.35)' },
  modal: {
    backgroundColor: '#ffffff',
    color: '#0f172a',
    border: '1px solid #e2e8f0',
  },
  title: { color: '#0f172a' },
  description: { color: '#64748b' },
  checkboxText: { color: '#0f172a' },
  tooltipButton: { color: '#64748b' },
  primaryButton: { backgroundColor: '#1E29F6', color: '#ffffff' },
  cancelButton: { color: '#64748b' },
};

export function AppRoot() {
  return (
    <PrivacyBridgeProvider privateUnlock={{ theme: lightOnboardTheme }}>
      <App />
    </PrivacyBridgeProvider>
  );
}
```

Do **not** render `<OnboardModal />` yourself for the unlock flow — the provider mounts it once.

## How it works

1. `OnboardModal` starts from `onboardModalDefaultStyles` (dark palette).
2. Your `OnboardModalTheme` partial overrides are shallow-merged per style target.
3. When a theme is provided, the plugin fills common text targets (`checkboxText`, `tooltipButton`, icon buttons, etc.) from your `title` / `modal` / `description` tokens if you did not set them explicitly.

## Style targets

Import `ONBOARD_MODAL_STYLE_KEYS` or `onboardModalDefaultStyles` from the package for the full list. Common targets:

| Key | Used for |
|-----|----------|
| `backdrop` | Overlay behind the dialog |
| `modal` | Dialog panel (`backgroundColor`, `color`, `border`) |
| `title` | Headings on every screen |
| `description` | Body copy under the title |
| `checkboxText` | “Save encrypted backup” label |
| `tooltipButton` / `tooltipBubble` | `?` help control and tooltip |
| `primaryButton` / `primaryButtonDisabled` | Main CTA |
| `cancelButton` | Secondary dismiss action |
| `errorBox` / `errorText` | Failure screen |
| `stepLabel` / `stepDescription` | Progress stepper |
| `aesKeyBox` / `keyInput` | Success screen key display |
| `warningBox` / `warningText` | Non-blocking warning from `privateUnlock.warning` |

Each value is a `React.CSSProperties` object (same as inline `style`).

## Light / dark in your app

The plugin has no opinion on your theme switcher. Typical pattern:

1. Read your app theme (`next-themes`, CSS variables, etc.).
2. Map tokens to `OnboardModalTheme` (see `coti-privacy-portal/src/hooks/useOnboardModalTheme.ts` for a reference implementation).
3. Pass the result to `privateUnlock.theme` and refresh it when the user toggles light/dark.

## Privacy Portal reference

The portal uses:

- `src/hooks/useOnboardModalTheme.ts` — builds light/dark palettes
- `src/App.tsx` — `privateUnlock={{ theme: useOnboardModalTheme(), warning: ... }}`
