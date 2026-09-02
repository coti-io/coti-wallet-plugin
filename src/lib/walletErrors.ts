const EIP_1193_USER_REJECTED = 4001;

/** MetaMask -32002: a permissions/snap request is already open for this origin. */
export function isRpcRequestAlreadyPending(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as { code?: number | string; message?: string };
  if (err.code === -32002 || err.code === '-32002') return true;
  const message = (err.message ?? '').toLowerCase();
  return message.includes('already pending');
}

/**
 * Polls until `isReady` or the attempt budget is exhausted.
 * Used when MetaMask already has a permission prompt open (-32002):
 * do not send another `wallet_requestPermissions` / `eth_requestAccounts`.
 */
export async function retryWhilePending<T>(
  probe: () => Promise<T>,
  isReady: (value: T) => boolean,
  options?: { attempts?: number; delayMs?: number },
): Promise<T> {
  const attempts = Math.max(1, options?.attempts ?? 12);
  const delayMs = options?.delayMs ?? 250;
  let last = await probe();
  for (let i = 1; i < attempts && !isReady(last); i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    last = await probe();
  }
  return last;
}

export function isUserRejection(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const err = error as {
      code?: number | string;
      message?: string;
      reason?: string;
      info?: { error?: { code?: number | string; message?: string } };
    };
    if (err.code === EIP_1193_USER_REJECTED) return true;
    if (err.info?.error?.code === EIP_1193_USER_REJECTED) return true;
    if (err.code === 'ACTION_REJECTED' || err.reason === 'rejected') return true;
    const message = `${err.message ?? ''} ${err.info?.error?.message ?? ''}`.toLowerCase();
    if (
      message.includes('user rejected')
      || message.includes('user denied')
      || message.includes('rejected the request')
      || message.includes('request rejected')
      || message.includes('action_rejected')
      || message.includes('user cancelled')
      || message.includes('user canceled')
    ) {
      return true;
    }
  }
  return false;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return String(error);
}

export function isInsufficientFundsError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes('insufficient funds')
    || message.includes('insufficient balance')
    || message.includes('account balance is 0')
    || message.includes('not enough coti')
    || message.includes('not enough balance')
    || message.includes('insufficient funds for transfer')
  );
}
