/* Imported with its extension so node --test can run this module directly
   (same convention as mock.ts). */
import { activeMockMode } from "./mock-mode.ts";
import { beginReconnecting } from "./connection-status.ts";
import { backoffMs, retryAfterMs, sleep as defaultSleep, type Sleep } from "./fetch-retry.ts";

/* One owner for the /auth/me flow shared by every dashboard page shell.

   The problem: navigation between dashboard pages is full page reloads, and
   every page serially blocked on /auth/me (~300-400ms) before its gated view
   mounted — so the cost was paid on every hop. loadIdentity() returns the
   last user /auth/me confirmed in this tab (`cached`, from sessionStorage)
   so the page can paint its real shell immediately, and ALWAYS revalidates
   against /auth/me in the background (`fresh`). Data endpoints are
   cookie-authed, so a stale cache can't leak anything — it only skips the
   spinner. When fresh disagrees with the cache the page swaps identity in
   place; when fresh is null (401 / 403) the cache is already cleared and
   the caller shows the sign-in card.

   Only 401 and 403 mean "signed out". Anything else (429 or 503 while Cloud
   Run swaps the backend's single instance, a network error, a 5xx) means
   "the backend is briefly unreachable": fresh keeps retrying with backoff,
   honoring Retry-After, and marks the tab as reconnecting
   (connection-status.ts) until it gets an answer. Before this, one 429
   showed a signed-in user the sign-in card.

   Mock mode bypasses the cache entirely — no reads, no writes — so demo and
   real identities can never cross-contaminate; mock's fetch wrapper answers
   /auth/me instantly anyway, so mock pages never needed the cache. */

const IDENTITY_KEY = "driftwood.dashboard.me";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/* sessionStorage access can throw (Safari private mode) — same guard as
   mock-mode.ts. */
function safeStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export type Identity<U> = {
  /* The last user /auth/me confirmed in this tab, or null (no cache, cache
     unreadable, mock mode). Paint the real shell off it — but never trust
     it alone: `fresh` is already in flight. */
  cached: U | null;
  /* The live /auth/me result. Resolves null on a 401 or 403 (the cache is
     cleared by then); retries through anything else; never rejects. */
  fresh: Promise<U | null>;
};

/* The cache stores whatever /auth/me last returned. Before handing it back,
   make sure it still looks like a user payload so a corrupt entry can't
   crash a page render; anything else is dropped on sight. */
function readCache<U>(storage: StorageLike | null): U | null {
  const raw = storage?.getItem(IDENTITY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      email?: unknown;
      is_approved?: unknown;
    } | null;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      typeof parsed.email === "string" &&
      typeof parsed.is_approved === "boolean"
    )
      return parsed as U;
  } catch {
    // not JSON — fall through to the removal below
  }
  storage?.removeItem(IDENTITY_KEY);
  return null;
}

/* Options exist for node tests; every page calls loadIdentity() bare.
   The fetcher wraps global fetch at call time so mock.ts's window.fetch
   swap (installed by main.tsx before any page chunk loads) still applies. */
export function loadIdentity<U>(
  options: {
    fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
    storage?: StorageLike | null;
    mock?: boolean;
    sleep?: Sleep;
  } = {},
): Identity<U> {
  const {
    fetcher = (input, init) => fetch(input, init),
    storage = safeStorage(),
    mock = activeMockMode() !== null,
    sleep = defaultSleep,
  } = options;
  const cached = mock ? null : readCache<U>(storage);
  const fresh = (async (): Promise<U | null> => {
    let done: (() => void) | null = null;
    try {
      for (let attempt = 0; ; attempt++) {
        let delay: number;
        try {
          const res = await fetcher("/auth/me", { credentials: "include" });
          if (isSignedOut(res.status)) {
            if (!mock) storage?.removeItem(IDENTITY_KEY);
            return null;
          }
          if (res.ok) {
            const user = (await res.json()) as U;
            if (!mock) {
              try {
                storage?.setItem(IDENTITY_KEY, JSON.stringify(user));
              } catch {
                // quota / private mode — same experience as having no cache
              }
            }
            return user;
          }
          delay = retryAfterMs(res.headers.get("Retry-After")) ?? backoffMs(attempt);
        } catch {
          // Network error or an unreadable body: the backend is unreachable,
          // not saying no. Keep the cache; the shell stays painted.
          delay = backoffMs(attempt);
        }
        done ??= beginReconnecting();
        await sleep(delay);
      }
    } finally {
      done?.();
    }
  })();
  return { cached, fresh };
}

/* The only answers that mean "show the sign-in card". */
export function isSignedOut(status: number): boolean {
  return status === 401 || status === 403;
}

/* Called from every handleLogout before its redirect (loadIdentity already
   clears on auth failure) so the next page load can't paint the logged-out
   user's shell. Removal can't cross-contaminate, so it's not mock-gated. */
export function clearIdentity(storage: StorageLike | null = safeStorage()): void {
  storage?.removeItem(IDENTITY_KEY);
}
