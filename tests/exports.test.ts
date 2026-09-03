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
  QueryClient: class QueryClient {},
  QueryClientProvider: ({ children }: { children: unknown }) => children,
}));

vi.mock('@rainbow-me/rainbowkit', () => ({
  RainbowKitProvider: ({ children }: { children: unknown }) => children,
  useConnectModal: vi.fn(() => ({ openConnectModal: vi.fn() })),
  connectorsForWallets: vi.fn(() => []),
}));

vi.mock('viem', () => ({
  defineChain: (config: any) => config,
}));

describe('Package Exports (README: Installation & API)', () => {
  it('exports configureCotiPlugin, getPluginConfig, and PLUGIN_VERSION', async () => {
    const mod = await import('../src/index');
    expect(mod.configureCotiPlugin).toBeDefined();
    expect(mod.getPluginConfig).toBeDefined();
    expect(mod.PLUGIN_VERSION).toBeDefined();
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
    // getRpcUrlForChainId is now exported from config/chains (single source of truth)
    const chains = await import('../src/config/chains');
    expect(chains.getRpcUrlForChainId).toBeDefined();
  });

  it('exports estimateBridgeFee', async () => {
    const mod = await import('../src/hooks/useEstimateBridgeFees');
    expect(mod.estimateBridgeFee).toBeDefined();
  });

  it('exports crypto modules', async () => {
    const aesKey = await import('../src/crypto/aesKey');
    expect(aesKey.normalizeAesKey).toBeDefined();
    expect(aesKey.validateAesKey).toBeDefined();
  });

  it('does not publish internals on the package barrel', async () => {
    const mod = await import('../src/index') as Record<string, unknown>;
    const withheld = [
      'useBalanceUpdater',
      'muteChainUpdates',
      'unmuteChainUpdates',
      'isChainUpdatesMuted',
      'logger',
      'setDebugLogging',
      'TOKEN_ABI',
      'BRIDGE_ABI',
      'BRIDGE_ERC20_ABI',
      'COTI_PRICE_CONSUMER_ABI',
      'ERC20_ABI',
      'PRIVACY_PORTAL_ABI',
      'POD_PTOKEN_ABI',
      'POD_PORTAL_ADMIN_ABI',
      'POD_PORTAL_FACTORY_ABI',
      'POD_PRICE_ORACLE_ABI',
      'COTI_MAINNET_RPC',
      'COTI_TESTNET_RPC',
      'SEPOLIA_RPC',
      'SEPOLIA_RPC_FALLBACK',
      'ETHEREUM_MAINNET_RPC',
      'loadPodRequests',
      'savePodRequests',
      'podRequestsStorageKey',
      'getSepoliaGasPrice',
      'WagmiRainbowKitProvider',
      'getWagmiConfig',
      'wagmiConfig',
      'mobileZerionWallet',
      'WALLET_CONNECT_FAILURE_EVENT',
      'useConnectModal',
      'useMetamask',
      'OnboardModal',
      'onboardModalDefaultStyles',
      'ONBOARD_MODAL_STYLE_KEYS',
      'CHAIN_CONFIGS',
      'getChainConfig',
      'requireChainConfig',
      'getRpcUrlForChain',
      'getRpcUrlsForChain',
      'estimateCotiBridgeGasFeeDisplay',
      'quoteCotiBridgeFees',
      'quotePortalFeeOnly',
      'quotePodPortalTransactionFees',
      'estimatePodPortalFees',
      'formatPortalFeeDisplay',
      'formatPodFeeDisplay',
      'quotePodPrivateTokenTransferFees',
      'quotePodTransferFees',
      'usePodTransferFees',
      'fetchPodOracleTokenUsdPrice',
      'fetchPodBridgeData',
      'simulatePodPortalFee',
      'useBridgeData',
      'useBridgeStatus',
      'estimateBridgeFee',
      'fetchBridgeFees',
      'fetchTokenUsdPrice',
      'computeCotiFee',
      'computeErc20Fee',
      'simulateFeeOnChain',
      'getTokenSimulationMeta',
      'getPodGasPrice',
    ];
    for (const name of withheld) {
      expect(mod[name], name).toBeUndefined();
    }
    expect(mod.CotiPluginProvider).toBeDefined();
    expect(mod.usePrivateUnlock).toBeDefined();
    expect(mod.configureCotiPlugin).toBeDefined();
    expect(mod.useCotiSwap).toBeDefined();
  });

  it('exports RainbowKit helpers from the rainbowkit entry', async () => {
    const mod = await import('../src/rainbowkit') as Record<string, unknown>;
    expect(mod.WagmiRainbowKitProvider).toBeDefined();
    expect(mod.getWagmiConfig).toBeDefined();
    expect(mod.wagmiConfig).toBeDefined();
    expect(mod.mobileZerionWallet).toBeDefined();
    expect(mod.WALLET_CONNECT_FAILURE_EVENT).toBeDefined();
    expect(mod.useConnectModal).toBeDefined();
  });
});
