import { describe, expect, it } from 'vitest';
import { parseCtUint256Json, serializeCtUint256 } from '../../src/hooks/privacyBridge/privateValueCrypto';

describe('privateValueCrypto', () => {
  it('serializes and parses flat ctUint256 JSON', () => {
    const ciphertext = {
      ciphertextHigh: 123n,
      ciphertextLow: 456n,
    };

    const parsed = parseCtUint256Json(serializeCtUint256(ciphertext));
    expect(parsed).toEqual(ciphertext);
  });

  it('rejects invalid ciphertext JSON', () => {
    expect(() => parseCtUint256Json('{not-json')).toThrow(/valid JSON/i);
    expect(() => parseCtUint256Json('{"foo":"bar"}')).toThrow(/ctUint256/i);
  });
});
