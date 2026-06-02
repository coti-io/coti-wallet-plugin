import { describe, it, expect, vi } from 'vitest';

// Mock wagmi and rainbowkit before importing
vi.mock('wagmi', () => ({
  createConfig: vi.fn(() => ({})),
  WagmiProvider: ({ children }: any) => children,
  useAccount: vi.fn(() => ({ address: undefined, isConnected: false, connector: undefined })),
  useConnectorClient: vi.fn(() => ({ data: undefined })),
  useSwitchChain: vi.fn(() => ({ switchChain: vi.fn() })),
  http: vi.fn(),
}));

vi.mock('wagmi/connectors', () => ({
  injected: vi.fn(() => ({})),
  coinbaseWallet: vi.fn(() => ({})),
  walletConnect: vi.fn(() => ({})),
}));

vi.mock('@tanstack/react-query', () => ({
  QueryClient: vi.fn(() => ({})),
  QueryClientProvider: ({ children }: any) => children,
}));

vi.mock('@rainbow-me/rainbowkit', () => ({
  RainbowKitProvider: ({ children }: any) => children,
  useConnectModal: vi.fn(() => ({ openConnectModal: vi.fn() })),
}));

vi.mock('viem', () => ({
  defineChain: (config: any) => config,
}));

describe('Package Exports (README: Installation & API)', () => {
  it('exports configureCotiPlugin and getPluginConfig', async () => {
    const mod = await import('../src/config/plugin');
    expect(mod.configureCotiPlugin).toBeDefined();
    expect(mod.getPluginConfig).toBeDefined();
  });

  it('exports chain definitions', async () => {
    const mod = await import('../src/config/chains');
    expect(mod.cotiMainnet).toBeDefined();
    expect(mod.cotiTestnet).toBeDefined();
    expect(mod.COTI_MAINNET_CHAIN_ID).toBe(2632500);
    expect(mod.COTI_TESTNET_CHAIN_ID).toBe(7082400);
    expect(mod.COTI_MAINNET_RPC).toBeDefined();
    expect(mod.COTI_TESTNET_RPC).toBeDefined();
    expect(mod.getRpcUrlForChainId).toBeDefined();
  });

  it('exports CONTRACT_ADDRESSES and SUPPORTED_TOKENS', async () => {
    const mod = await import('../src/contracts/config');
    expect(mod.CONTRACT_ADDRESSES).toBeDefined();
    expect(mod.SUPPORTED_TOKENS).toBeDefined();
    expect(mod.MINIMUM_PORTAL_IN_AMOUNTS).toBeDefined();
    expect(mod.ERC20_ABI).toBeDefined();
    expect(mod.getPublicTokensForChain).toBeDefined();
    expect(mod.getPrivateTokensForChain).toBeDefined();
  });

  it('exports ABIs', async () => {
    const mod = await import('../src/contracts/abis');
    expect(mod.TOKEN_ABI).toBeDefined();
    expect(mod.BRIDGE_ABI).toBeDefined();
    expect(mod.BRIDGE_ERC20_ABI).toBeDefined();
    expect(mod.COTI_PRICE_CONSUMER_ABI).toBeDefined();
  });

  it('exports LIMITS', async () => {
    const mod = await import('../src/contracts/limits');
    expect(mod.LIMITS).toBeDefined();
  });

  it('exports useWalletType and mapConnectorIdToWalletType', async () => {
    const mod = await import('../src/hooks/useWalletType');
    expect(mod.useWalletType).toBeDefined();
    expect(mod.mapConnectorIdToWalletType).toBeDefined();
  });

  it('exports useAesKeyProvider and isValidAesKey', async () => {
    const mod = await import('../src/hooks/useAesKeyProvider');
    expect(mod.useAesKeyProvider).toBeDefined();
    expect(mod.isValidAesKey).toBeDefined();
  });

  it('exports useBridgeStatus', async () => {
    const mod = await import('../src/hooks/useBridgeStatus');
    expect(mod.useBridgeStatus).toBeDefined();
  });

  it('exports utility functions', async () => {
    const mod = await import('../src/lib/utils');
    expect(mod.formatTokenBalanceDisplay).toBeDefined();
    expect(mod.truncateDecimalValue).toBeDefined();
    expect(mod.formatBalanceWithNotation).toBeDefined();
    expect(mod.addThousandsSeparators).toBeDefined();
  });

  it('exports getEthereumProvider', async () => {
    const mod = await import('../src/lib/ethereum');
    expect(mod.getEthereumProvider).toBeDefined();
  });

  it('exports wallet error utilities', async () => {
    const mod = await import('../src/utils/walletErrors');
    expect(mod.isMultipleWalletsError).toBeDefined();
    expect(mod.MULTIPLE_WALLETS_ERROR_SUBSTRING).toBeDefined();
  });

  it('exports bridge fee computation functions', async () => {
    const mod = await import('../src/hooks/useBridgeFees');
    expect(mod.computeCotiFee).toBeDefined();
    expect(mod.computeErc20Fee).toBeDefined();
    expect(mod.getTokenSimulationMeta).toBeDefined();
    expect(mod.getRpcUrlForChainId).toBeDefined();
  });

  it('exports estimateBridgeFee', async () => {
    const mod = await import('../src/hooks/useEstimateBridgeFees');
    expect(mod.estimateBridgeFee).toBeDefined();
  });

  it('exports crypto modules', async () => {
    const aesKey = await import('../src/crypto/aesKey');
    expect(aesKey.normalizeAesKey).toBeDefined();
    expect(aesKey.validateAesKey).toBeDefined();

    const signature = await import('../src/crypto/signature');
    expect(signature.signDigest).toBeDefined();
    expect(signature.buildItSignature).toBeDefined();
    expect(signature.normalizeSignature).toBeDefined();

    const wallet = await import('../src/crypto/wallet');
    expect(wallet.deriveWallet).toBeDefined();
  });
});
