import { ethers } from 'ethers';
import { encryptUint256 } from '@coti-io/coti-sdk-typescript';
import { decryptCtUint256 } from '../../crypto/decryption';
import type { CtUint256 } from '../../types/ciphertext';
import { isCtUint256 } from '../../types/ciphertext';
import { normalizeAesKeyHex } from './executePrivateTokenTransfer';

export function parsePrivateAmountToWei(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!trimmed) {
    throw new Error('Amount is required.');
  }
  return ethers.parseUnits(trimmed, decimals);
}

export function formatPrivateAmountFromWei(value: bigint, decimals: number): string {
  return ethers.formatUnits(value, decimals);
}

export function serializeCtUint256(ciphertext: CtUint256): string {
  if ('ciphertextHigh' in ciphertext && 'ciphertextLow' in ciphertext) {
    return JSON.stringify({
      ciphertextHigh: ciphertext.ciphertextHigh.toString(),
      ciphertextLow: ciphertext.ciphertextLow.toString(),
    });
  }

  return JSON.stringify({
    high: {
      high: ciphertext.high.high.toString(),
      low: ciphertext.high.low.toString(),
    },
    low: {
      high: ciphertext.low.high.toString(),
      low: ciphertext.low.low.toString(),
    },
  });
}

export function parseCtUint256Json(raw: string): CtUint256 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Ciphertext must be valid JSON.');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Ciphertext JSON must be an object.');
  }

  const value = parsed as Record<string, unknown>;

  if ('ciphertextHigh' in value && 'ciphertextLow' in value) {
    const ciphertext: CtUint256 = {
      ciphertextHigh: BigInt(String(value.ciphertextHigh)),
      ciphertextLow: BigInt(String(value.ciphertextLow)),
    };
    if (!isCtUint256(ciphertext)) {
      throw new Error('Invalid flat ctUint256 ciphertext.');
    }
    return ciphertext;
  }

  if ('high' in value && 'low' in value) {
    const high = value.high as Record<string, unknown>;
    const low = value.low as Record<string, unknown>;
    const ciphertext: CtUint256 = {
      high: {
        high: BigInt(String(high.high)),
        low: BigInt(String(high.low)),
      },
      low: {
        high: BigInt(String(low.high)),
        low: BigInt(String(low.low)),
      },
    };
    if (!isCtUint256(ciphertext)) {
      throw new Error('Invalid nested ctUint256 ciphertext.');
    }
    return ciphertext;
  }

  throw new Error('Ciphertext JSON must contain flat or nested ctUint256 fields.');
}

export function encryptPrivateCtUint256(params: {
  amount: string;
  decimals: number;
  aesKey: string;
}): CtUint256 {
  const wei = parsePrivateAmountToWei(params.amount, params.decimals);
  return encryptUint256(wei, normalizeAesKeyHex(params.aesKey));
}

export function decryptPrivateCtUint256(params: {
  ciphertext: CtUint256;
  decimals: number;
  aesKey: string;
}): string {
  const wei = decryptCtUint256(params.ciphertext, normalizeAesKeyHex(params.aesKey), {
    decimals: params.decimals,
  });
  return formatPrivateAmountFromWei(wei, params.decimals);
}
