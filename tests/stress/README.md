# RPC stress / integration suite

Real tests against live Avalanche Fuji endpoints and real deployed contracts.
They exist to answer "how does the provider actually behave" with measurements
rather than assertions against mocks.

```bash
npm run test:stress
```

Not part of `npm test`: they are slow, depend on third-party uptime, and consume
endpoint quota. Files use a `.stress.ts` suffix so the unit config's
`tests/**/*.test.ts` glob cannot pick them up.

## What each file covers

| File | Answers |
|---|---|
| `liveEndpoints.stress.ts` | Is each configured Fuji endpoint up? Do MTT/USDC/WAVAX, the p.MTT ciphertext, and the PoD oracle all read correctly? |
| `providerBehavior.stress.ts` | Does `staticNetwork` really remove `eth_chainId`? Do concurrent reads batch into one round trip? How much traffic did memoization save? |
| `fallbackResilience.stress.ts` | Does a dead endpoint fail over? Does the cooldown park it? Does a revert correctly *not* rotate? |
| `balanceLoad.stress.ts` | How does a balance refresh hold up under concurrency, and which endpoints carry the load? |

## Measuring RPC traffic

`helpers/rpcMeter.ts` listens to ethers' `debug` events. Patching `globalThis.fetch`
would observe nothing — ethers' Node build sends over the `http`/`https` modules,
not `fetch`. The `debug` event fires once per HTTP round trip and carries the
whole payload, which is the distinction that matters: **HTTP round trips** (what a
rate limiter counts) versus **JSON-RPC calls** (the useful work).

## Sample output

```
[round trips for one 4-read balance refresh]
                   http round trips  rpc calls  eth_chainId
per-call provider  4                 8          4
memoized + static  1                 4          0
```

## Notes for whoever runs this next

- **Endpoint health is volatile.** One run caught publicnode at HTTP 503 and drpc
  at HTTP 400 while both were healthy minutes later. `liveEndpoints.stress.ts`
  therefore *reports* per-endpoint health and only asserts that more than one
  endpoint answers. A single failing endpoint is not necessarily a regression;
  losing fallback depth is.
- **Re-run this before editing the Fuji RPC list** in `src/chains/avalancheFuji.ts`.
  `rpc.ankr.com/avalanche_fuji` was dropped because it stopped answering keyless
  requests at all (0/6 probes).
- **Be a good citizen.** Defaults are deliberately modest. Turn the load up with
  `STRESS_MAX_CONCURRENCY=32 STRESS_ROUNDS=5 npm run test:stress`, remembering
  that the QuikNode entry is a shared key with finite quota.
- These run under `environment: 'node'`, not jsdom. Under jsdom, Vite resolves
  ethers' `browser` field to the fetch transport, which mis-parses batched
  JSON-RPC responses. A consequence is that `window` is undefined, so
  `reportPluginError` no-ops here; its dispatch path is covered by the unit suite.
