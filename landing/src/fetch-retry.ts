/* Retry for idempotent dashboard GETs while the backend is briefly down.

   The backend answers 429 (no instance available) or 503 for one to three
   minutes when Cloud Run swaps its single instance. A GET is safe to repeat,
   so installFetchRetry() wraps window.fetch once (main.tsx, after mock.ts)
   and repeats same-origin GETs to /api/ and /auth/ on those statuses and on
   network errors, honoring Retry-After. Writes are never retried: a POST
   that timed out may already have happened. /auth/me is left to identity.ts,
   which has its own longer retry and decides sign-in.

   Imported with .ts extensions elsewhere so node --test can run it. */

import { beginReconnecting } from "./connection-status.ts";

/* Statuses that mean "the server is briefly unavailable", not "no". */
export const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 15_000;
/* Never sleep longer than this on a server's Retry-After. */
const MAX_RETRY_AFTER_MS = 60_000;
/* Attempts per data GET (first try included): about 20 s of waiting. */
export const DATA_GET_ATTEMPTS = 5;

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type Sleep = (ms: number, signal?: AbortSignal | null) => Promise<void>;

/* Retry-After as milliseconds: delta-seconds or an HTTP date; null when
   absent or unreadable. Capped so a bad header cannot park a page. */
export function retryAfterMs(header: string | null, now: number = Date.now()): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (trimmed === "") return null;
  let ms: number;
  if (/^\d+$/.test(trimmed)) {
    ms = Number(trimmed) * 1000;
  } else {
    const at = Date.parse(trimmed);
    if (Number.isNaN(at)) return null;
    ms = at - now;
  }
  return Math.min(Math.max(ms, 0), MAX_RETRY_AFTER_MS);
}

/* Wait before retry number `attempt` (0-based): 1 s, 2 s, 4 s ... capped at
   15 s, jittered to [d/2, d] so many tabs do not retry in lockstep. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const d = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return d / 2 + random() * (d / 2);
}

export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(signal?.reason);
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/* Calls fetcher until it gets a non-transient answer or runs out of
   attempts. Returns the last Response (a caller still sees the 429/503 if
   the outage outlasts the budget) or rethrows the last network error.
   Aborts are never retried. */
export async function fetchWithRetry(
  fetcher: Fetcher,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: { attempts: number; sleep?: Sleep; random?: () => number },
): Promise<Response> {
  const { attempts, sleep: wait = sleep, random = Math.random } = options;
  let done: (() => void) | null = null;
  try {
    for (let attempt = 0; ; attempt++) {
      const last = attempt >= attempts - 1;
      let delay: number;
      try {
        const res = await fetcher(input, init);
        if (!TRANSIENT_STATUSES.has(res.status) || last) return res;
        delay = retryAfterMs(res.headers.get("Retry-After")) ?? backoffMs(attempt, random);
      } catch (error) {
        if (last || isAbort(error) || !(error instanceof TypeError)) throw error;
        delay = backoffMs(attempt, random);
      }
      done ??= beginReconnecting();
      await wait(delay, init?.signal);
    }
  } finally {
    done?.();
  }
}

function requestPath(input: RequestInfo | URL, origin: string): string | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  try {
    const url = new URL(raw, origin);
    return url.origin === origin ? url.pathname : null;
  } catch {
    return null;
  }
}

/* True for requests the wrapper may repeat: same-origin GET/HEAD to the
   backend's /api/ or /auth/ routes, except /auth/me (identity.ts owns it). */
export function isRetryableRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  origin: string,
): boolean {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  const path = requestPath(input, origin);
  if (path === null || path === "/auth/me") return false;
  return path.startsWith("/api/") || path.startsWith("/auth/");
}

export function installFetchRetry(target: { fetch: Fetcher; location: { origin: string } }): void {
  const inner = target.fetch.bind(target);
  target.fetch = (input, init) =>
    isRetryableRequest(input, init, target.location.origin)
      ? fetchWithRetry(inner, input, init, { attempts: DATA_GET_ATTEMPTS })
      : inner(input, init);
}
