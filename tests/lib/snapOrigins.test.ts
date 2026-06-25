import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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
});
