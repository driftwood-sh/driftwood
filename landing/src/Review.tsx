import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ToastProvider } from "./dashboard/DashboardCommon";
import { AdminPanelControls, ImpersonationBanner } from "./GodMode";
import { CARD, fetchInWaves, prefetch, useToast } from "./dashboard-shared";
import { checkIdentity, clearIdentity, loadIdentity, type IdentityResult } from "./identity";
import IdentityUnavailable from "./components/IdentityUnavailable";
import AppShell from "./dashboard/AppShell";
import { EmailPreview } from "./EmailPreview";
import { emailBodySummary } from "./email-preview";
import { withMockMode } from "./mock-mode";
import { getSettings, type SendSchedule } from "./settings/api";
import { scheduleSentence } from "./settings/model";
import {
  DEFAULT_SENT_QUERY,
  engagementChips,
  sendKindChips,
  sendKindLabel,
  sendKindRank,
  sentLedgerQuery,
  type SentOrder,
  type SentQuery,
} from "./sends-model";
import "./review-queue.css";

/* /dashboard/review — the founder's chronological decision inbox. The scan
   list and exact-send detail stay together in the workspace; type filters and
   bulk decisions remain available above the in-page workbench. */

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
     Members are read-only — every decide/cancel/dismiss affordance hides. */
  org?: { name: string; role: "owner" | "admin" | "member" } | null;
};

/* ---------- API shapes (mirror backend app/schemas/reviews.py) ---------- */

type ReviewLeadContext = {
  lead_id: string;
  name: string | null;
  title: string | null;
  company: string | null;
  linkedin_url: string | null;
  stage: string;
  prior_sends: number;
  last_sent_at: string | null;
};

/* Per-kind ScheduledSend runway (approved but not yet delivered). */
type QueueStats = {
  kind: string; // "message" | "connection_request" | "email"
  queued: number;
  sent_24h: number;
  cap: number;
  runs_through: string | null; // ISO date; null when nothing is queued
  failed?: number; // optional: tolerate a backend that predates it
};

/* One approved-but-undelivered ScheduledSend (GET /dashboard/sends). */
type SendRow = {
  id: string;
  batch_id: string;
  kind: string; // "message" | "connection_request" | "email"
  note: string; // the frozen copy — sends exactly as shown
  subject: string | null; // email kind only; null elsewhere
  attachment_slug: string | null;
  lead: ReviewLeadContext | null;
  status: string; // "pending" | "sending" | "failed"
  error: string | null;
  // "quota" | "already_connected" | "profile_not_found" | "other";
  // null = old rows from before failure classification
  error_class: string | null;
  due_at: string; // ISO; the API orders by this asc (the send order)
  projected_date: string | null; // "YYYY-MM-DD"
  created_at: string;
  sent_at: string | null; // set on ledger rows (view=sent); null on live ones
  /* Demo engagement, set on first-touch demo emails (the GIF links to a
     player page). Optional throughout: an older backend omits them and the
     ledger simply shows no chips. See engagementChips in sends-model.ts. */
  tracked?: boolean;
  opened_at?: string | null;
  open_suspect?: boolean;
  clicked_at?: string | null;
  watched_pct?: number | null;
};

type SendsPageData = {
  sends: SendRow[];
  total: number;
  limit: number;
  offset: number;
  counts: { pending: number; sending: number; failed: number; sent?: number };
  // Per-kind census of the requested view's whole population (filter- and
  // pagination-independent). Optional: tolerate a backend that predates it —
  // the sent tab's filter controls only render when it's present.
  kind_counts?: Record<string, number>;
};

type CancelResult = {
  canceled: number;
  skipped: string[]; // ids that already went out
  agent_woken: boolean;
};

/* POST /dashboard/sends/dismiss — failed rows only; skipped ids weren't
   failed (or weren't ours), so they stay in the list. */
type DismissResult = {
  dismissed: number;
  skipped: string[];
};

/* bug_validation's structured evidence — required at submission by the
   request_review tool, but typed defensively (the column is JSONB). */
type BugEvidence = {
  repro_steps?: string[];
  url?: string;
  device?: string;
  video_timestamp?: string;
};

type ReviewItemRow = {
  can_decide: boolean;
  approval_policy_version: number;
  id: string;
  batch_id: string;
  agent_id: string;
  kind: string; // "send_message" | "send_connection" | "send_email" | "send_x_dm" | "follow_x_account" | "bug_validation"
  title: string;
  body: string;
  subject: string | null; // send_email only; null elsewhere
  lead: ReviewLeadContext | null;
  attachment_slug: string | null;
  evidence: BugEvidence | null;
  status: string;
  decision_reason: string | null;
  decided_at: string | null;
  scheduled_batch_id: string | null;
  created_at: string;
};

type ReviewsPageData = {
  pending: ReviewItemRow[];
  decided: ReviewItemRow[]; // returned by the API; ignored in v1
  total_pending: number;
  limit: number;
  offset: number;
  queue_stats?: QueueStats[]; // optional: tolerate a backend that predates it
  counts?: ReviewQueueCounts; // optional: tolerate a backend that predates it
};

type ReviewQueueCounts = {
  pending: number;
  pending_sends: number;
  pending_system: number;
  approved_7d: number;
  denied_7d: number;
};

type DecideItem = {
  item_id: string;
  decision: "approve" | "deny";
  reason?: string;
};

type DecideResult = {
  approved: number;
  denied: number;
  skipped: string[];
  queued: string[];
  agent_woken: boolean;
};

/* ---------- page shell ---------- */

/* /auth/me starts at module eval (chunk load), in parallel with the data
   prefetches below — cached identity paints the real shell immediately and
   the background result confirms it or bounces to /dashboard. */
const identityBoot =
  typeof window === "undefined" ? null : loadIdentity<User>();

export default function Review() {
  /* Unapproved users never seed from cache — they belong on /dashboard's
     pending screen, and the fresh result below sends them there. */
  const [user, setUser] = useState<User | null>(
    identityBoot?.cached?.is_approved ? identityBoot.cached : null,
  );
  const [unavailable, setUnavailable] = useState(false);

  const apply = useCallback((result: IdentityResult<User>) => {
    // Only approved users get the queue; everyone else goes back to the
    // dashboard, which handles login + the pending-approval state. A 401
    // or 403 already cleared the identity cache.
    if (result.state === "user" && result.user.is_approved) {
      setUser(result.user); // swap in place when it differs from the cache
    } else if (result.state === "unavailable") {
      setUnavailable(true); // a painted queue stays; otherwise the error card
    } else {
      if (result.state === "user") clearIdentity(); // logged in, but not approved
      window.location.href = withMockMode("/dashboard");
    }
  }, []);

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
      <div className="grain relative flex min-h-[100dvh] flex-col overflow-x-clip">
        {user ? (
          <ReviewView user={user} />
        ) : unavailable ? (
          <IdentityUnavailable
            onRetry={() => {
              setUnavailable(false);
              void checkIdentity<User>().then(apply);
            }}
          />
        ) : (
          <LoadingView />
        )}
      </div>
    </ToastProvider>
  );
}

/* Pre-auth first paint with no cached identity: mirror the page we're about
   to show (title, section tabs, queue rows) instead of a lone spinner on a
   blank page — ux-principles rules 1 + 2. The AppShell chrome itself still
   waits on identity (it needs the user's name and role). Local Tailwind-only
   copy per the Leads/Companies precedent — the shared skeleton utility is a
   later batch. */
function LoadingView() {
  return (
    <div
      role="status"
      aria-label="Loading review queue"
      className="mx-auto w-full max-w-[82rem] flex-1 animate-pulse px-4 pb-10 motion-reduce:animate-none sm:px-8"
    >
      <div className="mt-11 h-9 w-56 rounded-md bg-sand" />
      <div className="mt-6 flex gap-2">
        {[0, 1, 2].map((tab) => (
          <div key={tab} className="h-[34px] w-28 rounded-full bg-sand" />
        ))}
      </div>
      <div className="mt-6 border-t border-line">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2.5 border-b border-line/70 py-4">
            <div className="flex items-center gap-4">
              <div className="h-3 w-16 rounded bg-sand" />
              <div className="h-3.5 w-[28%] min-w-[9rem] rounded bg-line" />
            </div>
            <div className="h-3 w-[55%] max-w-[34rem] rounded bg-sand" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ReviewView({ user }: { user: User }) {
  const displayName = user.name || user.email;
  // Solo accounts carry no org and stay full-control; workspace members are
  // read-only — they see the queue and the sends, never the buttons.
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
        active="review"
        identity={{ name: displayName, workspace: user.org?.name, avatarUrl: user.avatar_url }}
        onLogout={handleLogout}
        adminControl={user.is_admin ? <AdminPanelControls /> : undefined}
        canWrite={canWrite}
      >
        <div className="review-page"><ReviewQueue canWrite={canWrite} /></div>
      </AppShell>
    </>
  );
}

/* ---------- the queue (GET /api/v1/dashboard/reviews) ---------- */

/* Pending items load against the 100-cap endpoint: the first page paints the
   moment it lands, then the rest fetch in parallel (a real queue is ~1,000
   items = ~10 pages, and a serial loop held first paint for the whole ride).
   Stats/counts come from the offset=0 response ONLY — the backend may return
   them empty on later pages. Until every page lands, `complete` is false:
   bulk approve/deny stay parked (so "all" can never silently mean "the
   subset that had loaded") and the count label reads loaded-of-total. */
const FETCH_CHUNK = 100;
const FETCH_GUARD = 100; // hard ceiling on total pages fetched per list

/* First pages for all three tabs fire at module eval, in parallel with
   /auth/me (see prefetch() in dashboard-shared). Each is consumed exactly
   once by its loader's initial run; refetches go to the network. */
const initialReviewsPage = prefetch(() =>
  fetch(`/api/v1/dashboard/reviews?limit=${FETCH_CHUNK}&offset=0`, {
    credentials: "include",
  }),
);
const initialSendsPage = prefetch(() =>
  fetch(`/api/v1/dashboard/sends?limit=${FETCH_CHUNK}&offset=0`, {
    credentials: "include",
  }),
);
const initialSentPage = prefetch(() =>
  fetch(`/api/v1/dashboard/sends?${sentLedgerQuery(DEFAULT_SENT_QUERY, 100)}`, {
    credentials: "include",
  }),
);
/* The workspace send schedule, for the one line above the runway strip. */
const initialSettings = prefetch(() => getSettings());

type QueueState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      items: ReviewItemRow[];
      stats: QueueStats[];
      counts: ReviewQueueCounts | null;
      /* total_pending from the first page — the denominator for the
         loaded-of-total label while the rest streams in. */
      totalPending: number;
      /* Later pages still in flight (drives the quiet spinner line). */
      loadingMore: boolean;
      /* Every page landed. False while loading more — and it stays false
         if a later page failed, so bulk actions never operate on a list
         that is silently missing a chunk. */
      complete: boolean;
    };

type SendsState =
  | { status: "loading" }
  | { status: "error" }
  | {
      status: "ready";
      sends: SendRow[];
      total: number;
      loadingMore: boolean;
      complete: boolean;
    };

type SentState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; sends: SendRow[]; total: number };

type DecideError = { message: string; itemId: string | null };

const EMPTY_SET: ReadonlySet<string> = new Set();

/* Stamped on every bulk denial so the agent reading back decision_reason can
   tell a considered no from a queue clear-out. The per-item deny box is where
   a real reason gets typed. */
const BULK_DENY_REASON = "Bulk denied from the review queue";

const DECIDE_FALLBACK = "Couldn't submit that decision. Please try again.";
const CANCEL_FALLBACK = "Couldn't cancel those sends. Please try again.";
const DISMISS_FALLBACK = "Couldn't dismiss those sends. Please try again.";

const MICROLABEL =
  "font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-faint";
const STAGE_PILL =
  "inline-flex items-center rounded-full border border-line bg-paper px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.06em] text-ink-soft";

/* "3h" / "2d" — the draft's compact age, not the "ago" form. */
function shortAge(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 3600) return `${Math.max(1, Math.round(secs / 60))}m`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h`;
  return `${Math.round(secs / 86400)}d`;
}

function kindLabel(kind: string): string {
  if (kind === "send_message") return "message";
  if (kind === "send_connection") return "connection";
  if (kind === "send_email") return "email";
  if (kind === "send_x_dm") return "X DM";
  if (kind === "follow_x_account") return "X follow";
  if (kind === "bug_validation") return "bug";
  if (kind === "drift_task_install") return "drift task";
  return kind;
}

/* Failure classes → the human tail of the red status line ("failed ·
   already connected"); null (rows from before classification) renders bare
   "failed". Quota failures now defer server-side instead of failing, so
   live failed rows are mostly the other three. */
const ERROR_CLASS_LABEL: Record<string, string> = {
  quota: "quota",
  already_connected: "already connected",
  profile_not_found: "profile not found",
  other: "other",
};

/* Kind order — bugs first: they are few, decision-critical, and gate the
   agent's outreach drafting, while connections pile up and get bulk-cleared.
   Orders both the chips and the card list (stable-sorted, so it stays
   oldest-first within each kind); unknown kinds trail in queue order. */
const KIND_ORDER = [
  "bug_validation",
  "drift_task_install",
  "send_connection",
  "send_message",
  "send_email",
  "send_x_dm",
  "follow_x_account",
];

/* Real outreach vs system items (bug validations, drift installs): the
   queue leads with sends — the things a founder is here to approve — and
   system items live behind their own chip so they never crowd the emails. */
const SEND_ITEM_KINDS = new Set([
  "send_message",
  "send_connection",
  "send_email",
  "send_x_dm",
  "follow_x_account",
]);
const SYSTEM_CHIP = "__system";

function kindRank(kind: string): number {
  const i = KIND_ORDER.indexOf(kind);
  return i === -1 ? KIND_ORDER.length : i;
}

type SortMode = "kind" | "oldest" | "newest" | "company";

/* The list's sort control. "kind" is the historical default (KIND_ORDER
   groups, oldest-first inside each — the API's order is preserved by the
   stable sort); the rest are what a founder reaches for when triaging by
   arrival time or clearing one account's items together. */
function sortItems(items: ReviewItemRow[], mode: SortMode): ReviewItemRow[] {
  const sorted = [...items];
  if (mode === "kind")
    return sorted.sort((a, b) => kindRank(a.kind) - kindRank(b.kind));
  if (mode === "oldest")
    return sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
  if (mode === "newest")
    return sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return sorted.sort((a, b) =>
    (a.lead?.company ?? "").localeCompare(b.lead?.company ?? ""),
  );
}

/* Bug demos are hosted at /d/<slug>. Items should carry attachment_slug,
   but early bug_validation submissions referenced their demo only inside
   the evidence text — pull the first /d/ slug out of it so the card still
   renders the player instead of a text-only claim. */
function salvagedDemoSlug(item: ReviewItemRow): string | null {
  if (item.kind !== "bug_validation") return null;
  const text = `${item.evidence?.video_timestamp ?? ""} ${item.body}`;
  const match = /\/d\/([a-z0-9][a-z0-9_-]*)/i.exec(text);
  return match ? match[1] : null;
}

/* Pull the human-readable error out of the backend's envelope
   ({"error": {"code", "detail"}}) — e.g. the 409 linkedin_not_connected
   message — falling back to a generic line. Decide and cancel share the
   envelope, so they share this reader. */
async function readErrorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as {
      error?: { code?: string; detail?: unknown };
    };
    const detail = data.error?.detail;
    if (typeof detail === "string" && detail) return detail;
  } catch {
    // non-JSON body — use the fallback
  }
  return fallback;
}

function summarizeDecide(r: DecideResult): string {
  const parts: string[] = [];
  if (r.approved) parts.push(`${r.approved} approved`);
  if (r.denied) parts.push(`${r.denied} denied`);
  if (r.skipped.length) parts.push(`${r.skipped.length} already decided`);
  const head = parts.join(" · ") || "Nothing to decide";
  return r.queued.length ? `${head} · ${r.queued.join("; ")}.` : `${head}.`;
}

function summarizeCancel(r: CancelResult): string {
  const parts: string[] = [];
  if (r.canceled) parts.push(`${r.canceled} canceled`);
  if (r.skipped.length) parts.push(`${r.skipped.length} already sent`);
  return `${parts.join(" · ") || "Nothing to cancel"}.`;
}

function summarizeDismiss(r: DismissResult): string {
  const parts: string[] = [];
  if (r.dismissed) parts.push(`${r.dismissed} dismissed`);
  if (r.skipped.length) parts.push(`${r.skipped.length} skipped`);
  return `${parts.join(" · ") || "Nothing to dismiss"}.`;
}

type Tab = "review" | "queued" | "sent";

/* `?tab=queued` / `?tab=sent` deep-link those views (the digest link and
   the overview's "View all" respectively); anything else lands on
   needs-review. */
function tabFromUrl(): Tab {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "queued" ? "queued" : tab === "sent" ? "sent" : "review";
}

function ReviewQueue({ canWrite }: { canWrite: boolean }) {
  const [state, setState] = useState<QueueState>({ status: "loading" });
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [deny, setDeny] = useState<{ id: string; reason: string } | null>(null);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [decideError, setDecideError] = useState<DecideError | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [confirmDenyAll, setConfirmDenyAll] = useState(false);
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [activeReviewId, setActiveReviewId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>(tabFromUrl);
  const [sendsState, setSendsState] = useState<SendsState>({
    status: "loading",
  });
  const [sentState, setSentState] = useState<SentState>({ status: "loading" });
  const [sentQuery, setSentQuery] = useState<SentQuery>(DEFAULT_SENT_QUERY);
  /* The ledger's census + all-time total live outside sentState so the
     chips and the tab count hold steady while a filter refetch is in
     flight. null until the first load (or on a backend that predates
     kind_counts — the controls stay hidden then). */
  const [sentKindCounts, setSentKindCounts] = useState<Record<
    string,
    number
  > | null>(null);
  const [sentAllTotal, setSentAllTotal] = useState<number | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>("kind");
  /* The saved send schedule; null while loading and when the fetch fails,
     and the strip line renders nothing either way. */
  const [schedule, setSchedule] = useState<SendSchedule | null>(null);
  const toast = useToast();

  useEffect(() => {
    let current = true;
    (initialSettings.take() ?? getSettings()).then(
      (page) => {
        if (current) setSchedule(page.send_schedule);
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);

  /* An armed "Approve all" disarms itself after a beat — no stale confirm
     button waiting to be fat-fingered minutes later. */
  useEffect(() => {
    if (!confirmAll) return;
    const t = window.setTimeout(() => setConfirmAll(false), 5000);
    return () => window.clearTimeout(t);
  }, [confirmAll]);

  /* Same for "Deny all" — and the two are mutually exclusive, so arming one
     disarms the other. Denying is not destructive the way approving is (it
     sends nothing), but 300 items is still not something to fat-finger. */
  useEffect(() => {
    if (!confirmDenyAll) return;
    const t = window.setTimeout(() => setConfirmDenyAll(false), 5000);
    return () => window.clearTimeout(t);
  }, [confirmDenyAll]);

  const loadAll = useCallback(async () => {
    try {
      // The mount run rides the module-eval prefetch; anything after gets
      // its own fresh request.
      const res = await (initialReviewsPage.take() ??
        fetch(`/api/v1/dashboard/reviews?limit=${FETCH_CHUNK}&offset=0`, {
          credentials: "include",
        }));
      if (!res.ok) throw new Error("request failed");
      const first = (await res.json()) as ReviewsPageData;
      // Stats + counts come from the offset=0 response only — later pages
      // may legitimately return them empty.
      const stats = first.queue_stats ?? [];
      const counts = first.counts ?? null;
      const totalPending = first.total_pending;
      // Same ceiling as the old serial loop: FETCH_GUARD pages in total.
      const pageCount =
        first.pending.length === 0
          ? 1
          : Math.min(Math.ceil(totalPending / FETCH_CHUNK), FETCH_GUARD);
      const done = pageCount <= 1 || first.pending.length >= totalPending;
      // Paint now — the rest of the queue streams in behind this.
      setState({
        status: "ready",
        items: first.pending,
        stats,
        counts,
        totalPending,
        loadingMore: !done,
        complete: done,
      });
      if (done) return;

      const offsets: number[] = [];
      for (let p = 1; p < pageCount; p++) offsets.push(p * FETCH_CHUNK);
      const pages = await fetchInWaves(offsets, async (offset) => {
        const r = await fetch(
          `/api/v1/dashboard/reviews?limit=${FETCH_CHUNK}&offset=${offset}`,
          { credentials: "include" },
        );
        if (!r.ok) throw new Error("request failed");
        return (await r.json()) as ReviewsPageData;
      });
      const complete = pages.every((page) => page !== null);
      // Merge in offset order so the server's oldest-first order holds.
      const rest: ReviewItemRow[] = [];
      for (const page of pages) if (page) rest.push(...page.pending);
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        // Dedupe by id: items decided mid-load shift server offsets, so
        // pages can overlap each other and the already-painted list.
        const seen = new Set(prev.items.map((item) => item.id));
        const fresh = rest.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
        return {
          ...prev,
          items: [...prev.items, ...fresh],
          loadingMore: false,
          complete,
        };
      });
    } catch {
      setState((prev) => (prev.status === "ready" ? prev : { status: "error" }));
    }
  }, []);

  /* The queued tab's data loads up front alongside the reviews (its count
     sits in the tab label, so it can't wait for a tab switch) — same
     first-page-paints-then-parallel treatment, same guard, against
     GET /dashboard/sends (due_at asc = send order; the offset-order merge
     keeps that order). */
  const loadAllSends = useCallback(async () => {
    try {
      const res = await (initialSendsPage.take() ??
        fetch(`/api/v1/dashboard/sends?limit=${FETCH_CHUNK}&offset=0`, {
          credentials: "include",
        }));
      if (!res.ok) throw new Error("request failed");
      const first = (await res.json()) as SendsPageData;
      const total = first.total;
      const pageCount =
        first.sends.length === 0
          ? 1
          : Math.min(Math.ceil(total / FETCH_CHUNK), FETCH_GUARD);
      const done = pageCount <= 1 || first.sends.length >= total;
      setSendsState({
        status: "ready",
        sends: first.sends,
        total,
        loadingMore: !done,
        complete: done,
      });
      if (done) return;

      const offsets: number[] = [];
      for (let p = 1; p < pageCount; p++) offsets.push(p * FETCH_CHUNK);
      const pages = await fetchInWaves(offsets, async (offset) => {
        const r = await fetch(
          `/api/v1/dashboard/sends?limit=${FETCH_CHUNK}&offset=${offset}`,
          { credentials: "include" },
        );
        if (!r.ok) throw new Error("request failed");
        return (await r.json()) as SendsPageData;
      });
      const complete = pages.every((page) => page !== null);
      const rest: SendRow[] = [];
      for (const page of pages) if (page) rest.push(...page.sends);
      setSendsState((prev) => {
        if (prev.status !== "ready") return prev;
        // Same dedupe as the reviews: cancels mid-load shift offsets.
        const seen = new Set(prev.sends.map((s) => s.id));
        const fresh = rest.filter((s) => {
          if (seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
        return {
          ...prev,
          sends: [...prev.sends, ...fresh],
          loadingMore: false,
          complete,
        };
      });
    } catch {
      setSendsState((prev) =>
        prev.status === "ready" ? prev : { status: "error" },
      );
    }
  }, []);

  /* The delivered ledger (view=sent): one page is enough for the tab —
     100 rows with the all-time total in the label. The ledger pages, so the
     kind filter and sort are server-side (`kind`/`order` params) — a
     client-side filter over the newest 100 would lie about the rest. */
  const loadSent = useCallback(async (query: SentQuery) => {
    try {
      // The first run is always DEFAULT_SENT_QUERY (the state's initial
      // value), which is exactly what the prefetch requested; filter/sort
      // refetches find the slot empty and hit the network.
      const res = await (initialSentPage.take() ??
        fetch(`/api/v1/dashboard/sends?${sentLedgerQuery(query, 100)}`, {
          credentials: "include",
        }));
      if (!res.ok) throw new Error("request failed");
      const page = (await res.json()) as SendsPageData;
      setSentState({ status: "ready", sends: page.sends, total: page.total });
      setSentKindCounts(page.kind_counts ?? null);
      setSentAllTotal(page.counts.sent ?? page.total);
    } catch {
      setSentState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await Promise.all([loadAll(), loadAllSends()]);
    })();
  }, [loadAll, loadAllSends]);

  /* Re-fetches on every filter/sort change; the first run doubles as the
     initial load. The loading flip lives in changeSentQuery (an event
     handler), so the effect itself never sets state synchronously. */
  useEffect(() => {
    void (async () => {
      await loadSent(sentQuery);
    })();
  }, [loadSent, sentQuery]);

  /* Filter/sort switch: show the spinner for the refetch instead of the
     previous query's rows. */
  function changeSentQuery(next: SentQuery) {
    setSentQuery(next);
    setSentState({ status: "loading" });
  }

  /* Re-pull just the stats strip after a decide — approvals turn into
     ScheduledSend rows server-side, so "queued" moves immediately. Items are
     already reconciled locally; a failure here just leaves the strip one
     decide stale. */
  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/dashboard/reviews?limit=1", {
        credentials: "include",
      });
      if (!res.ok) return;
      const page = (await res.json()) as ReviewsPageData;
      const stats = page.queue_stats;
      if (stats)
        setState((prev) =>
          prev.status === "ready" ? { ...prev, stats } : prev,
        );
    } catch {
      // stale strip is fine — the next full load refreshes it
    }
  }, []);

  /* One decide POST per user action (bulk decisions arrive as one call, so an
     approve-all session is one agent wake). On success the decided items
     leave the list; on failure everything stays put and the error renders
     red next to where the tap happened (`source` = item id, null = bulk). */
  const decide = useCallback(
    async (decisions: DecideItem[], source: string | null) => {
      if (decisions.length === 0) return;
      const selectedItems = state.status === "ready" ? state.items.filter((item) => decisions.some((d) => d.item_id === item.id)) : [];
      if (selectedItems.length !== decisions.length || selectedItems.some((item) => !item.can_decide) || new Set(selectedItems.map((item) => item.approval_policy_version)).size !== 1) { setDecideError({itemId:source,message:"Approval assignments changed. Refresh the queue."}); return; }
      setBusyIds(new Set(decisions.map((d) => d.item_id)));
      setDecideError(null);
      try {
        const res = await fetch("/api/v1/dashboard/reviews/decide", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", "If-Match": String(selectedItems[0].approval_policy_version) },
          body: JSON.stringify(decisions),
        });
        if (!res.ok) throw new Error(await readErrorDetail(res, DECIDE_FALLBACK));
        const result = (await res.json()) as DecideResult;
        // Skipped ids were already decided elsewhere — no longer pending
        // either way, so every posted id leaves the queue.
        const done = new Set(decisions.map((d) => d.item_id));
        setState((prev) =>
          prev.status === "ready"
            ? {
                ...prev,
                items: prev.items.filter((item) => !done.has(item.id)),
              }
            : prev,
        );
        setSelected((prev) => new Set([...prev].filter((id) => !done.has(id))));
        setDeny((prev) => (prev && done.has(prev.id) ? null : prev));
        toast(summarizeDecide(result), "success");
        void refreshStats();
      } catch (err) {
        setDecideError({
          message: err instanceof Error && err.message ? err.message : DECIDE_FALLBACK,
          itemId: source,
        });
      } finally {
        setBusyIds(EMPTY_SET);
      }
    },
    [toast, refreshStats, state],
  );

  /* Optimistic reconciliation for cancels — the QueuedList posts, then hands
     back the ids that are no longer queued (canceled OR already sent). */
  const removeSends = useCallback((ids: ReadonlySet<string>) => {
    setSendsState((prev) =>
      prev.status === "ready"
        ? { ...prev, sends: prev.sends.filter((s) => !ids.has(s.id)) }
        : prev,
    );
  }, []);

  /* replaceState (not push) keeps the param shareable without growing
     history — back should leave the page, not unwind tab flips. */
  function switchTab(next: Tab) {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    if (next === "review") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash,
    );
  }

  /* Sends and system items are separate populations: the queue leads with
     the outreach a founder is here to approve, and bug validations / drift
     installs sit behind their own chip. Within the send list the sort
     control applies; "by type" (default) keeps the historical KIND_ORDER
     grouping with the API's oldest-first order inside each kind. */
  const allItems = state.status === "ready" ? state.items.filter((item) => !canWrite || item.can_decide) : [];
  const systemItems = allItems.filter((item) => !SEND_ITEM_KINDS.has(item.kind));
  const items = sortItems(
    allItems.filter((item) => SEND_ITEM_KINDS.has(item.kind)),
    sortMode,
  );
  /* Tab counts wait for the full list — a partially loaded count in the
     label would lie about how much is actually queued. */
  const queuedCount =
    sendsState.status === "ready" && sendsState.complete
      ? sendsState.sends.length
      : null;

  /* Kind filter: chips narrow the list so "select all → approve" can clear
     one send type (e.g. every connection request) without hand-sorting.
     Everything below the chips — select-all, Approve selected, Approve all,
     the cards — operates on the FILTERED list only. A filter whose kind
     empties out (last item decided) falls back to "all" by derivation, so
     the list never strands on an empty view. */
  const kindCounts = new Map<string, number>();
  for (const item of items)
    kindCounts.set(item.kind, (kindCounts.get(item.kind) ?? 0) + 1);
  const chipKinds = [...kindCounts.keys()].sort(
    (a, b) => kindRank(a) - kindRank(b),
  );
  const activeKind =
    kindFilter === SYSTEM_CHIP
      ? systemItems.length > 0
        ? SYSTEM_CHIP
        : null
      : kindFilter !== null && kindCounts.has(kindFilter)
        ? kindFilter
        : null;
  const visible =
    activeKind === SYSTEM_CHIP
      ? sortItems(systemItems, sortMode)
      : activeKind === null
        ? items
        : items.filter((item) => item.kind === activeKind);
  const activeReviewItem =
    visible.find((item) => item.id === activeReviewId) ?? visible[0] ?? null;

  const busy = busyIds.size > 0;
  const allSelected = visible.length > 0 && selected.size === visible.length;
  /* Bulk approve/deny stay parked until the whole queue is loaded —
     "all" must never silently mean "the subset that had loaded". Per-item
     and selected-item decisions stay live throughout. */
  const queueComplete = state.status === "ready" && state.complete;

  /* Selection resets on every filter change so a card hidden by the filter
     can never ride along into a bulk approve; the armed Approve all disarms
     for the same reason (its count just changed meaning). */
  function switchFilter(kind: string | null) {
    setKindFilter(kind);
    setSelected(EMPTY_SET);
    setConfirmAll(false);
    setConfirmDenyAll(false);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleBulkApprove() {
    // Preserve queue order in the POST — oldest first, like the page.
    void decide(
      visible
        .filter((item) => selected.has(item.id))
        .map((item) => ({ item_id: item.id, decision: "approve" as const })),
      null,
    );
  }

  /* First tap arms the button ("Approve all N? Confirm"); the second submits
     every visible pending item as one decide POST. Real outreach gets queued
     on approve — never off a single click. */
  function handleApproveAll() {
    if (!queueComplete) return; // parked while the rest of the queue loads
    if (!confirmAll) {
      setConfirmDenyAll(false);
      setConfirmAll(true);
      return;
    }
    setConfirmAll(false);
    void decide(
      visible.map((item) => ({ item_id: item.id, decision: "approve" as const })),
      null,
    );
  }

  function handleBulkDeny() {
    void decide(
      visible
        .filter((item) => selected.has(item.id))
        .map((item) => ({
          item_id: item.id,
          decision: "deny" as const,
          reason: BULK_DENY_REASON,
        })),
      null,
    );
  }

  /* Deny all, armed the same way as Approve all. Clearing a whole kind at once
     is the point: a lane that gets shelved (say outreach moves off LinkedIn)
     leaves hundreds of pending items that would otherwise need one tap each,
     and the per-item deny box does not scale to that. */
  function handleDenyAll() {
    if (!queueComplete) return; // parked while the rest of the queue loads
    if (!confirmDenyAll) {
      setConfirmAll(false);
      setConfirmDenyAll(true);
      return;
    }
    setConfirmDenyAll(false);
    void decide(
      visible.map((item) => ({
        item_id: item.id,
        decision: "deny" as const,
        reason: BULK_DENY_REASON,
      })),
      null,
    );
  }

  return (
    <>
      <div className="review-page-header">
        <h1 className="m-0 text-[clamp(1.7rem,3.6vw,2.25rem)] font-semibold leading-[1.08] tracking-[-0.015em]">
          Review queue
        </h1>
        {state.status === "ready" && (allItems.length > 0 || state.counts) && (
          <span className="mb-[5px] shrink-0 font-mono text-[11px] tracking-[0.06em] text-ink-faint tabular-nums">
            {/* Until every page lands, the count is loaded-of-total —
                a bare number would lie about the queue's size. */}
            {state.complete
              ? `${items.length} pending`
              : `${allItems.length.toLocaleString()} of ${state.totalPending.toLocaleString()} pending`}
            {state.counts ? ` · ${state.counts.approved_7d} approved this week` : ""}
          </span>
        )}
      </div>

      {/* Needs review = decisions still owed; Queued = approved sends waiting
          on the dispatcher. Counts fill in as each list finishes loading. */}
      <div
        role="group"
        aria-label="Queue sections"
        className="review-tabs"
      >
        <TabButton
          label="Needs review"
          count={
            state.status === "ready" && state.complete ? items.length : null
          }
          active={tab === "review"}
          onClick={() => switchTab("review")}
        />
        <TabButton
          label="Queued"
          count={queuedCount}
          active={tab === "queued"}
          onClick={() => switchTab("queued")}
        />
        <TabButton
          label="Sent"
          count={sentAllTotal}
          active={tab === "sent"}
          onClick={() => switchTab("sent")}
        />
      </div>

      {state.status === "ready" && <QueueStatsStrip stats={state.stats} schedule={schedule} />}

      {/* Quiet "more is coming" line: the first page is already interactive;
          this explains the growing list and the parked bulk buttons. */}
      {tab === "review" && state.status === "ready" && state.loadingMore && (
        <LoadingMoreLine>Loading the rest of the queue</LoadingMoreLine>
      )}

      {tab === "review" && state.status === "loading" && (
        <div className="flex items-center justify-center py-16">
          <span
            className="size-6 animate-spin rounded-full border-2 border-line border-t-tide"
            role="status"
            aria-label="Loading review queue"
          />
        </div>
      )}

      {tab === "review" && state.status === "error" && (
        <p className="m-0 mt-6 text-[14px] font-medium text-red-700" role="alert">
          Couldn&rsquo;t load your review queue. Please refresh.
        </p>
      )}

      {tab === "review" &&
        state.status === "ready" &&
        (items.length === 0 && systemItems.length === 0 ? (
          <EmptyQueue />
        ) : (
          <>
            {/* Always visible (even single-kind) so the queue's composition
                is readable at a glance — hiding it read as "the feature is
                gone" when the queue happened to be all one type. */}
            <div
              role="group"
              aria-label="Filter by type"
              className="review-filters"
            >
              <FilterChip
                label="all"
                count={items.length}
                active={activeKind === null}
                onClick={() => switchFilter(null)}
              />
              {chipKinds.map((kind) => (
                <FilterChip
                  key={kind}
                  label={kindLabel(kind)}
                  count={kindCounts.get(kind) ?? 0}
                  active={activeKind === kind}
                  onClick={() =>
                    switchFilter(activeKind === kind ? null : kind)
                  }
                />
              ))}
              {systemItems.length > 0 && (
                <FilterChip
                  label="system"
                  count={systemItems.length}
                  active={activeKind === SYSTEM_CHIP}
                  onClick={() =>
                    switchFilter(activeKind === SYSTEM_CHIP ? null : SYSTEM_CHIP)
                  }
                />
              )}
              <label className="ml-auto inline-flex items-center gap-2 text-[12.5px] text-ink-soft">
                sort
                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="rounded-lg border border-line bg-surface px-2 py-1 text-[12.5px] text-ink"
                >
                  <option value="kind">by type</option>
                  <option value="oldest">oldest first</option>
                  <option value="newest">newest first</option>
                  <option value="company">by company</option>
                </select>
              </label>
            </div>

            {/* read-only members keep the count line; the selection +
                decide affordances only exist for writers */}
            <div className="review-toolbar">
              {canWrite && (
                <>
                  <label className="inline-flex cursor-pointer items-center gap-[9px] text-[13.5px] font-medium text-ink-soft">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? new Set(visible.map((item) => item.id))
                            : EMPTY_SET,
                        )
                      }
                      aria-label="Select all items"
                      className="size-5 shrink-0 accent-tide"
                    />
                    Select all
                  </label>
                  {selected.size > 0 && (
                    <button
                      type="button"
                      onClick={handleBulkApprove}
                      disabled={busy}
                      className="min-h-9 cursor-pointer rounded-[10px] bg-tide px-3.5 py-2 text-[13px] font-semibold text-white shadow-[0_3px_12px_-5px_rgba(22,24,29,0.45)] transition-colors hover:bg-tide-deep disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Approve selected ({selected.size})
                    </button>
                  )}
                  {selected.size > 0 && (
                    <button
                      type="button"
                      onClick={handleBulkDeny}
                      disabled={busy}
                      className="min-h-9 cursor-pointer rounded-[10px] border border-line bg-surface px-3.5 py-2 text-[13px] font-medium text-red-700 transition-colors hover:border-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      Deny selected ({selected.size})
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleApproveAll}
                    disabled={busy || !queueComplete}
                    title={
                      queueComplete
                        ? undefined
                        : "Available once the full queue loads"
                    }
                    className={`min-h-9 cursor-pointer rounded-[10px] px-3.5 py-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      confirmAll
                        ? "bg-tide font-semibold text-white shadow-[0_3px_12px_-5px_rgba(22,24,29,0.45)] hover:bg-tide-deep"
                        : "border border-line bg-surface font-medium text-ink-soft hover:border-ink-faint hover:text-ink"
                    }`}
                  >
                    {confirmAll
                      ? `Approve all ${visible.length}? Confirm`
                      : "Approve all"}
                  </button>
                  <button
                    type="button"
                    onClick={handleDenyAll}
                    disabled={busy || !queueComplete}
                    title={
                      queueComplete
                        ? undefined
                        : "Available once the full queue loads"
                    }
                    className={`min-h-9 cursor-pointer rounded-[10px] px-3.5 py-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      confirmDenyAll
                        ? "bg-red-700 font-semibold text-white shadow-[0_3px_12px_-5px_rgba(22,24,29,0.45)] hover:bg-red-800"
                        : "border border-line bg-surface font-medium text-ink-soft hover:border-red-700 hover:text-red-700"
                    }`}
                  >
                    {confirmDenyAll
                      ? `Deny all ${visible.length}? Confirm`
                      : "Deny all"}
                  </button>
                </>
              )}
              <span className="ml-auto shrink-0 font-mono text-[11px] tracking-[0.06em] text-ink-faint tabular-nums">
                {activeKind === null
                  ? state.complete
                    ? `${items.length} pending`
                    : `${allItems.length.toLocaleString()} of ${state.totalPending.toLocaleString()} pending`
                  : `${visible.length} of ${items.length}`}
              </span>
            </div>

            {decideError && decideError.itemId === null && (
              <p
                className="m-0 mb-2.5 text-[13.5px] font-medium text-red-700"
                role="alert"
              >
                {decideError.message}
              </p>
            )}

            <div className="review-workbench">
              <div className="review-inbox" role="list" aria-label="Items awaiting review">
                {visible.map((item) => (
                  <ReviewListRow
                    key={item.id}
                    item={item}
                    active={activeReviewItem?.id === item.id}
                    canWrite={canWrite}
                    checked={selected.has(item.id)}
                    busy={busyIds.has(item.id)}
                    onOpen={() => {
                      setActiveReviewId(item.id);
                      setDeny(null);
                    }}
                    onToggleSelect={() => toggleSelect(item.id)}
                  />
                ))}
              </div>
              <div className="review-detail" aria-live="polite">
                {activeReviewItem && (
                  <ItemCard
                    key={activeReviewItem.id}
                    item={activeReviewItem}
                    canWrite={canWrite}
                    busy={busyIds.has(activeReviewItem.id)}
                    denyReason={deny?.id === activeReviewItem.id ? deny.reason : null}
                    error={decideError?.itemId === activeReviewItem.id ? decideError.message : null}
                    onApprove={() => void decide([{ item_id: activeReviewItem.id, decision: "approve" }], activeReviewItem.id)}
                    onToggleDeny={() => setDeny((prev) => prev?.id === activeReviewItem.id ? null : { id: activeReviewItem.id, reason: "" })}
                    onReasonChange={(reason) => setDeny({ id: activeReviewItem.id, reason })}
                    onCancelDeny={() => setDeny(null)}
                    onConfirmDeny={() => void decide([{ item_id: activeReviewItem.id, decision: "deny", reason: deny?.reason.trim() ?? "" }], activeReviewItem.id)}
                  />
                )}
              </div>
            </div>
          </>
        ))}

      {tab === "queued" &&
        sendsState.status === "ready" &&
        sendsState.loadingMore && (
          <LoadingMoreLine>Loading the rest of the queued sends</LoadingMoreLine>
        )}

      {tab === "queued" && sendsState.status === "loading" && (
        <div className="flex items-center justify-center py-16">
          <span
            className="size-6 animate-spin rounded-full border-2 border-line border-t-tide"
            role="status"
            aria-label="Loading queued sends"
          />
        </div>
      )}

      {tab === "queued" && sendsState.status === "error" && (
        <p className="m-0 mt-6 text-[14px] font-medium text-red-700" role="alert">
          Couldn&rsquo;t load your queued sends. Please refresh.
        </p>
      )}

      {tab === "queued" &&
        sendsState.status === "ready" &&
        (sendsState.sends.length === 0 ? (
          <EmptyQueued />
        ) : (
          <QueuedList
            sends={sendsState.sends}
            total={sendsState.total}
            complete={sendsState.complete}
            canWrite={canWrite}
            onRemove={removeSends}
            refreshStats={refreshStats}
          />
        ))}

      {/* The filter/sort strip renders once the census is known (and stays
          put during filter refetches); an empty ledger needs no controls. */}
      {tab === "sent" &&
        sentKindCounts !== null &&
        (sentAllTotal ?? 0) > 0 && (
          <SentControls
            kindCounts={sentKindCounts}
            query={sentQuery}
            onChange={changeSentQuery}
          />
        )}

      {tab === "sent" && sentState.status === "loading" && (
        <div className="flex items-center justify-center py-16">
          <span
            className="size-6 animate-spin rounded-full border-2 border-line border-t-tide"
            role="status"
            aria-label="Loading sent ledger"
          />
        </div>
      )}

      {tab === "sent" && sentState.status === "error" && (
        <p className="m-0 mt-6 text-[14px] font-medium text-red-700" role="alert">
          Couldn&rsquo;t load your sent history. Please refresh.
        </p>
      )}

      {tab === "sent" &&
        sentState.status === "ready" &&
        (sentState.sends.length === 0 ? (
          <p className="m-0 mt-8 text-[14px] text-ink-soft">
            {sentQuery.kind !== null
              ? "No delivered sends of this type."
              : "Nothing delivered yet. Approved sends land here once the dispatcher delivers them."}
          </p>
        ) : (
          <SentLedger sends={sentState.sends} total={sentState.total} />
        ))}
    </>
  );
}

/* ---------- the delivered ledger (Sent tab) ---------- */

/* The ledger's filter/sort strip: the queued tab's kind chips (narrowing is
   server-side — the ledger pages) plus a newest/oldest sort. Chip counts are
   the whole ledger's per-kind census, so they hold steady under an active
   filter; tapping the active chip clears it. */
function SentControls({
  kindCounts,
  query,
  onChange,
}: {
  kindCounts: Record<string, number>;
  query: SentQuery;
  onChange: (query: SentQuery) => void;
}) {
  const chips = sendKindChips(kindCounts);
  const total = chips.reduce((sum, chip) => sum + chip.count, 0);
  return (
    <div
      role="group"
      aria-label="Filter by type"
      className="mx-0.5 mt-[18px] flex flex-wrap items-center gap-2"
    >
      <FilterChip
        label="all"
        count={total}
        active={query.kind === null}
        onClick={() => onChange({ ...query, kind: null })}
      />
      {chips.map(({ kind, count }) => (
        <FilterChip
          key={kind}
          label={sendKindLabel(kind)}
          count={count}
          active={query.kind === kind}
          onClick={() =>
            onChange({ ...query, kind: query.kind === kind ? null : kind })
          }
        />
      ))}
      <label className="ml-auto inline-flex items-center gap-2 text-[12.5px] text-ink-soft">
        sort
        <select
          value={query.order}
          onChange={(e) =>
            onChange({ ...query, order: e.target.value as SentOrder })
          }
          className="rounded-lg border border-line bg-surface px-2 py-1 text-[12.5px] text-ink"
        >
          <option value="newest">newest first</option>
          <option value="oldest">oldest first</option>
        </select>
      </label>
    </div>
  );
}

/* The ledger's chip: the kind of send, and under it what the recipient did
   with the demo. One class for both so the row reads as one family. */
const LEDGER_CHIP =
  "rounded-full border border-line px-2 py-0.5 text-[11px] font-medium text-ink-soft";

/* Every delivered send, newest first: who it went to, through what channel,
   and the exact frozen copy that went out — the after-the-fact answer to
   "what did we actually say to these people". */
function SentLedger({ sends, total }: { sends: SendRow[]; total: number }) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      {total > sends.length && (
        <p className="m-0 text-[12.5px] text-ink-faint">
          Showing the latest {sends.length} of {total} delivered sends.
        </p>
      )}
      {sends.map((send) => {
        const engagement = engagementChips(send);
        return (
          <details
            key={send.id}
            className="rounded-xl border border-line bg-surface px-4 py-3 shadow-win"
          >
            <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[13.5px] font-semibold text-ink">
                {send.lead?.name ?? "(removed lead)"}
              </span>
              {send.lead?.company && (
                <span className="text-[12.5px] text-ink-soft">
                  {send.lead.company}
                </span>
              )}
              <span className={LEDGER_CHIP}>{sendKindLabel(send.kind)}</span>
              {send.subject && (
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">
                  {send.subject}
                </span>
              )}
              <span className="ml-auto font-mono text-[11px] text-ink-faint tabular-nums">
                {send.sent_at ? statsTime(send.sent_at) : "sent"}
              </span>
              {/* Under the subject: what the recipient did with the demo.
                  Untracked sends carry no chips at all. */}
              {engagement.length > 0 && (
                <span className="flex w-full flex-wrap items-center gap-1.5">
                  {engagement.map((chip) => (
                    <span key={chip} className={LEDGER_CHIP}>
                      {chip}
                    </span>
                  ))}
                </span>
              )}
            </summary>
            {/* Emails render through the recipient-facing preview (the queued
                tab's renderer) — the ledger shows what the recipient saw, not
                the raw transport text with its image markers. */}
            {send.kind === "email" ? (
              <div className="mt-3 border-t border-line pt-3">
                <EmailPreview subject={send.subject} body={send.note} />
              </div>
            ) : (
              <pre className="mt-3 whitespace-pre-wrap border-t border-line pt-3 font-sans text-[13px] leading-relaxed text-ink">
                {send.note}
              </pre>
            )}
          </details>
        );
      })}
    </div>
  );
}

/* "Aug 23, 4:12 PM" — absolute, because a ledger is a record, not a feed. */
function statsTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "sent";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ---------- tab control ---------- */

/* Quiet segmented control: sand track, the active segment is the white
   card (surface + small window shadow), pills throughout — no black. */
function TabButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number | null; // null while that list is still loading
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 cursor-pointer rounded-full px-4 py-1.5 text-[13.5px] tabular-nums transition-colors ${
        active
          ? "bg-surface font-semibold text-ink shadow-win-sm"
          : "font-medium text-ink-soft hover:text-ink"
      }`}
    >
      {count === null ? label : `${label} (${count})`}
    </button>
  );
}

/* ---------- kind-filter chip ---------- */

/* Mono-uppercase like the per-card kind badge so the chip visually names the
   badge it filters on; active = tide-wash fill (design-language tinted chip).
   min-h-9 keeps it tappable on the phone-first layout. */
function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
        active
          ? "border-tide/40 bg-tide-wash text-tide"
          : "border-line bg-paper text-ink-soft hover:border-ink-faint/50 hover:text-ink"
      }`}
    >
      {label}
      <span
        className={`tabular-nums ${active ? "text-tide/70" : "text-ink-faint"}`}
      >
        {count}
      </span>
    </button>
  );
}

/* ---------- queue-state strip (per-kind send runway) ---------- */

const STATS_KIND_LABEL: Record<string, string> = {
  message: "messages",
  connection_request: "connection requests",
  email: "emails",
};

const STATS_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/* "2026-07-20" -> "Jul 20" without a Date round-trip (a bare date string
   parses as UTC midnight and can render a day early in local time). */
function statsDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return m >= 1 && m <= 12 && d ? `${STATS_MONTHS[m - 1]} ${d}` : iso;
}

/* "connection requests: 34 queued · 12/20 sent in last 24h · runs through
   ~Jul 20 · 2 failed" — one line per send kind; kinds with nothing queued,
   nothing sent, and nothing failed are noise, not news, so they're skipped
   (nothing at all renders when all are quiet). The workspace send schedule
   spans the strip above them ("Sends Monday to Friday, … · Change") and is
   omitted, not placeholdered, until it loads. */
function QueueStatsStrip({ stats, schedule }: { stats: QueueStats[]; schedule: SendSchedule | null }) {
  const live = stats.filter(
    (s) => s.queued > 0 || s.sent_24h > 0 || (s.failed ?? 0) > 0,
  );
  if (live.length === 0 && !schedule) return null;
  return (
    <div className="review-runway">
      {schedule && (
        <p className="runway-schedule m-0 font-mono text-[11.5px] leading-[1.6] text-ink-soft tabular-nums">
          {scheduleSentence(schedule)} &middot; <a href={withMockMode("/dashboard/settings")}>Change</a>
        </p>
      )}
      {live.map((s) => (
        <p
          key={s.kind}
          className="m-0 font-mono text-[11.5px] leading-[1.6] text-ink-soft tabular-nums"
        >
          <span className="text-ink">{STATS_KIND_LABEL[s.kind] ?? s.kind}:</span>{" "}
          {s.queued} queued &middot; {s.sent_24h}/{s.cap} sent in last 24h
          {s.runs_through !== null && (
            <> &middot; runs through ~{statsDate(s.runs_through)}</>
          )}
          {(s.failed ?? 0) > 0 && (
            <>
              {" "}
              &middot; <span className="text-red-700">{s.failed} failed</span>
            </>
          )}
        </p>
      ))}
    </div>
  );
}

/* ---------- partial-load affordance ---------- */

/* Quiet line under the count/stats strip while later pages stream in — the
   first page is already interactive; this only explains the growing list
   and the parked bulk buttons. Same spinner idiom as the full-page loader,
   scaled down. */
function LoadingMoreLine({ children }: { children: ReactNode }) {
  return (
    <p
      role="status"
      className="mx-0.5 mb-0 mt-3 flex items-center gap-2 font-mono text-[11px] tracking-[0.06em] text-ink-faint"
    >
      <span
        aria-hidden="true"
        className="size-3 shrink-0 animate-spin rounded-full border-2 border-line border-t-tide"
      />
      {children}
    </p>
  );
}

/* ---------- the queued tab (GET /api/v1/dashboard/sends) ---------- */

/* Cancel and dismiss failures share one channel — same render spot, same
   semantics (`sendId` = the row that was tapped, null = bulk). */
type ActionError = { message: string; sendId: string | null };

function QueuedList({
  sends,
  total,
  complete,
  canWrite,
  onRemove,
  refreshStats,
}: {
  sends: SendRow[];
  /* Server total from the first page — the loaded-of-total denominator. */
  total: number;
  /* False while later pages load (or after one failed): bulk cancel /
     dismiss stay parked so "all" never means "the subset that had loaded".
     Per-row and selected-row actions stay live throughout. */
  complete: boolean;
  canWrite: boolean;
  onRemove: (ids: ReadonlySet<string>) => void;
  refreshStats: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(EMPTY_SET);
  const [actionError, setActionError] = useState<ActionError | null>(null);
  /* Which bulk button is armed — only one at a time, so arming Cancel all
     disarms an armed Dismiss all (and vice versa). */
  const [confirmAll, setConfirmAll] = useState<"cancel" | "dismiss" | null>(
    null,
  );
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(EMPTY_SET);
  const toast = useToast();

  /* Same disarm-after-a-beat as the armed Approve all. */
  useEffect(() => {
    if (!confirmAll) return;
    const t = window.setTimeout(() => setConfirmAll(null), 5000);
    return () => window.clearTimeout(t);
  }, [confirmAll]);

  /* One cancel POST per user action, mirroring decide. On success every
     posted id leaves the list — skipped ids already went out the door, so
     they're not queued either way — and the toast says which was which. On
     failure nothing is removed; the error renders red where the tap
     happened (`source` = send id, null = bulk). */
  const cancel = useCallback(
    async (ids: string[], source: string | null) => {
      if (ids.length === 0) return;
      setBusyIds(new Set(ids));
      setActionError(null);
      try {
        const res = await fetch("/api/v1/dashboard/sends/cancel", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ send_ids: ids }),
        });
        if (!res.ok)
          throw new Error(await readErrorDetail(res, CANCEL_FALLBACK));
        const result = (await res.json()) as CancelResult;
        const done = new Set(ids);
        onRemove(done);
        setSelected((prev) => new Set([...prev].filter((id) => !done.has(id))));
        toast(summarizeCancel(result), "success");
        void refreshStats();
      } catch (err) {
        setActionError({
          message:
            err instanceof Error && err.message ? err.message : CANCEL_FALLBACK,
          sendId: source,
        });
      } finally {
        setBusyIds(EMPTY_SET);
      }
    },
    [onRemove, refreshStats, toast],
  );

  /* Dismiss mirrors cancel, with one difference in the reconciliation:
     a skipped id here means the row WASN'T dismissed (it wasn't failed),
     so unlike cancel's already-sent skips it stays in the list. Dismissed
     rows also vanish server-side (GET /sends excludes them), so the
     optimistic removal and the next full load agree. */
  const dismiss = useCallback(
    async (ids: string[], source: string | null) => {
      if (ids.length === 0) return;
      setBusyIds(new Set(ids));
      setActionError(null);
      try {
        const res = await fetch("/api/v1/dashboard/sends/dismiss", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ send_ids: ids }),
        });
        if (!res.ok)
          throw new Error(await readErrorDetail(res, DISMISS_FALLBACK));
        const result = (await res.json()) as DismissResult;
        const skipped = new Set(result.skipped);
        onRemove(new Set(ids.filter((id) => !skipped.has(id))));
        // No selection cleanup: failed rows are never selectable.
        toast(summarizeDismiss(result), "success");
        void refreshStats();
      } catch (err) {
        setActionError({
          message:
            err instanceof Error && err.message
              ? err.message
              : DISMISS_FALLBACK,
          sendId: source,
        });
      } finally {
        setBusyIds(EMPTY_SET);
      }
    },
    [onRemove, refreshStats, toast],
  );

  /* Same chip semantics as the review tab: everything below the chips
     operates on the FILTERED list; an emptied-out filter falls back to
     "all" by derivation. */
  const kindCounts = new Map<string, number>();
  for (const send of sends)
    kindCounts.set(send.kind, (kindCounts.get(send.kind) ?? 0) + 1);
  const chipKinds = [...kindCounts.keys()].sort(
    (a, b) => sendKindRank(a) - sendKindRank(b),
  );
  const activeKind =
    kindFilter !== null && kindCounts.has(kindFilter) ? kindFilter : null;
  const visible =
    activeKind === null ? sends : sends.filter((s) => s.kind === activeKind);
  /* Failed rows have nothing left to cancel. Sending rows can still be
     posted — the API reports the ones that beat us as skipped. */
  const cancelable = visible.filter((s) => s.status !== "failed");
  /* Failed rows get dismissed instead; the bulk button only earns its spot
     when there's more than one of them under the current filter. */
  const failedVisible = visible.filter((s) => s.status === "failed");

  const busy = busyIds.size > 0;
  const allSelected =
    cancelable.length > 0 && selected.size === cancelable.length;

  function switchFilter(kind: string | null) {
    setKindFilter(kind);
    setSelected(EMPTY_SET);
    setConfirmAll(null);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleCancelSelected() {
    // Preserve queue order in the POST — due first, like the list.
    void cancel(
      cancelable.filter((s) => selected.has(s.id)).map((s) => s.id),
      null,
    );
  }

  /* First tap arms ("Cancel all N? Confirm"); the second posts every
     visible cancelable send as one call. */
  function handleCancelAll() {
    if (!complete) return; // parked while the rest of the sends load
    if (confirmAll !== "cancel") {
      setConfirmAll("cancel");
      return;
    }
    setConfirmAll(null);
    void cancel(
      cancelable.map((s) => s.id),
      null,
    );
  }

  /* Same arm-then-confirm for clearing every visible failed row. */
  function handleDismissAllFailed() {
    if (!complete) return; // parked while the rest of the sends load
    if (confirmAll !== "dismiss") {
      setConfirmAll("dismiss");
      return;
    }
    setConfirmAll(null);
    void dismiss(
      failedVisible.map((s) => s.id),
      null,
    );
  }

  return (
    <>
      <div
        role="group"
        aria-label="Filter by type"
        className="mx-0.5 mt-[18px] flex flex-wrap items-center gap-2"
      >
        <FilterChip
          label="all"
          count={sends.length}
          active={activeKind === null}
          onClick={() => switchFilter(null)}
        />
        {chipKinds.map((kind) => (
          <FilterChip
            key={kind}
            label={sendKindLabel(kind)}
            count={kindCounts.get(kind) ?? 0}
            active={activeKind === kind}
            onClick={() => switchFilter(activeKind === kind ? null : kind)}
          />
        ))}
      </div>

      {/* read-only members keep the count line; the selection + cancel /
          dismiss affordances only exist for writers */}
      <div className="mx-0.5 mb-2.5 mt-[14px] flex flex-wrap items-center gap-2.5">
        {canWrite && (
          <>
            <label className="inline-flex cursor-pointer items-center gap-[9px] text-[13.5px] font-medium text-ink-soft">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? new Set(cancelable.map((s) => s.id))
                      : EMPTY_SET,
                  )
                }
                aria-label="Select all queued sends"
                className="size-5 shrink-0 accent-tide"
              />
              Select all
            </label>
            {selected.size > 0 && (
              <button
                type="button"
                onClick={handleCancelSelected}
                disabled={busy}
                className="min-h-9 cursor-pointer rounded-[10px] bg-tide px-3.5 py-2 text-[13px] font-semibold text-white shadow-[0_3px_12px_-5px_rgba(22,24,29,0.45)] transition-colors hover:bg-tide-deep disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel selected ({selected.size})
              </button>
            )}
            <button
              type="button"
              onClick={handleCancelAll}
              disabled={busy || cancelable.length === 0 || !complete}
              title={
                complete ? undefined : "Available once every queued send loads"
              }
              className={`min-h-9 cursor-pointer rounded-[10px] px-3.5 py-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                confirmAll === "cancel"
                  ? "bg-tide font-semibold text-white shadow-[0_3px_12px_-5px_rgba(22,24,29,0.45)] hover:bg-tide-deep"
                  : "border border-line bg-surface font-medium text-ink-soft hover:border-ink-faint hover:text-ink"
              }`}
            >
              {confirmAll === "cancel"
                ? `Cancel all ${cancelable.length}? Confirm`
                : "Cancel all queued"}
            </button>
            {failedVisible.length > 1 && (
              <button
                type="button"
                onClick={handleDismissAllFailed}
                disabled={busy || !complete}
                title={
                  complete
                    ? undefined
                    : "Available once every queued send loads"
                }
                className={`min-h-9 cursor-pointer rounded-[10px] px-3.5 py-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                  confirmAll === "dismiss"
                    ? "bg-tide font-semibold text-white shadow-[0_3px_12px_-5px_rgba(22,24,29,0.45)] hover:bg-tide-deep"
                    : "border border-line bg-surface font-medium text-ink-soft hover:border-ink-faint hover:text-ink"
                }`}
              >
                {confirmAll === "dismiss"
                  ? `Dismiss all ${failedVisible.length} failed? Confirm`
                  : `Dismiss all failed (${failedVisible.length})`}
              </button>
            )}
          </>
        )}
        <span className="ml-auto shrink-0 font-mono text-[11px] tracking-[0.06em] text-ink-faint tabular-nums">
          {activeKind === null
            ? complete
              ? `${sends.length} queued`
              : `${sends.length.toLocaleString()} of ${total.toLocaleString()} queued`
            : `${visible.length} of ${sends.length}`}
        </span>
      </div>

      {actionError && actionError.sendId === null && (
        <p
          className="m-0 mb-2.5 text-[13.5px] font-medium text-red-700"
          role="alert"
        >
          {actionError.message}
        </p>
      )}

      <div className="review-queued-grid">
        {visible.map((send) => (
          <QueuedRow
            key={send.id}
            send={send}
            canWrite={canWrite}
            checked={selected.has(send.id)}
            busy={busyIds.has(send.id)}
            expanded={expanded.has(send.id)}
            error={actionError?.sendId === send.id ? actionError.message : null}
            onToggleSelect={() => toggleSelect(send.id)}
            onToggleExpand={() => toggleExpand(send.id)}
            onCancel={() => void cancel([send.id], send.id)}
            onDismiss={() => void dismiss([send.id], send.id)}
          />
        ))}
      </div>
    </>
  );
}

/* ---------- one queued send ---------- */

/* The review card's vocabulary, but lighter — this is a list entry, not a
   decision card: smaller shadow, tighter padding, no action pair. */
function QueuedRow({
  send,
  canWrite,
  checked,
  busy,
  expanded,
  error,
  onToggleSelect,
  onToggleExpand,
  onCancel,
  onDismiss,
}: {
  send: SendRow;
  canWrite: boolean;
  checked: boolean;
  busy: boolean;
  expanded: boolean;
  error: string | null;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  const failed = send.status === "failed";
  const isEmail = send.kind === "email";
  return (
    <article className="review-queued-row">
      <div className="flex items-center gap-2">
        {/* selection only feeds the bulk cancel, so it hides with it */}
        {canWrite && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggleSelect}
            disabled={busy || failed}
            aria-label={`Select send to ${send.lead?.name ?? "lead"}`}
            className="size-5 shrink-0 accent-tide disabled:cursor-not-allowed"
          />
        )}
        <span className="rounded-full border border-line bg-paper px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">
          {sendKindLabel(send.kind)}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-faint tabular-nums">
          {shortAge(send.created_at)}
        </span>
      </div>

      {send.lead && <LeadLine lead={send.lead} />}

      {/* the frozen copy — the review card's mono block, clamped to three
          lines; tapping the block toggles it open (list rows stay short) */}
      {isEmail && expanded ? (
        <div className={send.lead ? "" : "mt-3"}>
          <EmailPreview subject={send.subject} body={send.note} />
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded="true"
            className="email-preview-toggle"
          >
            Collapse email
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse note" : isEmail ? "Preview email" : "Expand note"}
          className={`block w-full cursor-pointer rounded-[10px] border border-line bg-paper px-3.5 py-[13px] text-left ${
            send.lead ? "" : "mt-3"
          }`}
        >
          {/* emails lead with their subject line, above the clamped summary */}
          {send.subject && (
            <span className="mb-1 block font-mono text-[12.75px] font-semibold leading-[1.65] text-ink">
              Subject: {send.subject}
            </span>
          )}
          {/* line-clamp sets its own display (-webkit-box), so `block` only
              applies to the expanded state — stacking both breaks the clamp */}
          <span
            className={`whitespace-pre-wrap break-words font-mono text-[12.75px] leading-[1.65] text-ink ${
              expanded ? "block" : "line-clamp-3"
            }`}
          >
            {isEmail ? emailBodySummary(send.note) : send.note}
          </span>
        </button>
      )}

      {send.attachment_slug && (
        <p className="m-0 mt-1.5 font-mono text-[10.5px] text-ink-faint">
          d/{send.attachment_slug} &middot; attached
        </p>
      )}

      <div className="mt-2.5 flex min-h-6 items-center gap-2.5">
        <SendStatus send={send} />
        {canWrite && send.status === "pending" && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="ml-auto cursor-pointer px-1 py-1.5 text-[13px] font-medium text-ink-faint transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
        )}
        {/* failed rows swap Cancel for Dismiss — same quiet weight; the
            send already didn't happen, this just clears the wreckage */}
        {canWrite && failed && (
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="ml-auto cursor-pointer px-1 py-1.5 text-[13px] font-medium text-ink-faint transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-60"
          >
            Dismiss
          </button>
        )}
      </div>

      {failed && send.error && (
        <p className="m-0 mt-1 text-[12.5px] leading-[1.55] text-red-700">
          {send.error}
        </p>
      )}

      {error && (
        <p
          className="m-0 mt-2 text-[13px] font-medium text-red-700"
          role="alert"
        >
          {error}
        </p>
      )}
    </article>
  );
}

/* pending → "sends ~Jul 22" (the strip's date form; "queued" when the
   dispatcher hasn't projected a day); sending → live green; failed → red
   with the failure class ("failed · already connected"), the full error
   rendered under the row. */
function SendStatus({ send }: { send: SendRow }) {
  if (send.status === "sending")
    return (
      <span className="font-mono text-[11.5px] tracking-[0.02em] text-ok">
        sending now
      </span>
    );
  if (send.status === "failed") {
    const cls = send.error_class
      ? (ERROR_CLASS_LABEL[send.error_class] ?? send.error_class)
      : null;
    return (
      <span className="font-mono text-[11.5px] font-medium tracking-[0.02em] text-red-700">
        failed
        {cls && <> &middot; {cls}</>}
      </span>
    );
  }
  return (
    <span className="font-mono text-[11.5px] tracking-[0.02em] text-ink-soft tabular-nums">
      {send.projected_date
        ? `sends ~${statsDate(send.projected_date)}`
        : "queued"}
    </span>
  );
}

/* ---------- one review item ---------- */

function ReviewListRow({
  item,
  active,
  canWrite,
  checked,
  busy,
  onOpen,
  onToggleSelect,
}: {
  item: ReviewItemRow;
  active: boolean;
  canWrite: boolean;
  checked: boolean;
  busy: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
}) {
  const context = item.lead
    ? [item.lead.name, item.lead.title, item.lead.company].filter(Boolean).join(" · ")
    : item.body;
  return (
    <article className={`review-list-row ${active ? "is-active" : ""}`} role="listitem">
      {canWrite && (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggleSelect}
          disabled={busy}
          aria-label={`Select: ${item.title}`}
          className="review-list-check"
        />
      )}
      <button type="button" onClick={onOpen} className="review-list-open" aria-current={active ? "true" : undefined}>
        <span className="review-list-topline">
          <span className="review-list-kind">{kindLabel(item.kind)}</span>
          <span>{shortAge(item.created_at)}</span>
        </span>
        <strong>{item.title}</strong>
        <span className="review-list-context">{context}</span>
      </button>
    </article>
  );
}

function ItemCard({
  item,
  canWrite,
  busy,
  denyReason,
  error,
  onApprove,
  onToggleDeny,
  onReasonChange,
  onCancelDeny,
  onConfirmDeny,
}: {
  item: ReviewItemRow;
  canWrite: boolean;
  busy: boolean;
  /** null = deny box closed; string = the in-progress reason text. */
  denyReason: string | null;
  error: string | null;
  onApprove: () => void;
  onToggleDeny: () => void;
  onReasonChange: (reason: string) => void;
  onCancelDeny: () => void;
  onConfirmDeny: () => void;
}) {
  const isBug = item.kind === "bug_validation";
  const isSend =
    item.kind === "send_message" ||
    item.kind === "send_connection" ||
    item.kind === "send_email" ||
    item.kind === "send_x_dm";
  const denyOpen = denyReason !== null;
  // Bug items read Real / Not real, but map to the same approve/deny.
  const approveLabel = isBug ? "Real" : "Approve";
  const denyLabel = isBug ? "Not real" : "Deny";
  const evidence = isBug ? item.evidence : null;
  const videoSlug = item.attachment_slug || salvagedDemoSlug(item);

  return (
    <article className="review-decision-card">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-line bg-paper px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-soft">
          {kindLabel(item.kind)}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10.5px] text-ink-faint tabular-nums">
          {shortAge(item.created_at)}
        </span>
      </div>

      <h2 className="m-0 mt-3 text-[15.5px] font-semibold leading-[1.3] tracking-[-0.01em]">
        {item.title}
      </h2>

      {item.lead && <LeadLine lead={item.lead} />}

      {isBug ? (
        <>
          {/* claim → evidence → video, in that order (spec's hard ordering:
              the founder validates without hand-reproducing). */}
          <p className="m-0 mb-3 mt-[3px] text-[13.5px] leading-[1.55] text-ink">
            {item.body}
          </p>
          {evidence && <EvidenceBlock evidence={evidence} />}
        </>
      ) : item.kind === "send_email" ? (
        <EmailPreview subject={item.subject} body={item.body} />
      ) : (
        <>
          {/* the exact frozen payload — mono, primary ink, no truncation;
              emails lead with their subject line */}
          <pre className="m-0 mb-3.5 whitespace-pre-wrap break-words rounded-[10px] border border-line bg-paper px-3.5 py-[13px] font-mono text-[12.75px] leading-[1.65] text-ink">
            {item.subject && (
              <span className="mb-1.5 block font-semibold">
                Subject: {item.subject}
              </span>
            )}
            {item.body}
          </pre>
        </>
      )}

      {videoSlug && (
        <>
          <video
            controls
            playsInline
            preload="metadata"
            src={`/d/${videoSlug}`}
            className="mb-1.5 aspect-video w-full rounded-xl bg-[#101820]"
          />
          <p className="m-0 mb-3.5 font-mono text-[10.5px] text-ink-faint">
            d/{videoSlug}
            {isSend && " · attached to this message"}
          </p>
        </>
      )}

      {/* read-only members get the full card minus the decision pair */}
      {canWrite && (
        <>
          <div className="flex gap-2.5 min-[700px]:justify-end">
            <button
              type="button"
              onClick={onApprove}
              disabled={busy}
              className="min-h-11 flex-[1.4] cursor-pointer rounded-xl bg-tide px-[18px] py-2.5 text-[14px] font-semibold text-white shadow-[0_3px_12px_-5px_rgba(22,24,29,0.45)] transition-colors hover:bg-tide-deep disabled:cursor-not-allowed disabled:opacity-60 min-[700px]:min-w-[130px] min-[700px]:flex-none"
            >
              {approveLabel}
            </button>
            <button
              type="button"
              onClick={onToggleDeny}
              disabled={busy}
              aria-expanded={denyOpen}
              className={`min-h-11 flex-1 cursor-pointer rounded-xl border bg-surface px-4 py-2.5 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 min-[700px]:min-w-[130px] min-[700px]:flex-none ${
                denyOpen
                  ? "border-ink-faint text-ink"
                  : "border-line text-ink-soft hover:border-ink-faint hover:text-ink"
              }`}
            >
              {denyLabel}
            </button>
          </div>

          {denyOpen && (
            <div className="mt-3 border-t border-dashed border-line pt-3">
              <input
                type="text"
                value={denyReason}
                onChange={(e) => onReasonChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onConfirmDeny();
                }}
                placeholder="what should change?"
                aria-label="Deny reason"
                autoFocus
                className="min-h-11 w-full rounded-[10px] border border-line bg-paper px-3 py-[11px] text-[14px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-tide"
              />
              <p className="m-0 mb-2.5 mt-1.5 text-[12px] leading-[1.5] text-ink-faint">
                Optional &mdash; goes to your AE as feedback; the revised copy
                comes back here for review.
              </p>
              <div className="flex items-center gap-3 min-[700px]:justify-end">
                <button
                  type="button"
                  onClick={onCancelDeny}
                  className="cursor-pointer px-1 py-2 text-[13.5px] font-medium text-ink-faint transition-colors hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirmDeny}
                  disabled={busy}
                  className="min-h-10 cursor-pointer rounded-[10px] bg-tide px-[18px] py-2 text-[13.5px] font-semibold text-white transition-colors hover:bg-tide-deep disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {denyLabel}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {error && (
        <p className="m-0 mt-3 text-[13px] font-medium text-red-700" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

/* "Maya Reston · VP Engineering, Loomi · [new] · no prior sends"; the name
   links out to the lead's LinkedIn profile when we have one (tide + hover
   underline, the Leads-table affordance) — no more hand-searching names. */
function LeadLine({ lead }: { lead: ReviewLeadContext }) {
  const role = [lead.title, lead.company].filter(Boolean).join(", ");
  const prior =
    lead.prior_sends === 0
      ? "no prior sends"
      : `${lead.prior_sends} prior ${lead.prior_sends === 1 ? "send" : "sends"}`;

  return (
    <p className="m-0 mb-3 mt-[3px] text-[13px] leading-[1.5] text-ink-soft">
      {lead.name &&
        (lead.linkedin_url ? (
          <a
            href={lead.linkedin_url}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-tide no-underline hover:underline"
          >
            {lead.name}
            <span aria-hidden="true" className="text-[11px]">
              {" "}
              ↗
            </span>
          </a>
        ) : (
          lead.name
        ))}
      {lead.name && role ? ` · ${role}` : role}
      {(lead.name || role) && <> &middot; </>}
      <span className={STAGE_PILL}>{lead.stage}</span> &middot; {prior}
    </p>
  );
}

/* bug_validation's structured evidence — always rendered ABOVE the video so
   the founder can judge the claim without hand-reproducing it. */
function EvidenceBlock({ evidence }: { evidence: BugEvidence }) {
  const steps = Array.isArray(evidence.repro_steps) ? evidence.repro_steps : [];
  const hasAny =
    steps.length > 0 ||
    Boolean(evidence.url) ||
    Boolean(evidence.device) ||
    Boolean(evidence.video_timestamp);
  if (!hasAny) return null;

  return (
    <>
      <span className={`${MICROLABEL} mb-1.5 block`}>Evidence</span>
      <div className="mb-3.5 grid gap-2.5 rounded-[10px] border border-line bg-paper px-3.5 py-[13px]">
        {steps.length > 0 && (
          <EvidenceRow label="Repro">
            <ol className="m-0 grid list-decimal gap-1 pl-[18px] text-[13px] leading-[1.55] text-ink tabular-nums">
              {steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </EvidenceRow>
        )}
        {evidence.url && (
          <EvidenceRow label="Target">
            <span className="break-all font-mono text-[12px] leading-[1.55]">
              <a
                href={
                  /^https?:\/\//i.test(evidence.url)
                    ? evidence.url
                    : `https://${evidence.url}`
                }
                target="_blank"
                rel="noreferrer"
                className="text-tide no-underline hover:underline"
              >
                {evidence.url}
              </a>
            </span>
          </EvidenceRow>
        )}
        {evidence.device && (
          <EvidenceRow label="Device">
            <span className="text-[13px] leading-[1.55] text-ink">
              {evidence.device}
            </span>
          </EvidenceRow>
        )}
        {evidence.video_timestamp && (
          <EvidenceRow label="In video">
            <span className="text-[13px] leading-[1.55] text-ink">
              {evidence.video_timestamp}
            </span>
          </EvidenceRow>
        )}
      </div>
    </>
  );
}

function EvidenceRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[64px_1fr] gap-2.5">
      <span className={`${MICROLABEL} pt-0.5`}>{label}</span>
      {children}
    </div>
  );
}

/* ---------- alt state: nothing pending ---------- */

function EmptyQueue() {
  return (
    <div className={`${CARD} mt-6 px-6 py-11 text-center`}>
      <svg
        width="60"
        height="17"
        viewBox="0 0 60 17"
        fill="none"
        aria-hidden="true"
        className="mx-auto block text-tide"
      >
        <path
          d="M2 5q7 -6 14 0t14 0t14 0t14 0"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity=".9"
        />
        <path
          d="M2 12q7 -6 14 0t14 0t14 0t14 0"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          opacity=".4"
        />
      </svg>
      <h2 className="m-0 mb-1.5 mt-3.5 text-[17px] font-semibold tracking-[-0.01em]">
        Queue is clear
      </h2>
      <p className="mx-auto my-0 max-w-[350px] text-[13px] leading-[1.55] text-ink-soft">
        Nothing needs a decision right now. When your AE submits new work, it
        lands here and you get a Slack ping with the link.
      </p>
    </div>
  );
}

/* ---------- alt state: nothing queued ---------- */

function EmptyQueued() {
  return (
    <div className={`${CARD} mt-6 px-6 py-11 text-center`}>
      <p className="mx-auto my-0 max-w-[350px] text-[13px] leading-[1.55] text-ink-soft">
        Nothing queued &mdash; approved sends land here until they go out.
      </p>
    </div>
  );
}
