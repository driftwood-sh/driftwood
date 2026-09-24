/* Imported with its extension so node --test can run this module directly
   (same convention as mock.ts). */
import { activeMockMode } from "./mock-mode.ts";
import { beginReconnecting } from "./connection-status.ts";
import {
  TRANSIENT_STATUSES,
  retryDelayMs,
  sleep as defaultSleep,
  type Sleep,
} from "./fetch-retry.ts";

/* One owner for the /auth/me flow shared by every dashboard page shell.

   The problem: navigation between dashboard pages is full page reloads, and
   every page serially blocked on /auth/me (~300-400ms) before its gated view
   mounted — so the cost was paid on every hop. loadIdentity() returns the
   last user /auth/me confirmed in this tab (`cached`, from sessionStorage)
   so the page can paint its real shell immediately, and ALWAYS revalidates
   against /auth/me in the background (`fresh`). Data endpoints are
   cookie-authed, so a stale cache can't leak anything — it only skips the
   spinner. When fresh disagrees with the cache the page swaps identity in
   place.

   fresh resolves one of three results (IdentityResult):
   - "user": /auth/me answered with the user.
   - "signed-out": a 401 or 403, the only answers that mean signed out. The
     cache is already cleared; the caller shows the sign-in card.
   - "unavailable": the backend could not say. A 429/502/503/504 or a
     network error (Cloud Run swapping the backend's single instance) is
     retried with backoff, honoring Retry-After, for up to
     IDENTITY_RETRY_BUDGET_MS while the tab shows "Reconnecting"
     (connection-status.ts). Any other status or an unreadable body is
     "unavailable" at once. The caller shows an error card with a Retry
     button (IdentityUnavailable.tsx) that calls checkIdentity() again —
     never the sign-in card. Before this, one 429 signed the user out.

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

export type IdentityResult<U> =
  | { state: "user"; user: U }
  | { state: "signed-out" }
  | { state: "unavailable" };

/* How long /auth/me may keep retrying transient failures before the page
   shows the error card instead. */
export const IDENTITY_RETRY_BUDGET_MS = 30_000;

export type Identity<U> = {
  /* The last user /auth/me confirmed in this tab, or null (no cache, cache
     unreadable, mock mode). Paint the real shell off it — but never trust
     it alone: `fresh` is already in flight. */
  cached: U | null;
  /* The live /auth/me result (see IdentityResult); never rejects. */
  fresh: Promise<IdentityResult<U>>;
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

type CheckOptions = {
  fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  storage?: StorageLike | null;
  mock?: boolean;
  sleep?: Sleep;
};

/* Options exist for node tests; every page calls loadIdentity() bare.
   The fetcher wraps global fetch at call time so mock.ts's window.fetch
   swap (installed by main.tsx before any page chunk loads) still applies. */
export function loadIdentity<U>(options: CheckOptions = {}): Identity<U> {
  const { storage = safeStorage(), mock = activeMockMode() !== null } = options;
  const cached = mock ? null : readCache<U>(storage);
  return { cached, fresh: checkIdentity<U>({ ...options, storage, mock }) };
}

/* One /auth/me check with the retry rules above. Retry buttons call it
   again. Never rejects. */
export async function checkIdentity<U>(options: CheckOptions = {}): Promise<IdentityResult<U>> {
  const {
    fetcher = (input, init) => fetch(input, init),
    storage = safeStorage(),
    mock = activeMockMode() !== null,
    sleep = defaultSleep,
  } = options;
  let waited = 0;
  let done: (() => void) | null = null;
  try {
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await fetcher("/auth/me", { credentials: "include" });
      } catch {
        // Network error: unreachable, not a no. Keep the cache and retry.
        res = new Response(null, { status: 503 });
      }
      if (isSignedOut(res.status)) {
        if (!mock) storage?.removeItem(IDENTITY_KEY);
        return { state: "signed-out" };
      }
      if (res.ok) {
        let user: U;
        try {
          user = (await res.json()) as U;
        } catch {
          return { state: "unavailable" };
        }
        if (!mock) {
          try {
            storage?.setItem(IDENTITY_KEY, JSON.stringify(user));
          } catch {
            // quota / private mode — same experience as having no cache
          }
        }
        return { state: "user", user };
      }
      if (!TRANSIENT_STATUSES.has(res.status)) return { state: "unavailable" };
      const delay = retryDelayMs(attempt, res.headers.get("Retry-After"));
      if (waited + delay > IDENTITY_RETRY_BUDGET_MS) return { state: "unavailable" };
      waited += delay;
      done ??= beginReconnecting();
      await sleep(delay);
    }
  } finally {
    done?.();
  }
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
