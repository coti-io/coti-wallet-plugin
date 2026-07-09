import { injected } from 'wagmi/connectors';

type InjectedOptions = NonNullable<Parameters<typeof injected>[0]>;
type InjectedTarget = NonNullable<InjectedOptions['target']>;

/** Wagmi's injected target type is stricter than EIP-1193 provider discovery. */
export const asInjectedTarget = (target: unknown): InjectedTarget =>
  target as InjectedTarget;
