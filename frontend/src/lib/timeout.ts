/** A wait that was given up on - see withTimeout. */
export class TimeoutError extends Error {
  constructor(public readonly what: 'storage' | 'server') {
    super(`${what} did not answer in time`);
    this.name = 'TimeoutError';
  }
}

/**
 * The same promise, or a TimeoutError after `ms`. The work itself carries on
 * and may still finish; only the caller stops waiting for it.
 *
 * The phone's IndexedDB can go quiet without ever failing - another tab of the
 * app, frozen in the background, holding an older copy of the database open -
 * and a fetch on one bar of signal can hang the same way. Nothing a player is
 * looking at may wait on either forever.
 */
export const withTimeout = <T>(
  work: PromiseLike<T>,
  ms: number,
  what: TimeoutError['what']
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(what)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
