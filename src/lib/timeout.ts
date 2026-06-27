/**
 * Shared async timeout helper.
 *
 * Use `withTimeout` to bound any promise (SDK call, fs op, child process,
 * network fetch) so a stalled dependency cannot hang the plugin or MCP server
 * indefinitely. The helper is intentionally simple and ref-counted (the
 * timeout actively fires) — see the inline note below for why we never
 * `timer.unref()` here.
 */

export interface WithTimeoutOptions {
  /**
   * Optional environment variable name to override `timeoutMs` at runtime.
   * If the env var is present and parses to a positive integer, that value is
   * used instead of the supplied default. Useful for slow-network / slow-disk
   * setups without having to recompile.
   */
  envOverride?: string;
}

/**
 * Resolve a positive integer millisecond value from an environment variable,
 * falling back to `fallback` when the env var is missing or invalid.
 *
 * Exposed for callers that want to derive their own default before invoking
 * `withTimeout` (for example to log the effective value).
 */
export function resolvePositiveEnvMs(name: string | undefined, fallback: number): number {
  if (!name) return fallback;
  const raw = process.env?.[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Race `promise` against a timeout and reject with a descriptive error if the
 * timeout fires first.
 *
 * Important: the internal timer is intentionally NOT `unref()`-ed. Previous
 * iterations of this helper called `timer.unref()` so the process could exit
 * even if the timer was outstanding; the practical effect on Bun/Node was that
 * the event loop drained before the rejection ever fired, which left awaits
 * silently hanging forever whenever the underlying SDK promise never
 * resolved. Keeping the timer ref'd guarantees the rejection fires and the
 * caller receives a real `timed out after Xms` error.
 *
 * Negative or non-finite `timeoutMs` values short-circuit and return the
 * input promise unchanged.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
  options: WithTimeoutOptions = {},
): Promise<T> {
  const effectiveTimeout = resolvePositiveEnvMs(options.envOverride, timeoutMs);
  if (!Number.isFinite(effectiveTimeout) || effectiveTimeout <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${effectiveTimeout}ms`));
    }, effectiveTimeout);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}
