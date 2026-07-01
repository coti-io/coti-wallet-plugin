import { vi } from 'vitest';

export class BrowserProvider {
  constructor(public provider: any) {}
  getSigner = vi.fn().mockResolvedValue({
    generateOrRecoverAes: vi.fn().mockResolvedValue(undefined),
    getUserOnboardInfo: vi.fn().mockReturnValue({ aesKey: 'a'.repeat(32) }),
    getAddress: vi.fn().mockResolvedValue('0x1234567890abcdef1234567890abcdef12345678'),
  });
}
