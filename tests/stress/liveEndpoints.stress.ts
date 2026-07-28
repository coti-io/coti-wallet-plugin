import { describe, it, expect } from 'vitest';
import { ethers } from 'ethers';
import {
  CT_BALANCE_ABI,
  ERC20_BALANCE_ABI,
  FUJI_CHAIN_ID,
  FUJI_PRIVATE_MTT,
  FUJI_TOKENS,
  FUJI_URLS,
  ORACLE_ABI,
  READ_ACCOUNT,
  labelFor,
  probeAll,
  probeEndpoint,
  table,
} from './helpers/fuji';
import { avalancheFujiChain } from '../../src/chains/avalancheFuji';

/**
 * Ground truth for the configured endpoint list, and a real read of every
 * contract the plugin touches on Fuji.
 *
 * This suite is the reason the fallback list is shaped the way it is. Endpoint
 * health is genuinely volatile — one run caught publicnode at HTTP 503 and drpc
 * at HTTP 400 while both were healthy minutes later — so it reports rather than
 * hard-asserts per-endpoint uptime. What it does assert is the property that
 * actually matters: *some* configured endpoint serves every read.
 */
describe('live Fuji endpoints', () => {
  it('reports health across every configured endpoint', async () => {
    const results = await probeAll();

    console.log(
      '\n[configured Fuji endpoints, primary first]\n'
        + table([
          ['endpoint', 'status', 'latency', 'detail'],
          ...results.map(r => [
            labelFor(r.url),
            r.ok ? 'ok' : 'FAIL',
            `${r.ms}ms`,
            r.ok ? `block ${r.blockNumber}` : (r.error ?? ''),
          ]),
        ]),
    );

    const healthy = results.filter(r => r.ok);
    // The point of a fallback list is that no single endpoint is load-bearing.
    expect(
      healthy.length,
      `no configured Fuji endpoint responded:\n${results.map(r => `${r.url} -> ${r.error}`).join('\n')}`,
    ).toBeGreaterThan(0);

    // Depth is the whole mitigation; one survivor is not a fallback list.
    expect(
      healthy.length,
      'only one endpoint healthy — fallback depth has eroded, re-check the list',
    ).toBeGreaterThan(1);
  });

  it('has no duplicate or malformed entries', () => {
    expect(new Set(FUJI_URLS).size).toBe(FUJI_URLS.length);
    for (const url of FUJI_URLS) {
      expect(() => new URL(url), `malformed RPC url: ${url}`).not.toThrow();
      expect(url.startsWith('https://'), `RPC url must be https: ${url}`).toBe(true);
    }
  });

  it('reads every public ERC-20 the plugin shows on Fuji', async () => {
    const url = await firstHealthyUrl();
    const provider = new ethers.JsonRpcProvider(url, FUJI_CHAIN_ID, { staticNetwork: true });

    const rows: string[][] = [['token', 'symbol', 'decimals', 'balance']];
    for (const [name, address] of Object.entries(FUJI_TOKENS)) {
      const contract = new ethers.Contract(address, ERC20_BALANCE_ABI, provider);
      const [symbol, decimals, balance] = await Promise.all([
        contract.symbol(),
        contract.decimals(),
        contract.balanceOf(READ_ACCOUNT),
      ]);
      expect(symbol, `${name} has no symbol — wrong address?`).toBeTruthy();
      rows.push([name, String(symbol), String(decimals), ethers.formatUnits(balance, decimals)]);
    }

    console.log(`\n[public ERC-20 reads via ${labelFor(url)}]\n` + table(rows));
  });

  it('reads a private pToken balance as a ctUint256 rather than plaintext', async () => {
    const url = await firstHealthyUrl();
    const provider = new ethers.JsonRpcProvider(url, FUJI_CHAIN_ID, { staticNetwork: true });

    const contract = new ethers.Contract(FUJI_PRIVATE_MTT, CT_BALANCE_ABI, provider);
    const balance = await contract.balanceOf(READ_ACCOUNT);

    // Two ciphertext limbs, not a single uint256 — this is the shape
    // usePrivateTokenBalance decodes. Decryption needs an AES key, so the value
    // itself is deliberately not asserted.
    expect(balance.ciphertextHigh ?? balance[0]).toBeTypeOf('bigint');
    expect(balance.ciphertextLow ?? balance[1]).toBeTypeOf('bigint');
  });

  it('reads a live USD price from the PoD oracle', async () => {
    const url = await firstHealthyUrl();
    const provider = new ethers.JsonRpcProvider(url, FUJI_CHAIN_ID, { staticNetwork: true });

    const oracleAddress = avalancheFujiChain.priceOracleAddress!;
    const oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, provider);
    const raw: bigint = await oracle.getLivePrice(FUJI_TOKENS.WAVAX);

    // The adapter returns 0 rather than reverting when a feed is unset or stale,
    // so 0 means "no live feed" and is worth surfacing loudly.
    expect(raw, 'PoD oracle returned no live AVAX feed').toBeGreaterThan(0n);
    const usd = Number(ethers.formatEther(raw));
    console.log(`\n[PoD oracle] AVAX/USD = ${usd}`);
    expect(usd).toBeGreaterThan(0);
  });
});

/** First endpoint that answers, so contract reads are not hostage to one host. */
async function firstHealthyUrl(): Promise<string> {
  for (const url of FUJI_URLS) {
    const health = await probeEndpoint(url, 6_000);
    if (health.ok) return url;
  }
  throw new Error('no healthy Fuji endpoint available for contract reads');
}
