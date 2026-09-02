import { describe, expect, it, vi } from 'vitest';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';
import {
  decryptPrivateCtUint256,
  encryptPrivateCtUint256,
  formatPrivateAmountFromWei,
  parseCtUint256Json,
  parsePrivateAmountToWei,
  serializeCtUint256,
} from '../../src/hooks/bridge/privateValueCrypto';

const AES_KEY = 'a'.repeat(32);

describe('privateValueCrypto', () => {
  it('serializes and parses flat ctUint256 JSON', () => {
    const ciphertext = {
      ciphertextHigh: 123n,
      ciphertextLow: 456n,
    };

    const parsed = parseCtUint256Json(serializeCtUint256(ciphertext));
    expect(parsed).toEqual(ciphertext);
  });

  it('serializes and parses nested ctUint256 JSON', () => {
    const ciphertext = {
      high: { high: 1n, low: 2n },
      low: { high: 3n, low: 4n },
    };

    const parsed = parseCtUint256Json(serializeCtUint256(ciphertext));
    expect(parsed).toEqual(ciphertext);
  });

  it('rejects invalid ciphertext JSON', () => {
    expect(() => parseCtUint256Json('{not-json')).toThrow(/valid JSON/i);
    expect(() => parseCtUint256Json('null')).toThrow(/must be an object/i);
    expect(() => parseCtUint256Json('{"foo":"bar"}')).toThrow(/ctUint256/i);
  });

  it('parses amount strings to wei and formats them back', () => {
    expect(parsePrivateAmountToWei('1.5', 18)).toBe(1500000000000000000n);
    expect(formatPrivateAmountFromWei(1500000000000000000n, 18)).toBe('1.5');
    expect(() => parsePrivateAmountToWei('   ', 18)).toThrow(/Amount is required/i);
  });

  it('encrypts a private amount through the SDK', () => {
    vi.mocked(CotiSDK.encryptUint256).mockReturnValueOnce({
      ciphertextHigh: 9n,
      ciphertextLow: 8n,
    });

    expect(encryptPrivateCtUint256({ amount: '1', decimals: 18, aesKey: AES_KEY })).toEqual({
      ciphertextHigh: 9n,
      ciphertextLow: 8n,
    });
    expect(CotiSDK.encryptUint256).toHaveBeenCalledWith(10n ** 18n, AES_KEY);
  });

  it('decrypts a private amount and rejects a failed decrypt', () => {
    const ciphertext = { ciphertextHigh: 1n, ciphertextLow: 2n };
    vi.mocked(CotiSDK.decryptUint256).mockReturnValueOnce(10n ** 18n);

    expect(decryptPrivateCtUint256({ ciphertext, decimals: 18, aesKey: AES_KEY })).toBe('1.0');

    vi.mocked(CotiSDK.decryptUint256).mockImplementationOnce(() => {
      throw new Error('bad key');
    });
    expect(() => decryptPrivateCtUint256({ ciphertext, decimals: 18, aesKey: AES_KEY })).toThrow(
      /AES key mismatch/i,
    );
  });
});
