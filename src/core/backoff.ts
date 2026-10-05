const RETRY_BASE_INTERVAL_SECS = 5;
const MAX_BACKOFF_SECS = 5 * 60; // 300 seconds

/**
 * Computes an exponential backoff delay compatible with Firefox's implementation:
 *   retryTimeout = retryBaseInterval * 2^(retryCount - 1)
 *   capped at pingInterval (5 minutes)
 *
 * Sequence: 5s, 10s, 20s, 40s, 80s, 160s, 300s, 300s...
 */
export function calcBackoff(retryCount: number): number {
  if (retryCount <= 0) {
    return RETRY_BASE_INTERVAL_SECS;
  }
  const exponent = Math.min(retryCount - 1, 10); // prevent number overflow
  const delay = RETRY_BASE_INTERVAL_SECS * 2 ** exponent;
  return Math.min(delay, MAX_BACKOFF_SECS);
}

/**
 * Asynchronously sleeps for the given milliseconds, abortable via AbortSignal.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error('sleep aborted'));
  }

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timerId);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error('sleep aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    const timerId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
  });
}
