import { describe, it, expect, afterEach } from 'vitest';
import { configureCotiPlugin } from '../../src/config/plugin';
import { canPersistAesKeyToSnap } from '../../src/lib/snapOrigins';

describe('snapOrigins', () => {
  const originalOrigin = window.location.origin;

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, origin: originalOrigin },
    });
  });

  it('allows companion dApp origins', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, origin: 'https://dev.metamask.coti.io' },
    });
    expect(canPersistAesKeyToSnap()).toBe(true);
  });

  it('blocks localhost portal dev origin until snap npm whitelists it', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, origin: 'http://localhost:8080' },
    });
    expect(canPersistAesKeyToSnap()).toBe(false);
  });

  it('allows origins from additionalSnapAesWriteOrigins config', () => {
    configureCotiPlugin({
      additionalSnapAesWriteOrigins: ['https://portal.example.com'],
    });
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, origin: 'https://portal.example.com' },
    });
    expect(canPersistAesKeyToSnap()).toBe(true);
    configureCotiPlugin({ additionalSnapAesWriteOrigins: [] });
  });

  it('allows the published companion origin and rejects unknown origins', () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, origin: 'https://metamask.coti.io' },
    });
    expect(canPersistAesKeyToSnap()).toBe(true);

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, origin: 'https://evil.example' },
    });
    expect(canPersistAesKeyToSnap()).toBe(false);
  });
});
