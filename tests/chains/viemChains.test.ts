import { describe, it, expect } from 'vitest';
import { chainConfigToViemChain } from '../../src/chains/viemChains';
import { getChainConfig } from '../../src/chains';

describe('viemChains', () => {
  it('uses generic Explorer label for unknown explorer hosts', () => {
    const base = getChainConfig(7082400)!;
    const chain = chainConfigToViemChain({
      ...base,
      explorerBaseUrl: 'https://custom-explorer.example',
    });

    expect(chain.blockExplorers?.default.name).toBe('Explorer');
    expect(chain.blockExplorers?.default.url).toBe('https://custom-explorer.example');
  });

  it('uses CotiScan label for cotiscan explorer URLs', () => {
    const base = getChainConfig(7082400)!;
    const chain = chainConfigToViemChain(base);

    expect(chain.blockExplorers?.default.name).toBe('CotiScan');
  });

  it('uses Etherscan label for etherscan explorer URLs', () => {
    const base = getChainConfig(11155111)!;
    const chain = chainConfigToViemChain(base);

    expect(chain.blockExplorers?.default.name).toBe('Etherscan');
  });
});
