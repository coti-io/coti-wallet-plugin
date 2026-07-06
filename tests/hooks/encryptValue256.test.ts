import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as CotiSDK from '@coti-io/coti-sdk-typescript';
import { encryptValue256 } from '../../src/hooks/privacyBridge/encryptValue256';

const WALLET = '0x1111111111111111111111111111111111111111';
const CONTRACT = '0x6cE8907414986E73De9e7D28d62Ea2080F8E88E1';
const SELECTOR = '0x83ae57f4';

describe('encryptValue256', () => {
  beforeEach(() => {
    vi.mocked(CotiSDK.buildItUint256WithSigner).mockClear();
  });

  it('delegates to SDK buildItUint256WithSigner with wallet signMessage callback', async () => {
    const signMessage = vi.fn(async () => `0x${'ab'.repeat(65)}`);

    const result = await encryptValue256(
      1_000_000_000_000_000_000n,
      'a'.repeat(32),
      CONTRACT,
      SELECTOR,
      WALLET,
      { signMessage } as never,
    );

    expect(result.signature).toMatch(/^0x/);
    expect(CotiSDK.buildItUint256WithSigner).toHaveBeenCalledWith({
      value: 1_000_000_000_000_000_000n,
      aesKey: 'a'.repeat(32),
      signerAddress: WALLET,
      contractAddress: CONTRACT,
      functionSelector: SELECTOR,
      signMessage: expect.any(Function),
    });
    const sdkCall = vi.mocked(CotiSDK.buildItUint256WithSigner).mock.calls[0][0];
    await sdkCall.signMessage(new Uint8Array([9, 9, 9]));
    expect(signMessage).toHaveBeenCalledWith(new Uint8Array([9, 9, 9]));
  });
});
