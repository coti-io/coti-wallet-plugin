/**
 * Verifies on-chain balance reads match expected values for known test wallets.
 * Run: npm run verify:balances
 */
import { ethers } from 'ethers';
import { decryptUint } from '@coti-io/coti-sdk-typescript';

const NESTED_ABI = [
  'function balanceOf(address account) view returns (tuple(tuple(uint256 high, uint256 low) high, tuple(uint256 high, uint256 low) low))',
];
const FLAT_ABI = [
  'function balanceOf(address) view returns (tuple(uint256 ciphertextHigh, uint256 ciphertextLow))',
];
const ERC20_ABI = ['function balanceOf(address) view returns (uint256)'];

const EXPECTED = [
  {
    label: 'Sepolia',
    chainId: 11155111,
    rpc: 'https://ethereum-sepolia-rpc.publicnode.com',
    wallet: '0xb64381b3EE1161c1fE7858Bb600fa65D9Da1f3fc',
    aesKey: 'e41f8141802d93c6079c03daa0041a63',
    nativeSymbol: 'ETH',
    minNative: 0.01,
    addresses: {
      MTT: '0xd3f5c63f4D87D2235b295FbA83351d31d0eD1BeE',
      'p.MTT': '0x34727cc7233e6B20aE071Cd16A81027172b6bdbA',
      'p.ETH': '0x4667DFcbCd354c2719E129A9FcC2Bb3a98456b91',
    },
    expectPrivate: { 'p.MTT': 100, 'p.ETH': 0 },
  },
  {
    label: 'Fuji',
    chainId: 43113,
    rpc: 'https://api.avax-test.network/ext/bc/C/rpc',
    wallet: '0xC93b05B38c2D3B57977335A9D3FD5Dcf6aa8E71a',
    aesKey: '83e5bf3298bc803486ca5a01abec2298',
    nativeSymbol: 'AVAX',
    minNative: 0.01,
    addresses: {
      MTT: '0x328e70e1c52662cd5f19f824fcb8b463d77a6686',
      'p.MTT': '0x53a5A16f3BC408CB808B442fA69481386945f5cf',
      'p.AVAX': '0x69dF41ebdd5D5e0017c1965bd480843857158324',
    },
    expectPrivate: { 'p.MTT': 500, 'p.AVAX': 0 },
  },
];

function isZeroNested(r) {
  const hh = r.high?.high ?? r[0]?.[0];
  const hl = r.high?.low ?? r[0]?.[1];
  const lh = r.low?.high ?? r[1]?.[0];
  const ll = r.low?.low ?? r[1]?.[1];
  return [hh, hl, lh, ll].every(v => v === 0n || v === undefined);
}

function decryptNested(enc, aesKey) {
  const d1 = decryptUint(enc.high.high, aesKey);
  const d2 = decryptUint(enc.high.low, aesKey);
  const d3 = decryptUint(enc.low.high, aesKey);
  const d4 = decryptUint(enc.low.low, aesKey);
  return (BigInt(d1) << 192n) + (BigInt(d2) << 128n) + (BigInt(d3) << 64n) + BigInt(d4);
}

/** Mirrors usePrivateTokenBalance fetch path. */
async function fetchPrivateBalance(provider, user, aesKey, contractAddress) {
  const nested = new ethers.Contract(contractAddress, NESTED_ABI, provider);
  const flat = new ethers.Contract(contractAddress, FLAT_ABI, provider);
  try {
    const enc = await nested.balanceOf(user);
    if (enc?.high?.high !== undefined || enc?.[0]?.[0] !== undefined) {
      if (isZeroNested(enc)) return 0;
      return Number(ethers.formatUnits(decryptNested(enc, aesKey), 18));
    }
    throw new Error('not nested');
  } catch {
    const enc = await flat.balanceOf(user);
    const high = enc.ciphertextHigh ?? enc[0] ?? 0n;
    const low = enc.ciphertextLow ?? enc[1] ?? 0n;
    if (high === 0n && low === 0n) return 0;
    const d1 = decryptUint(high, aesKey);
    const d2 = decryptUint(low, aesKey);
    const val = (BigInt(d1) << 64n) + BigInt(d2);
    return Number(ethers.formatUnits(val, 18));
  }
}

let failed = false;

for (const c of EXPECTED) {
  console.log(`\n=== ${c.label} ===`);
  const provider = new ethers.JsonRpcProvider(c.rpc, c.chainId);
  const native = Number(ethers.formatEther(await provider.getBalance(c.wallet)));
  console.log(`Public ${c.nativeSymbol}: ${native}`);
  if (native < c.minNative) {
    console.error(`FAIL: ${c.nativeSymbol} balance ${native} < ${c.minNative}`);
    failed = true;
  }

  const mtt = new ethers.Contract(c.addresses.MTT, ERC20_ABI, provider);
  const mttBal = Number(ethers.formatUnits(await mtt.balanceOf(c.wallet), 18));
  console.log(`Public MTT: ${mttBal}`);
  if (mttBal <= 0) {
    console.error('FAIL: public MTT should be > 0');
    failed = true;
  }

  for (const [sym, addr] of Object.entries(c.addresses).filter(([k]) => k.startsWith('p.'))) {
    const bal = await fetchPrivateBalance(provider, c.wallet, c.aesKey, addr);
    const expected = c.expectPrivate[sym];
    console.log(`${sym}: ${bal} (expected ${expected})`);
    if (bal !== expected) {
      console.error(`FAIL: ${sym} balance ${bal} !== expected ${expected}`);
      failed = true;
    }
  }
}

if (failed) {
  console.error('\n❌ Balance verification FAILED');
  process.exit(1);
}
console.log('\n✅ Balance verification PASSED');
