import SectionTabs from "./dashboard/SectionTabs";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
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
import { stageLabel } from "./audiences/model";

/* /dashboard/leads — the full-width, dedicated "All leads" table. Self-contained
   page: does its own /auth/me gate (an unapproved or logged-out user is bounced
   back to /dashboard, which owns login/pending), then renders the paginated
   table that used to live inline on the dashboard. Same first-party session
   cookie as the rest of the app. */

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

type LeadRow = {
  id: string;
  name: string | null;
  company: string | null;
  title: string | null;
  email: string | null;
  linkedin_url: string | null;
  stage: string;
  origin: string;
  source: string | null;
  audiences: string[];
  demo_idea: string | null;
  demo_artifact_id: string | null;
  /* What the lead did with the demo we emailed them. Optional throughout:
     an older backend omits them and the Demo cell shows the pill alone. */
  opened_at?: string | null;
  clicked_at?: string | null;
  watched_pct?: number | null; // 0 to 100
  created_at: string;
  updated_at: string;
};
type LeadsPage = {
  leads: LeadRow[];
  total: number;
  limit: number;
  offset: number;
};

/* /auth/me starts at module eval (chunk load), in parallel with the first
   leads page below — cached identity paints the real shell immediately and
   the background result confirms it or bounces to /dashboard. */
const identityBoot =
  typeof window === "undefined" ? null : loadIdentity<User>();

export default function Leads() {
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
          <LeadsView user={user} />
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
      <div className="mt-11 h-9 w-44 animate-pulse rounded-md bg-sand motion-reduce:animate-none" />
      <div className={`mt-5 ${CARD} p-5 sm:p-6`}>
        <TableSkeleton />
      </div>
    </div>
  );
}

function LeadsView({ user }: { user: User }) {
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
        <div className="mx-auto w-full max-w-7xl"><SectionTabs active="All contacts" /><LeadsTable canWrite={canWrite} /></div>
      </AppShell>
    </>
  );
}

/* ---------- the table (GET /api/v1/dashboard/leads) ---------- */

/* We load every lead against the 100-cap endpoint and do search + pagination
   client-side: the first page paints the moment it lands (its request is
   already in flight before React mounts — see initialLeadsPage), then the
   rest of the list fetches with FETCH_PARALLEL pages in flight and streams
   in behind a quiet loading line. Lead lists run from hundreds to several
   thousand rows, so until the list is whole every stated count reads
   loaded-of-total. Once loaded, every page flip / keystroke is instant —
   no per-page network round-trips. */
const LEADS_PAGE_SIZE = 25; // rows shown per page (display only)
const FETCH_CHUNK = 100; // server-side limit cap, used for the upfront load
const FETCH_GUARD = 1000; // hard ceiling on total pages fetched

function fetchLeadsPage(offset: number): Promise<Response> {
  return fetch(
    `/api/v1/dashboard/leads?limit=${FETCH_CHUNK}&offset=${offset}`,
    { credentials: "include" },
  );
}

/* The first page fires at module eval, in parallel with /auth/me (see
   prefetch() in dashboard-shared); the table's initial load consumes it
   exactly once and parallel-fetches the rest. */
const initialLeadsPage = prefetch(() => fetchLeadsPage(0));

/* Fuse keys, weighted so a name/company hit outranks a title/source hit. */
const SEARCH_KEYS = [
  { name: "name", weight: 3 },
  { name: "company", weight: 2 },
  { name: "email", weight: 2 },
  { name: "title", weight: 1 },
  // Search matches the label the customer sees ("Lead search"), never the
  // raw vendor slug the API stores (sourceLabel below, ux-principles rule 18).
  { name: "source", weight: 1, getFn: (lead: LeadRow) => (lead.source ? sourceLabel(lead.source) : "") },
  { name: "audiences", weight: 2 },
];

type LeadsState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      leads: LeadRow[];
      /* the server's census from the first page — the denominator for the
         loaded-of-total labels while the rest streams in */
      total: number;
      /* later pages still in flight (drives the quiet loading line) */
      loadingMore: boolean;
      /* every page landed; stays false if a later page failed, so the
         counts keep saying "of N" instead of quietly lying */
      complete: boolean;
    };

/* audiences may arrive null from an older backend */
function withAudiences(lead: LeadRow): LeadRow {
  return { ...lead, audiences: lead.audiences ?? [] };
}

/* Stable empty fallback so the search memos keep a steady reference pre-load. */
const NO_LEADS: LeadRow[] = [];

const STAGE_PILL =
  "inline-flex items-center rounded-full border border-line bg-sand/60 px-2 py-0.5 text-[11px] text-ink-soft";
/* Sticky header: opaque bg so scrolling rows don't bleed through, bottom border
   travels with the cell since border-collapse drops the row border when stuck. */
const TH =
  "sticky top-0 z-10 border-b border-line bg-surface whitespace-nowrap px-3 py-2.5 text-left text-[12.5px] font-medium text-ink-faint";
const TD = "whitespace-nowrap px-3 py-2.5 align-middle text-ink-soft";

function leadLabel(lead: LeadRow): string {
  return lead.name || lead.email || "this lead";
}

function Dash() {
  return <span className="text-ink-faint">—</span>;
}

/* The furthest the lead got with the demo, as one pill. A watch outranks a
   click and a click outranks an open, so the row shows the best signal we
   have instead of a stack of three. Null means we have nothing to show. */
function demoEngagementLabel(lead: LeadRow): string | null {
  const watched = lead.watched_pct ?? 0;
  if (watched > 0) return `Watched ${Math.round(watched)}%`;
  if (lead.clicked_at) return "Clicked";
  if (lead.opened_at) return "Opened";
  return null;
}

/* Customer-facing source labels speak in capabilities, never vendor names
   (ux-principles rule 18) — the audiences library does the same for its
   provider enums (audiences/model.ts providerLabel), but lead sources arrive
   as raw slugs ("orangeslice-ocean", "orange-slice:ocean", "upload:yc",
   "workspace"), so they get their own mapper here. The backend writes the
   separator-less "orangeslice-*" form, so the search check matches all three
   spellings. The upload filename is deliberately dropped: the
   Audiences column already names the list, and this table has no room for
   "CSV upload · a16z-speedrun". Unknown slugs render sentence-cased with
   vendor tokens stripped — the raw colon form never reaches the customer. */
function sourceLabel(source: string): string {
  const slug = source.trim().toLowerCase();
  if (!slug) return "";
  if (/^orange[-_]?slice/.test(slug)) return "Lead search";
  if (slug.startsWith("upload")) return "CSV upload"; // upload:<name>, uploaded:csv
  if (slug.includes("rb2b")) return "Website visitor";
  if (slug === "workspace") return "Workspace";
  const cleaned = slug
    .replace(/orange[-_]?slice|unipile|composio|inboxkit|smartlead|sixtyfour|kernel|exa\b/g, " ")
    .replace(/[:_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "Imported";
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
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

/* Initial-load placeholder that mirrors the table it becomes (ux-principles
   rule 2): the search/filter controls row, a header line, then a page of
   row-height bars in line/sand tones. Slow pulse, static under
   prefers-reduced-motion. Local Tailwind-only copy per the LoadingMoreLine
   precedent — the shared skeleton utility is a later batch. */
function TableSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading leads"
      className="animate-pulse motion-reduce:animate-none"
    >
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem]">
        <div className="h-[42px] rounded-xl bg-sand" />
        <div className="hidden h-[42px] rounded-xl bg-sand sm:block" />
      </div>
      <div className="border-b border-line pb-3 pt-1">
        <div className="h-3 w-2/3 max-w-[30rem] rounded bg-line" />
      </div>
      {Array.from({ length: 12 }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-6 border-b border-line/70 py-3"
        >
          <div className="h-3.5 w-[11%] min-w-[4.5rem] rounded bg-line" />
          <div className="h-3.5 w-[9%] min-w-[3.5rem] rounded bg-sand" />
          <div className="h-[22px] w-[7rem] shrink-0 rounded-full bg-sand" />
          <div className="h-3.5 w-[13%] min-w-[4.5rem] rounded bg-sand" />
          <div className="h-3.5 flex-1 rounded bg-sand" />
          <div className="h-[30px] w-[4.75rem] shrink-0 rounded-full bg-sand" />
        </div>
      ))}
    </div>
  );
}

function LeadsTable({ canWrite }: { canWrite: boolean }) {
  const [state, setState] = useState<LeadsState>({ status: "loading" });
  const [removingId, setRemovingId] = useState<string | null>(null);
  /* Which row's Remove is armed — one at a time, so arming a second row
     disarms the first (the review queue's mutual-exclusivity idiom). */
  const [armedId, setArmedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [audienceFilter, setAudienceFilter] = useState("all");
  const [page, setPage] = useState(0);
  const toast = useToast();

  // Paint after the first page (usually already in flight via the
  // module-eval prefetch), then parallel-fetch the remaining offsets and
  // append them in one functional setState. Runs on mount only; state
  // already starts as "loading".
  const loadAll = useCallback(async () => {
    try {
      const res = await (initialLeadsPage.take() ?? fetchLeadsPage(0));
      if (!res.ok) throw new Error("request failed");
      const first = (await res.json()) as LeadsPage;
      const firstLeads = first.leads.map(withAudiences);
      const total = first.total;
      const pageCount =
        firstLeads.length === 0
          ? 1
          : Math.min(Math.ceil(total / FETCH_CHUNK), FETCH_GUARD);
      const done = pageCount <= 1 || firstLeads.length >= total;
      // Paint now — the rest of the list streams in behind this.
      setState({
        status: "ready",
        leads: firstLeads,
        total,
        loadingMore: !done,
        complete: done,
      });
      if (done) return;

      const offsets: number[] = [];
      for (let p = 1; p < pageCount; p++) offsets.push(p * FETCH_CHUNK);
      const pages = await fetchInWaves(offsets, async (offset) => {
        const r = await fetchLeadsPage(offset);
        if (!r.ok) throw new Error("request failed");
        return (await r.json()) as LeadsPage;
      });
      const complete = pages.every((page) => page !== null);
      // Merge in offset order so the server's sort holds.
      const rest: LeadRow[] = [];
      for (const page of pages)
        if (page) rest.push(...page.leads.map(withAudiences));
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        // Dedupe by id: rows removed mid-load shift server offsets, so
        // pages can overlap each other and the already-painted first page.
        const seen = new Set(prev.leads.map((lead) => lead.id));
        const fresh = rest.filter((lead) => {
          if (seen.has(lead.id)) return false;
          seen.add(lead.id);
          return true;
        });
        return {
          ...prev,
          leads: [...prev.leads, ...fresh],
          loadingMore: false,
          complete,
        };
      });
    } catch {
      // Only a failed FIRST page shows the error state — a failed later
      // page keeps the painted rows and reads back as an incomplete load.
      setState((prev) =>
        prev.status === "ready" ? prev : { status: "error" },
      );
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await loadAll();
    })();
  }, [loadAll]);

  /* An armed Remove disarms itself after a beat — no stale confirm lying in
     wait (same self-disarm as the review queue's bulk buttons). */
  useEffect(() => {
    if (!armedId) return;
    const t = window.setTimeout(() => setArmedId(null), 5000);
    return () => window.clearTimeout(t);
  }, [armedId]);

  /* First press arms this row's button ("Remove and blacklist? Confirm"),
     the second executes — a delete-plus-blacklist cascade never rides on one
     click (ux-principles rule 9; this replaced a blocking window.confirm). */
  function handleRemove(lead: LeadRow) {
    if (armedId !== lead.id) {
      setArmedId(lead.id);
      return;
    }
    setArmedId(null);
    void executeRemove(lead);
  }

  async function executeRemove(lead: LeadRow) {
    const label = leadLabel(lead);
    setRemovingId(lead.id);
    try {
      const res = await fetch(`/api/v1/dashboard/leads/${lead.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("request failed");
      toast(`Removed ${label} and added to your blacklist.`, "success");
      // Drop it from the in-memory list — no refetch. Pagination clamps below.
      setState((prev) =>
        prev.status === "ready"
          ? {
              ...prev,
              leads: prev.leads.filter((l) => l.id !== lead.id),
            }
          : prev,
      );
    } catch {
      toast(`Couldn't remove ${label}. Please try again.`, "error");
    } finally {
      setRemovingId(null);
    }
  }

  const allLeads = useMemo(
    () => (state.status === "ready" ? state.leads : NO_LEADS),
    [state],
  );
  const allCount = allLeads.length;
  /* Partial-load affordances: while later pages stream in, every stated
     count reads loaded-of-total (or "so far") — a bare number would lie
     about the list's size. The search index and filters run over the
     partial set (their memos re-key as chunks land); the loading line
     explains the incompleteness. */
  const serverTotal = state.status === "ready" ? state.total : 0;
  const complete = state.status === "ready" && state.complete;
  const loadingMore = state.status === "ready" && state.loadingMore;
  const audienceOptions = useMemo(
    () =>
      [...new Set(allLeads.flatMap((lead) => lead.audiences))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [allLeads],
  );

  // useDeferredValue keeps typing snappy: the input updates immediately while
  // the (cheap, but non-blocking) Fuse pass runs against the deferred value.
  const deferredQuery = useDeferredValue(query);
  const trimmed = deferredQuery.trim();

  const fuse = useMemo(
    () =>
      new Fuse(allLeads, {
        // 0.4 tolerates real typos ("Pizzza", "Joes Piza") and partial terms
        // without the false positives that creep in around 0.5+. ignoreLocation
        // so a match anywhere in the field counts (these aren't line-anchored).
        keys: SEARCH_KEYS,
        threshold: 0.4,
        ignoreLocation: true,
        minMatchCharLength: 2,
      }),
    [allLeads],
  );

  const filtered = useMemo(() => {
    const searched = trimmed ? fuse.search(trimmed).map((r) => r.item) : allLeads;
    if (audienceFilter === "all") return searched;
    return searched.filter((lead) => lead.audiences.includes(audienceFilter));
  }, [fuse, trimmed, allLeads, audienceFilter]);

  // A new search resets to the first page — handled in the input's onChange
  // (below) rather than an effect, so we don't trigger a cascading render.
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / LEADS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const startIdx = safePage * LEADS_PAGE_SIZE;
  const visible = filtered.slice(startIdx, startIdx + LEADS_PAGE_SIZE);
  const start = total === 0 ? 0 : startIdx + 1;
  const end = Math.min(startIdx + LEADS_PAGE_SIZE, total);

  return (
    <>
      <div className="mt-5 flex items-end justify-between gap-3">
        <h1 className="m-0 text-[clamp(1.7rem,3.6vw,2.25rem)] font-semibold leading-[1.08] tracking-[-0.015em]">
          All leads
        </h1>
        {allCount > 0 && (
          <span className="shrink-0 text-[12.5px] text-ink-faint tabular-nums">
            {complete
              ? `${allCount.toLocaleString()} total`
              : `${allCount.toLocaleString()} of ${serverTotal.toLocaleString()} leads`}
          </span>
        )}
      </div>

      <div className={`mt-5 ${CARD} p-5 sm:p-6`}>
        {state.status === "loading" && <TableSkeleton />}

        {state.status === "error" && (
          <p className="m-0 text-[14px] font-medium text-red-700" role="alert">
            Couldn&rsquo;t load your leads. Please refresh.
          </p>
        )}

        {state.status === "ready" &&
          (allCount === 0 ? (
            /* Empty is a designed state (rule 14): say what lands here and
               offer the next action — CSV import lives on the dashboard, and
               read-only members can't import at all. */
            <p className="m-0 text-[13px] leading-relaxed text-ink-soft">
              No leads yet. Every lead your agent works shows up here.{" "}
              {canWrite ? (
                <>
                  Import a CSV from the{" "}
                  <a
                    href={withMockMode("/dashboard")}
                    className="font-medium text-tide no-underline hover:underline"
                  >
                    dashboard
                  </a>{" "}
                  to add your first ones.
                </>
              ) : (
                <>An owner or admin can import the first ones.</>
              )}
            </p>
          ) : (
            <>
              {loadingMore && (
                <LoadingMoreLine>Loading the rest of your leads</LoadingMoreLine>
              )}
              <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_13rem_auto] sm:items-center">
                <div className="relative min-w-0">
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
                    placeholder="Search name, company, audience, email…"
                    aria-label="Search leads"
                    className="w-full rounded-xl border border-line bg-paper py-2.5 pl-10 pr-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-tide"
                  />
                </div>
                <label>
                  <span className="sr-only">Filter leads by audience</span>
                  <select
                    value={audienceFilter}
                    onChange={(event) => {
                      setAudienceFilter(event.target.value);
                      setPage(0);
                    }}
                    className="w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-[13.5px] text-ink outline-none transition-colors focus:border-tide"
                  >
                    <option value="all">All audiences</option>
                    {audienceOptions.map((audience) => (
                      <option key={audience} value={audience}>
                        {audience}
                      </option>
                    ))}
                  </select>
                </label>
                {(trimmed || audienceFilter !== "all") && (
                  <span className="shrink-0 text-[12.5px] text-ink-faint tabular-nums">
                    {total.toLocaleString()} {total === 1 ? "match" : "matches"}
                    {complete ? "" : " so far"}
                  </span>
                )}
              </div>

              {total === 0 ? (
                /* Name what's actually filtering: search text, the audience
                   pick, or both — an audience-only miss used to render
                   `No leads match ""` (rule 14: empty states tell the truth). */
                <p className="m-0 py-6 text-[13px] leading-relaxed text-ink-soft">
                  {trimmed && audienceFilter !== "all" ? (
                    <>
                      No leads in &ldquo;{audienceFilter}&rdquo; match &ldquo;
                      {trimmed}&rdquo;.
                    </>
                  ) : trimmed ? (
                    <>No leads match &ldquo;{trimmed}&rdquo;.</>
                  ) : (
                    <>
                      No leads in the &ldquo;{audienceFilter}&rdquo; audience.
                    </>
                  )}
                </p>
              ) : (
                <>
                  <div className="max-h-[70vh] overflow-auto rounded-lg">
                    <table className="w-full border-collapse text-[13px]">
                      <thead>
                        <tr>
                          <th className={TH}>Name</th>
                          <th className={TH}>Company</th>
                          <th className={TH}>Audiences</th>
                          <th className={TH}>Title</th>
                          <th className={TH}>Email</th>
                          <th className={TH}>LinkedIn</th>
                          <th className={TH}>Stage</th>
                          <th className={TH}>Source</th>
                          <th className={TH}>Demo</th>
                          <th className={TH}>Added</th>
                          <th className={`${TH} text-right`}>
                            <span className="sr-only">Actions</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visible.map((lead) => {
                          const added = relativeTime(lead.created_at);
                          const removing = removingId === lead.id;
                          const armed = armedId === lead.id;
                          const engagement = demoEngagementLabel(lead);
                          return (
                            <tr
                              key={lead.id}
                              className="border-b border-line/70"
                            >
                              <td className={`${TD} font-medium text-ink`}>
                                {lead.name || <Dash />}
                              </td>
                              <td className={TD}>{lead.company || <Dash />}</td>
                              <td className={TD}>
                                {lead.audiences.length ? (
                                  <span className="flex max-w-[18rem] items-center gap-1.5">
                                    {lead.audiences.slice(0, 2).map((audience) => (
                                      <a
                                        key={audience}
                                        href={withMockMode("/dashboard/audiences")}
                                        className={`${STAGE_PILL} max-w-[8rem] truncate no-underline hover:border-tide/40 hover:text-tide`}
                                        title={audience}
                                      >
                                        {audience}
                                      </a>
                                    ))}
                                    {lead.audiences.length > 2 && (
                                      <span className="text-[11px] text-ink-faint">+{lead.audiences.length - 2}</span>
                                    )}
                                  </span>
                                ) : (
                                  <Dash />
                                )}
                              </td>
                              <td className={TD}>{lead.title || <Dash />}</td>
                              <td className={TD}>{lead.email || <Dash />}</td>
                              <td className={TD}>
                                {lead.linkedin_url ? (
                                  <a
                                    href={lead.linkedin_url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="font-medium text-tide no-underline hover:underline"
                                  >
                                    Profile
                                  </a>
                                ) : (
                                  <Dash />
                                )}
                              </td>
                              <td className={TD}>
                                <span className={STAGE_PILL}>{stageLabel(lead.stage)}</span>
                              </td>
                              <td className={TD}>{lead.source ? sourceLabel(lead.source) : <Dash />}</td>
                              <td className={TD}>
                                {lead.demo_artifact_id || engagement ? (
                                  <span className="inline-flex flex-wrap items-center gap-1.5">
                                    {lead.demo_artifact_id && (
                                      <span className={STAGE_PILL}>Demo</span>
                                    )}
                                    {engagement && (
                                      <span className={STAGE_PILL}>{engagement}</span>
                                    )}
                                  </span>
                                ) : (
                                  <Dash />
                                )}
                              </td>
                              <td className={`${TD} tabular-nums`}>
                                {added || <Dash />}
                              </td>
                              <td className={`${TD} text-right`}>
                                {canWrite && (
                                  <button
                                    type="button"
                                    onClick={() => handleRemove(lead)}
                                    disabled={removing}
                                    title={
                                      armed || removing
                                        ? undefined
                                        : `Deletes ${leadLabel(lead)} and adds them to your blacklist`
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
                                        ? "Remove and blacklist? Confirm"
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
                      {complete
                        ? ""
                        : trimmed || audienceFilter !== "all"
                          ? " so far"
                          : " loaded so far"}
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
