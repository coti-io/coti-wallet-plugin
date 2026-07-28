import type { ethers } from 'ethers';

export type RpcSend = {
  /** JSON-RPC methods carried in this single HTTP round trip. */
  methods: string[];
  /** How many calls ethers batched into this round trip. */
  batchSize: number;
  at: number;
};

/**
 * Counts real RPC traffic by listening to ethers' `debug` events.
 *
 * Patching `globalThis.fetch` would observe nothing: ethers' Node build sends
 * over the `http`/`https` modules (`utils/geturl.js`), not `fetch`. The `debug`
 * event fires once per HTTP round trip and carries the whole payload, which is
 * exactly the distinction these tests exist to measure — HTTP round trips
 * versus the number of JSON-RPC calls packed into them.
 */
export class RpcMeter {
  readonly sends: RpcSend[] = [];
  readonly rpcErrors: unknown[] = [];
  private readonly attached = new WeakSet<object>();

  /** Listener registration is async in ethers v6, so this must be awaited. */
  async attach<T extends ethers.JsonRpcApiProvider>(provider: T): Promise<T> {
    if (this.attached.has(provider)) return provider;
    this.attached.add(provider);

    await provider.on('debug', (event: unknown) => {
      const e = event as { action?: string; payload?: unknown; error?: unknown };
      if (e?.action === 'sendRpcPayload') {
        const calls = (Array.isArray(e.payload) ? e.payload : [e.payload]) as Array<{
          method?: string;
        }>;
        this.sends.push({
          methods: calls.map(c => c?.method).filter((m): m is string => !!m),
          batchSize: calls.length,
          at: Date.now(),
        });
      } else if (e?.action === 'receiveRpcError') {
        this.rpcErrors.push(e.error);
      }
    });

    return provider;
  }

  /** HTTP round trips — what an endpoint's rate limiter actually counts. */
  get roundTrips(): number {
    return this.sends.length;
  }

  /** Individual JSON-RPC calls, however they were batched. */
  get rpcCalls(): number {
    return this.sends.reduce((n, s) => n + s.batchSize, 0);
  }

  countMethod(method: string): number {
    return this.sends.reduce((n, s) => n + s.methods.filter(m => m === method).length, 0);
  }

  get maxBatchSize(): number {
    return this.sends.reduce((n, s) => Math.max(n, s.batchSize), 0);
  }

  reset(): void {
    this.sends.length = 0;
    this.rpcErrors.length = 0;
  }

  describe(): string {
    return `${this.roundTrips} round trip(s), ${this.rpcCalls} rpc call(s), `
      + `max batch ${this.maxBatchSize}, ${this.rpcErrors.length} rpc error(s)`;
  }
}

/** Percentile over an unsorted sample, used for latency reporting. */
export const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
};
