import SectionTabs from "./dashboard/SectionTabs";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Fuse from "fuse.js";
import { ToastProvider } from "./dashboard/DashboardCommon";
import { AdminPanelControls, ImpersonationBanner } from "./GodMode";
import {
  CARD,
  fetchInWaves,
  prefetch,
  relativeTime,
  useToast,
} from "./dashboard-shared";
import { checkIdentity, clearIdentity, loadIdentity, type IdentityResult } from "./identity";
import IdentityUnavailable from "./components/IdentityUnavailable";
import AppShell from "./dashboard/AppShell";
import { withMockMode } from "./mock-mode";

/* /dashboard/companies — the full-width, dedicated "All companies" table.
   Self-contained page: does its own /auth/me gate (an unapproved or logged-out
   user is bounced back to /dashboard, which owns login/pending), then renders
   the paginated target-account table. Same first-party session cookie as the
   rest of the app. */

type User = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  is_approved: boolean;
  linkedin_connected: boolean;
  is_admin?: boolean;
  impersonating?: boolean;
  /* org workspace membership; absent/null (solo accounts) reads as owner.
     Members are read-only — the per-row Remove affordance hides. */
  org?: { name: string; role: "owner" | "admin" | "member" } | null;
};

type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  linkedin_slug: string | null;
  icp_status: string;
  disqualify_reason: string | null;
  qa_headcount: number | null;
  employee_count: number | null;
  funding_stage: string | null;
  location: string | null;
  source: string | null;
  lead_count: number;
  contacted_lead_count: number;
  last_sent_at: string | null;
  last_verified_at: string | null;
  created_at: string;
  updated_at: string;
};
type CompaniesPage = {
  companies: CompanyRow[];
  total: number;
  limit: number;
  offset: number;
};

/* /auth/me starts at module eval (chunk load), in parallel with the first
   companies page below — cached identity paints the real shell immediately
   and the background result confirms it or bounces to /dashboard. */
const identityBoot =
  typeof window === "undefined" ? null : loadIdentity<User>();

export default function Companies() {
  /* Unapproved users never seed from cache — they belong on /dashboard's
     pending screen, and the fresh result below sends them there. */
  const [user, setUser] = useState<User | null>(
    identityBoot?.cached?.is_approved ? identityBoot.cached : null,
  );
  /* Meaningful only while user is null: "checking" paints the skeleton,
     "offline" the error card with Retry. Only a 401/403 bounces to
     /dashboard (which owns login); an unreachable backend is not a logout
     (ux-principles rule 7). */
  const [gate, setGate] = useState<"checking" | "offline">("checking");

  const apply = useCallback((result: IdentityResult<User>) => {
    if (result.state === "user" && result.user.is_approved) {
      setUser(result.user); // swap in place when it differs from the cache
    } else if (result.state === "unavailable") {
      setGate("offline");
    } else {
      // Signed out, or logged in but not approved — /dashboard owns both.
      clearIdentity();
      window.location.href = withMockMode("/dashboard");
    }
  }, []);

  const recheck = useCallback(async () => {
    setGate("checking");
    apply(await checkIdentity<User>());
  }, [apply]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fresh = await identityBoot?.fresh;
      if (cancelled || !fresh) return;
      apply(fresh);
    })();
    return () => {
      cancelled = true;
    };
  }, [apply]);

  return (
    <ToastProvider>
      <div className="relative flex min-h-[100dvh] flex-col overflow-x-clip">
        {user ? (
          <CompaniesView user={user} />
        ) : gate === "offline" ? (
          <IdentityUnavailable onRetry={() => void recheck()} />
        ) : (
          <LoadingView />
        )}
      </div>
    </ToastProvider>
  );
}

/* Pre-auth first paint with no cached identity: mirror the page we're about
   to show (title, card, table rows) instead of a lone spinner on a blank
   page — ux-principles rules 1 + 2. The AppShell chrome itself still waits
   on identity (it needs the user's name and role). */
function LoadingView() {
  return (
    <div className="mx-auto w-full max-w-7xl flex-1 px-4 pb-10 sm:px-8">
      <div className="mt-11 h-9 w-52 animate-pulse rounded-md bg-sand motion-reduce:animate-none" />
      <div className={`mt-5 ${CARD} p-5 sm:p-6`}>
        <TableSkeleton />
      </div>
    </div>
  );
}

function CompaniesView({ user }: { user: User }) {
  const displayName = user.name || user.email;
  // Solo accounts carry no org and stay full-control; workspace members are
  // read-only.
  const role = user.org?.role ?? "owner";
  const canWrite = role !== "member";

  async function handleLogout() {
    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      clearIdentity();
      window.location.href = withMockMode("/dashboard");
    }
  }

  return (
    <>
      {user.impersonating && <ImpersonationBanner email={user.email} />}
      <AppShell
        active="audiences"
        identity={{ name: displayName, workspace: user.org?.name, avatarUrl: user.avatar_url }}
        onLogout={handleLogout}
        adminControl={user.is_admin ? <AdminPanelControls /> : undefined}
        canWrite={canWrite}
      >
        <div className="mx-auto w-full max-w-7xl"><SectionTabs active="Companies" /><CompaniesTable canWrite={canWrite} /></div>
      </AppShell>
    </>
  );
}

/* ---------- the table (GET /api/v1/dashboard/companies) ---------- */

/* Same shape as the leads table: we load the current ICP segment against the
   100-cap endpoint and do search + pagination client-side — the first page
   paints the moment it lands (the Qualified segment's request is already in
   flight before React mounts, see initialCompaniesPage), then the rest
   fetches with FETCH_PARALLEL pages in flight behind a quiet loading line,
   with every stated count reading loaded-of-total until the segment is
   whole. The segmented All/Qualified/Unknown/Disqualified control maps to
   the endpoint's server-side `icp_status` param, so picking a segment
   refetches just that group — the server also pre-sorts qualified ->
   unknown -> disqualified so the accounts worth looking at come back first.
   The page opens on Qualified: the disqualified group is mostly the agent's
   negative cache (thousands of rows), so customers opt into it via the
   control. */
const COMPANIES_PAGE_SIZE = 25; // rows shown per page (display only)
const FETCH_CHUNK = 100; // server-side limit cap, used for the upfront load
const FETCH_GUARD = 1000; // hard ceiling on total pages fetched

/* The segmented ICP filter. "all" omits the server-side param. */
const ICP_FILTERS = ["all", "qualified", "unknown", "disqualified"] as const;
type IcpFilter = (typeof ICP_FILTERS)[number];

function fetchCompaniesPage(offset: number, icp: IcpFilter): Promise<Response> {
  const icpParam = icp === "all" ? "" : `&icp_status=${icp}`;
  return fetch(
    `/api/v1/dashboard/companies?limit=${FETCH_CHUNK}&offset=${offset}${icpParam}`,
    { credentials: "include" },
  );
}

/* The default segment's first page fires at module eval, in parallel with
   /auth/me (see prefetch() in dashboard-shared); the table's initial load
   consumes it exactly once. Segment switches always fetch fresh. */
const initialCompaniesPage = prefetch(() => fetchCompaniesPage(0, "qualified"));

/* Fuse keys, weighted so a name/domain hit outranks a location/source hit. */
const SEARCH_KEYS = [
  { name: "name", weight: 3 },
  { name: "domain", weight: 2 },
  { name: "location", weight: 1 },
  { name: "source", weight: 1 },
];

type CompaniesState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      companies: CompanyRow[];
      /* the segment's census from the first page — the denominator for the
         loaded-of-total labels while the rest streams in */
      total: number;
      /* later pages still in flight (drives the quiet loading line) */
      loadingMore: boolean;
      /* every page landed; stays false if a later page failed, so the
         counts keep saying "of N" instead of quietly lying */
      complete: boolean;
    };

/* Stable empty fallback so the search memos keep a steady reference pre-load. */
const NO_COMPANIES: CompanyRow[] = [];

/* Status chip variants: qualified pops green, disqualified reads muted-red,
   unknown stays neutral (same base pill as the leads table's stage pill). */
const CHIP_BASE =
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px]";
const ICP_CHIP: Record<string, string> = {
  qualified: `${CHIP_BASE} border-ok/25 bg-ok/10 text-ok`,
  disqualified: `${CHIP_BASE} border-red-600/25 bg-red-500/5 text-red-700/80`,
  unknown: `${CHIP_BASE} border-line bg-sand/60 text-ink-soft`,
};
/* Sticky header: opaque bg so scrolling rows don't bleed through, bottom border
   travels with the cell since border-collapse drops the row border when stuck. */
const TH =
  "sticky top-0 z-10 border-b border-line bg-surface whitespace-nowrap px-3 py-2.5 text-left text-[12.5px] font-medium text-ink-faint";
const TD = "whitespace-nowrap px-3 py-2.5 align-middle text-ink-soft";

function Dash() {
  return <span className="text-ink-faint">—</span>;
}

/* Quiet line above the controls while later pages stream in — the first
   page is already interactive; this only explains the growing list and the
   partial counts. Local copy of the review queue's LoadingMoreLine idiom
   (Review.tsx), margins adjusted for the card. */
function LoadingMoreLine({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="m-0 mb-4 flex items-center gap-2 font-mono text-[11px] tracking-[0.06em] text-ink-faint"
    >
      <span
        aria-hidden="true"
        className="size-3 shrink-0 animate-spin rounded-full border-2 border-line border-t-tide"
      />
      {children}
    </p>
  );
}

function companyLabel(company: CompanyRow): string {
  return company.name || "this company";
}

/* Initial-load placeholder that mirrors the table it becomes (ux-principles
   rule 2): the search row, a header line, then a page of row-height bars in
   line/sand tones — first column two-deck like name + domain, second a chip.
   Slow pulse, static under prefers-reduced-motion. Local Tailwind-only copy
   per the LoadingMoreLine precedent — the shared skeleton utility is a later
   batch. */
function TableSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading companies"
      className="animate-pulse motion-reduce:animate-none"
    >
      <div className="mb-4">
        <div className="h-[42px] rounded-xl bg-sand" />
      </div>
      <div className="border-b border-line pb-3 pt-1">
        <div className="h-3 w-2/3 max-w-[30rem] rounded bg-line" />
      </div>
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b border-line/70 py-2.5"
        >
          <div className="w-[13%] min-w-[5.5rem]">
            <div className="h-3.5 rounded bg-line" />
            <div className="mt-1.5 h-3 w-3/4 rounded bg-sand" />
          </div>
          <div className="h-[22px] w-[5.5rem] shrink-0 rounded-full bg-sand" />
          <div className="h-3.5 w-[8%] min-w-[3rem] rounded bg-sand" />
          <div className="h-3.5 w-[10%] min-w-[4rem] rounded bg-sand" />
          <div className="h-3.5 flex-1 rounded bg-sand" />
          <div className="h-[30px] w-[4.75rem] shrink-0 rounded-full bg-sand" />
        </div>
      ))}
    </div>
  );
}

function CompaniesTable({ canWrite }: { canWrite: boolean }) {
  const [state, setState] = useState<CompaniesState>({ status: "loading" });
  // Qualified by default — the actionable segment; "all" pulls in the
  // disqualified graveyard, which customers opt into via the control.
  const [filter, setFilter] = useState<IcpFilter>("qualified");
  const [removingId, setRemovingId] = useState<string | null>(null);
  /* Which row's Remove is armed — one at a time, so arming a second row
     disarms the first (the review queue's mutual-exclusivity idiom). */
  const [armedId, setArmedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const toast = useToast();

  /* Monotonic id per loadAll run: a segment switch mid-load starts a new
     run, and the superseded run's late pages must never merge into (or
     error out) the new segment's list. */
  const runRef = useRef(0);

  // Pull the selected segment: paint after the first page (the Qualified
  // segment's is usually already in flight via the module-eval prefetch),
  // then parallel-fetch the remaining offsets and append them in one
  // functional setState. Re-runs whenever the segment changes (state
  // resets to loading).
  const loadAll = useCallback(async (icp: IcpFilter) => {
    const run = ++runRef.current;
    setState({ status: "loading" });
    try {
      const res = await ((icp === "qualified"
        ? initialCompaniesPage.take()
        : null) ?? fetchCompaniesPage(0, icp));
      if (!res.ok) throw new Error("request failed");
      const first = (await res.json()) as CompaniesPage;
      if (runRef.current !== run) return;
      const total = first.total;
      const pageCount =
        first.companies.length === 0
          ? 1
          : Math.min(Math.ceil(total / FETCH_CHUNK), FETCH_GUARD);
      const done = pageCount <= 1 || first.companies.length >= total;
      // Paint now — the rest of the segment streams in behind this.
      setState({
        status: "ready",
        companies: first.companies,
        total,
        loadingMore: !done,
        complete: done,
      });
      if (done) return;

      const offsets: number[] = [];
      for (let p = 1; p < pageCount; p++) offsets.push(p * FETCH_CHUNK);
      const pages = await fetchInWaves(offsets, async (offset) => {
        const r = await fetchCompaniesPage(offset, icp);
        if (!r.ok) throw new Error("request failed");
        return (await r.json()) as CompaniesPage;
      });
      if (runRef.current !== run) return;
      const complete = pages.every((page) => page !== null);
      // Merge in offset order so the server's qualified-first sort holds.
      const rest: CompanyRow[] = [];
      for (const page of pages) if (page) rest.push(...page.companies);
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        // Dedupe by id: rows removed mid-load shift server offsets, so
        // pages can overlap each other and the already-painted first page.
        const seen = new Set(prev.companies.map((c) => c.id));
        const fresh = rest.filter((c) => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        });
        return {
          ...prev,
          companies: [...prev.companies, ...fresh],
          loadingMore: false,
          complete,
        };
      });
    } catch {
      // Only a failed FIRST page shows the error state — a failed later
      // page keeps the painted rows and reads back as an incomplete load.
      if (runRef.current !== run) return;
      setState((prev) =>
        prev.status === "ready" ? prev : { status: "error" },
      );
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadAll(filter);
    })();
  }, [loadAll, filter]);

  /* An armed Remove disarms itself after a beat — no stale confirm lying in
     wait (same self-disarm as the review queue's bulk buttons). */
  useEffect(() => {
    if (!armedId) return;
    const t = window.setTimeout(() => setArmedId(null), 5000);
    return () => window.clearTimeout(t);
  }, [armedId]);

  /* First press arms this row's button ("Delete company and its leads?
     Confirm"), the second executes — a delete-plus-blacklist cascade never
     rides on one click (ux-principles rule 9; this replaced a blocking
     window.confirm). */
  function handleRemove(company: CompanyRow) {
    if (armedId !== company.id) {
      setArmedId(company.id);
      return;
    }
    setArmedId(null);
    void executeRemove(company);
  }

  async function executeRemove(company: CompanyRow) {
    const label = companyLabel(company);
    setRemovingId(company.id);
    try {
      const res = await fetch(`/api/v1/dashboard/companies/${company.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("request failed");
      toast(
        `Removed ${label} and added its contacts to your blacklist.`,
        "success",
      );
      // Drop it from the in-memory list — no refetch. Pagination clamps below.
      setState((prev) =>
        prev.status === "ready"
          ? {
              ...prev,
              companies: prev.companies.filter((c) => c.id !== company.id),
            }
          : prev,
      );
    } catch {
      toast(`Couldn't remove ${label}. Please try again.`, "error");
    } finally {
      setRemovingId(null);
    }
  }

  const allCompanies = useMemo(
    () => (state.status === "ready" ? state.companies : NO_COMPANIES),
    [state],
  );
  const allCount = allCompanies.length;
  /* Partial-load affordances: while later pages stream in, every stated
     count reads loaded-of-total (or "so far") — a bare number would lie
     about the segment's size. The search index runs over the partial set
     (its memo re-keys as chunks land); the loading line explains the
     incompleteness. */
  const serverTotal = state.status === "ready" ? state.total : 0;
  const complete = state.status === "ready" && state.complete;
  const loadingMore = state.status === "ready" && state.loadingMore;

  // useDeferredValue keeps typing snappy: the input updates immediately while
  // the (cheap, but non-blocking) Fuse pass runs against the deferred value.
  const deferredQuery = useDeferredValue(query);
  const trimmed = deferredQuery.trim();

  const fuse = useMemo(
    () =>
      new Fuse(allCompanies, {
        // 0.4 tolerates real typos ("Pizzza", "Joes Piza") and partial terms
        // without the false positives that creep in around 0.5+. ignoreLocation
        // so a match anywhere in the field counts (these aren't line-anchored).
        keys: SEARCH_KEYS,
        threshold: 0.4,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    [allCompanies],
  );

  const filtered = useMemo(() => {
    if (!trimmed) return allCompanies;
    return fuse.search(trimmed).map((r) => r.item);
  }, [fuse, trimmed, allCompanies]);

  // A new search resets to the first page — handled in the input's onChange
  // (below) rather than an effect, so we don't trigger a cascading render.
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / COMPANIES_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const startIdx = safePage * COMPANIES_PAGE_SIZE;
  const visible = filtered.slice(startIdx, startIdx + COMPANIES_PAGE_SIZE);
  const start = total === 0 ? 0 : startIdx + 1;
  const end = Math.min(startIdx + COMPANIES_PAGE_SIZE, total);

  return (
    <>
      <div className="mt-5 flex items-end justify-between gap-3">
        <h1 className="m-0 text-[clamp(1.7rem,3.6vw,2.25rem)] font-semibold leading-[1.08] tracking-[-0.015em]">
          All companies
        </h1>
        {state.status === "ready" && allCount > 0 && (
          <span className="shrink-0 text-[12.5px] text-ink-faint tabular-nums">
            {complete
              ? `${allCount.toLocaleString()} ${filter === "all" ? "total" : filter}`
              : `${allCount.toLocaleString()} of ${serverTotal.toLocaleString()} ${
                  filter === "all" ? "loaded" : filter
                }`}
          </span>
        )}
      </div>

      <div className={`mt-5 ${CARD} p-5 sm:p-6`}>
        {/* Segmented ICP filter — always visible so an empty segment can still
            be switched away from. Each pick refetches from the server. */}
        <div
          className="mb-4 flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filter by ICP status"
        >
          {ICP_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={f === filter}
              onClick={() => {
                setFilter(f);
                setPage(0); // jump back to page 1 of the new segment
              }}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-[12.5px] font-medium capitalize transition-colors ${
                f === filter
                  ? "border-tide/40 bg-tide-wash/60 text-ink"
                  : "border-line bg-surface text-ink-soft hover:border-ink-faint/50 hover:text-ink"
              }`}
            >
              {f}
            </button>
          ))}
        </div>

        {state.status === "loading" && <TableSkeleton />}

        {state.status === "error" && (
          <p className="m-0 text-[14px] font-medium text-red-700" role="alert">
            Couldn&rsquo;t load your companies. Please refresh.
          </p>
        )}

        {state.status === "ready" &&
          (allCount === 0 ? (
            /* Empty is a designed state (rule 14): say where companies come
               from and offer the next move — another segment when one is
               empty, a lead import when the whole account is. */
            <p className="m-0 text-[13px] leading-relaxed text-ink-soft">
              {filter !== "all" ? (
                <>
                  No {filter} companies yet. Pick another segment above to
                  see the rest of your accounts.
                </>
              ) : canWrite ? (
                <>
                  No companies yet. Companies appear here as leads are
                  imported and researched. Import a CSV from the{" "}
                  <a
                    href={withMockMode("/dashboard")}
                    className="font-medium text-tide no-underline hover:underline"
                  >
                    dashboard
                  </a>{" "}
                  to add your first ones.
                </>
              ) : (
                <>
                  No companies yet. Companies appear here once your workspace
                  imports leads.
                </>
              )}
            </p>
          ) : (
            <>
              {loadingMore && (
                <LoadingMoreLine>
                  Loading the rest of your companies
                </LoadingMoreLine>
              )}
              <div className="mb-4 flex items-center gap-3">
                <div className="relative flex-1">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="none"
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-faint"
                  >
                    <circle
                      cx="9"
                      cy="9"
                      r="6"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <path
                      d="m17 17-3.2-3.2"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setPage(0); // jump back to page 1 of the new results
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setQuery("");
                        setPage(0);
                      }
                    }}
                    placeholder="Search by name, domain, location…"
                    aria-label="Search companies"
                    className="w-full rounded-xl border border-line bg-paper py-2.5 pl-10 pr-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-tide"
                  />
                </div>
                {trimmed && (
                  <span className="shrink-0 text-[12.5px] text-ink-faint tabular-nums">
                    {total.toLocaleString()} {total === 1 ? "match" : "matches"}
                    {complete ? "" : " so far"}
                  </span>
                )}
              </div>

              {total === 0 ? (
                /* Only reachable with search text (the segment filter is
                   server-side), but still name the active segment so the
                   copy says what's actually filtering. */
                <p className="m-0 py-6 text-[13px] leading-relaxed text-ink-soft">
                  {filter !== "all" ? (
                    <>
                      No {filter} companies match &ldquo;{trimmed}&rdquo;.
                    </>
                  ) : (
                    <>No companies match &ldquo;{trimmed}&rdquo;.</>
                  )}
                </p>
              ) : (
                <>
                  <div className="max-h-[70vh] overflow-auto rounded-lg">
                    <table className="w-full border-collapse text-[13px]">
                      <thead>
                        <tr>
                          <th className={TH}>Name</th>
                          <th className={TH}>ICP status</th>
                          <th className={TH}>Employees</th>
                          <th className={TH}>Funding stage</th>
                          <th className={TH}>QA headcount</th>
                          <th className={TH}>Contacted</th>
                          <th className={TH}>Last sent</th>
                          <th className={TH}>Leads</th>
                          <th className={TH}>Last verified</th>
                          <th className={`${TH} text-right`}>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((company) => {
                          const verified = relativeTime(
                            company.last_verified_at,
                          );
                          const removing = removingId === company.id;
                          const armed = armedId === company.id;
                          return (
                            <tr
                              key={company.id}
                              className="border-b border-line/70"
                            >
                              <td className={TD}>
                                <span className="block font-medium text-ink">
                                  {company.name}
                                </span>
                                {company.domain && (
                                  <span className="block text-[11.5px] text-ink-faint">
                                    {company.domain}
                                  </span>
                                )}
                              </td>
                              <td className={TD}>
                                <span
                                  className={
                                    ICP_CHIP[company.icp_status] ??
                                    ICP_CHIP.unknown
                                  }
                                >
                                  {company.icp_status}
                                </span>
                                {/* The why, as visible text — a title-only
                                    tooltip is invisible on touch and unread
                                    by screen readers (rule 15). The title
                                    keeps the untruncated version on hover. */}
                                {company.disqualify_reason && (
                                  <span
                                    className="mt-1 block max-w-[16rem] truncate text-[11.5px] text-ink-faint"
                                    title={company.disqualify_reason}
                                  >
                                    {company.disqualify_reason}
                                  </span>
                                )}
                              </td>
                              <td className={`${TD} tabular-nums`}>
                                {company.employee_count !== null ? (
                                  company.employee_count.toLocaleString()
                                ) : (
                                  <Dash />
                                )}
                              </td>
                              <td className={TD}>
                                {company.funding_stage || <Dash />}
                              </td>
                              <td className={`${TD} tabular-nums`}>
                                {company.qa_headcount !== null ? (
                                  company.qa_headcount.toLocaleString()
                                ) : (
                                  <Dash />
                                )}
                              </td>
                              <td className={`${TD} tabular-nums`}>
                                {company.contacted_lead_count > 0 ? (
                                  `${company.contacted_lead_count.toLocaleString()}/${company.lead_count.toLocaleString()}`
                                ) : (
                                  <Dash />
                                )}
                              </td>
                              <td className={TD}>
                                {company.last_sent_at ? (
                                  relativeTime(company.last_sent_at)
                                ) : (
                                  <Dash />
                                )}
                              </td>
                              <td className={`${TD} tabular-nums`}>
                                {company.lead_count.toLocaleString()}
                              </td>
                              <td className={`${TD} tabular-nums`}>
                                {verified || <Dash />}
                              </td>
                              <td className={`${TD} text-right`}>
                                {canWrite && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemove(company)}
                                    disabled={removing}
                                    title={
                                      armed || removing
                                        ? undefined
                                        : `Deletes ${companyLabel(company)} and its leads, and blacklists their contacts`
                                    }
                                    className={`inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                                      armed
                                        ? "border-red-700 bg-red-700 font-semibold text-white hover:border-red-800 hover:bg-red-800"
                                        : "border-line bg-surface font-medium text-ink-soft hover:border-red-600/40 hover:text-red-700"
                                    }`}
                                  >
                                    {removing && (
                                      <span
                                        aria-hidden="true"
                                        className="size-3.5 animate-spin rounded-full border-[1.5px] border-red-600/30 border-t-red-600"
                                      />
                                    )}
                                    {removing
                                      ? "Removing…"
                                      : armed
                                        ? "Delete company and its leads? Confirm"
                                        : "Remove"}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-[12.5px] text-ink-faint tabular-nums">
                      Showing {start.toLocaleString()}–{end.toLocaleString()} of{" "}
                      {total.toLocaleString()}
                      {trimmed ? " matching" : ""}
                      {complete ? "" : trimmed ? " so far" : " loaded so far"}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPage(Math.max(0, safePage - 1))}
                        disabled={safePage === 0}
                        className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-ink-faint/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Prev
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setPage(Math.min(pageCount - 1, safePage + 1))
                        }
                        disabled={safePage >= pageCount - 1}
                        className="cursor-pointer rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-ink-soft transition-colors hover:border-ink-faint/50 hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              )}
            </>
          ))}
      </div>
    </>
  );
}
