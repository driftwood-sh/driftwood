import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { AdminPanelControls, ImpersonationBanner } from "./GodMode";
import {
  AccountApiError,
  disconnectAccount,
  getAccounts,
  type AccountsPage,
  type EmailState,
  type LinkedInState,
  type SendingAccount,
  type XState,
} from "./accounts/api";
import {
  accountLabel,
  channelConnected,
  connectedChannelCount,
  emailAddress,
  emailDailyCap,
  emailProviderName,
  emailRowState,
  emailSummary,
  emailSummaryLine,
  linkMinutesLeft,
  linkedBy,
  linkedByLine,
  newestOwnActive,
  ownAccount,
} from "./accounts/model";
import { listAssets } from "./assets/api";
import type { CompanyAsset } from "./assets/model";
import { listAudiences } from "./audiences/api";
import type { AudienceSummary } from "./audiences/model";
import { listCampaigns } from "./campaigns/api";
import type { CampaignSummary } from "./campaigns/model";
import AddInboxes from "./dashboard/AddInboxes";
import AppShell from "./dashboard/AppShell";
import HelmMark from "./components/HelmMark";
import {
  DOMAIN_CAP,
  INBOX_CAP,
  managedInboxCap,
  boughtInboxLine,
  useManagedInboxes,
  type MailboxesOverview,
  type ManagedMailbox,
  type PurchaseResult,
  type SenderInput,
} from "./dashboard/managed-inboxes";
import {
  AssetsIcon,
  AudienceIcon,
  CampaignIcon,
  PeopleIcon,
} from "./dashboard/icons";
import { withMockMode } from "./mock-mode";
import { GoogleMark, LoggedOutView, ToastProvider } from "./dashboard/DashboardCommon";
import {
  buildOverviewSnapshot,
  type OverviewSnapshot,
} from "./dashboard/overview-model";
import {
  CARD,
  prefetch,
  relativeTime,
  useToast,
} from "./dashboard-shared";
import { clearIdentity, loadIdentity } from "./identity";
import "./dashboard/overview.css";
import "./dashboard/managed-inboxes.css";
/* the Sending accounts lists reuse the Team page's member row */
import "./team/team.css";

/* /dashboard — Google-login-gated shell. Talks to the same-origin /auth/*
   endpoints (vite proxy in dev, vercel rewrite in prod), so every request
   must send the first-party session cookie.

   The dashboard remains the control surface for account connections and the
   entry point for browser-based campaign planning. */

type User = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  is_approved: boolean;
  linkedin_connected: boolean;
  /* optional so older /auth/me payloads (pre-email-channel) still parse;
     absent reads as not connected. */
  email_connected?: boolean;
  /* why the mailbox isn't usable even though OAuth finished (e.g. a Google
     account with no Gmail service behind it) — set server-side, shown on
     the email card. */
  email_error?: string | null;
  /* optional so older /auth/me payloads still parse; absent reads as
     never-attempted. */
  twitter_connected?: boolean;
  /* profile+proxy exist but login isn't confirmed yet — the card starts in
     its "waiting on you" state instead of "Connect X" on page load. */
  twitter_pending?: boolean;
  /* logged in, but the profile is sitting behind X's encrypted-chat PIN
     wall — the account is connected and DMs specifically can't go out
     until the user enters that PIN. Its own state, not a kind of pending. */
  twitter_chat_locked?: boolean;
  twitter_handle?: string | null;
  is_admin?: boolean;
  impersonating?: boolean;
  /* org workspace membership; absent/null (solo accounts) reads as owner.
     An owner and an admin get identical controls. A member is read-only. For
     admins/members the connection booleans above reflect the workspace
     owner's connections. */
  org?: { name: string; role: "owner" | "admin" | "member" } | null;
};

type AuthState =
  | { status: "loading" }
  | { status: "logged-out" }
  | { status: "logged-in"; user: User };

/* Every mount-time request fires at module eval, in parallel with /auth/me
   (see prefetch() in dashboard-shared): the summary, the activity feed, and
   the three inventory lists the campaign desk reads. Each is consumed
   exactly once by its loader's initial run; refreshes (e.g. after a CSV
   import) fetch fresh. For logged-out or pending visitors the responses go
   unconsumed — they're cookie-authed, so they carry nothing anyway. */
const initialSummary = prefetch(() =>
  fetch("/api/v1/dashboard/summary", { credentials: "include" }),
);
const initialActivity = prefetch(() =>
  fetch("/api/v1/dashboard/activity?limit=8", { credentials: "include" }),
);
const initialInventory = prefetch(() =>
  Promise.allSettled([listAudiences(), listCampaigns(), listAssets()]),
);
/* The pool of sending accounts behind the three cards. The cards paint
   from the /auth/me booleans first and fill in the rows when this lands. */
const initialAccounts = prefetch(() => getAccounts());

/* /auth/me starts at module eval too — cached identity paints the real
   shell immediately; the background result confirms it, swaps it in place,
   or flips to the logged-out view. */
const identityBoot =
  typeof window === "undefined" ? null : loadIdentity<User>();

function LinkedInMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.34V9h3.42v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.07 2.07 0 1 1 0-4.14 2.07 2.07 0 0 1 0 4.14zm1.78 13.02H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
    </svg>
  );
}

function XMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.24 2.25h3.31l-7.23 8.26L23 21.75h-6.66l-5.22-6.83-5.97 6.83H1.83l7.73-8.84L1 2.25h6.83l4.71 6.24 5.7-6.24Zm-1.16 17.52h1.84L7.02 4.13H5.04l12.04 15.64Z" />
    </svg>
  );
}

function MailMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
      <path d="m3.5 7.5 8.5 6 8.5-6" />
    </svg>
  );
}

function CheckMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/* padlock — the X card's "connected, but chats are still locked" state. */
function LockMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V7.4a4 4 0 0 1 8 0v3.1" />
    </svg>
  );
}

export default function Dashboard() {
  /* Any cached identity seeds the shell, pending screen included —
     /dashboard gates on login, not approval. */
  const [auth, setAuth] = useState<AuthState>(
    identityBoot?.cached
      ? { status: "logged-in", user: identityBoot.cached }
      : { status: "loading" },
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fresh = (await identityBoot?.fresh) ?? null;
      if (cancelled) return;
      // A 401 or network failure already cleared the identity cache.
      setAuth(
        fresh ? { status: "logged-in", user: fresh } : { status: "logged-out" },
      );
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogout() {
    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      clearIdentity();
      window.location.href = withMockMode("/dashboard");
    }
  }

  return (
    <ToastProvider>
      <div className="relative flex min-h-[100dvh] flex-col overflow-x-clip">
        {auth.status === "loading" && <LoadingView />}
        {auth.status === "logged-out" && <LoggedOutView />}
        {auth.status === "logged-in" && (
          <LoggedInView user={auth.user} onLogout={handleLogout} />
        )}
      </div>
    </ToastProvider>
  );
}

/* Pre-auth first paint with no cached identity: mirror the overview we're
   about to show (heading, shortcut chips, connection cards, panels) instead
   of a lone spinner on a blank page — ux-principles rules 1 + 2. The
   AppShell chrome itself still waits on identity. Local Tailwind-only copy
   per the Leads/Companies precedent — the shared skeleton utility is a
   later batch. */
function LoadingView() {
  return (
    <div
      role="status"
      aria-label="Loading dashboard"
      className="mx-auto w-full max-w-5xl flex-1 animate-pulse px-4 py-5 motion-reduce:animate-none sm:px-8 sm:py-8"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="h-10 w-48 rounded-md bg-sand" />
        <div className="flex gap-2">
          <div className="h-[30px] w-24 rounded-full bg-sand" />
          <div className="h-[30px] w-40 rounded-full bg-sand" />
        </div>
      </div>
      <div className="mt-9 h-4 w-40 rounded bg-sand" />
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((card) => (
          <div key={card} className={`${CARD} p-4`}>
            <div className="h-3.5 w-20 rounded bg-sand" />
            <div className="mt-2.5 h-3 w-3/4 rounded bg-sand" />
            <div className="mt-4 h-[30px] w-24 rounded-full bg-sand" />
          </div>
        ))}
      </div>
      <div className={`mt-6 ${CARD} p-5`}>
        <div className="h-3.5 w-36 rounded bg-line" />
        <div className="mt-4 h-3 w-2/3 max-w-[26rem] rounded bg-sand" />
        <div className="mt-2.5 h-3 w-1/2 max-w-[20rem] rounded bg-sand" />
      </div>
      <div className={`mt-6 ${CARD} p-5`}>
        <div className="h-3.5 w-28 rounded bg-line" />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((metric) => (
            <div key={metric}>
              <div className="h-3 w-16 rounded bg-sand" />
              <div className="mt-2 h-7 w-14 rounded bg-sand" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- logged-in shell ---------- */

function LoggedInView({ user, onLogout }: { user: User; onLogout: () => void }) {
  const displayName = user.name || user.email;
  // Shown next to the identity when the account belongs to a named workspace.
  const orgName = user.org?.name.trim() || null;
  const canWrite = (user.org?.role ?? "owner") !== "member";

  return (
    <>
      {user.impersonating && <ImpersonationBanner email={user.email} />}
      <AppShell
        active="home"
        identity={{ name: displayName, workspace: orgName, avatarUrl: user.avatar_url }}
        onLogout={onLogout}
        adminControl={user.is_admin ? <AdminPanelControls /> : undefined}
        canWrite={canWrite}
      >
        <div className="mx-auto w-full max-w-5xl py-5 sm:py-8">
          {user.is_approved ? <ApprovedView user={user} /> : <PendingView />}
        </div>
      </AppShell>
    </>
  );
}

function Heading({ children }: { children: string }) {
  return (
    <h1 className="m-0 text-[clamp(1.9rem,4.4vw,2.5rem)] font-semibold leading-[1.08] tracking-[-0.015em]">
      {children}
    </h1>
  );
}

/* ---------- pending (awaiting approval) ---------- */

function PendingView() {
  return (
    <div className="mx-auto max-w-xl">
      <Heading>You&rsquo;re on the list.</Heading>
      <div className={`mt-7 ${CARD} p-7 sm:p-8`}>
        <p className="m-0 text-[15.5px] leading-relaxed text-ink-soft">
          Your account is created and pending review. We&rsquo;ll email you the
          moment your workspace is ready — usually within a day.
        </p>
      </div>
    </div>
  );
}

/* ---------- approved (workspace live) ---------- */

/* ---------- dashboard summary (GET /api/v1/dashboard/summary) ---------- */

type Sending = {
  invites_sent: number;
  invites_cap: number;
  messages_sent: number;
  messages_cap: number;
  within_limits: boolean;
  last_action_at: string | null;
};
type EmailSending = {
  emails_sent: number;
  emails_cap: number;
  within_limits: boolean;
};
type Funnel = {
  active: number;
  contacted: number;
  replied: number;
  meetings: number;
};
type Results = {
  meetings: number;
  meetings_delta_7d: number;
  replies: number;
  replies_delta_7d: number;
  reply_rate: number;
};
type Lists = {
  leads: number;
  blacklist: number;
};
type Companies = {
  qualified: number;
  screened_out: number;
  unknown: number;
};
type DashboardSummary = {
  linkedin_connected: boolean;
  sending: Sending | null;
  email_sending?: EmailSending | null;
  funnel: Funnel;
  results: Results;
  lists: Lists;
  companies: Companies;
  pending_reviews: number;
  queued_sends?: number; // optional: tolerate a backend that predates it
};

type SummaryState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; summary: DashboardSummary };

/* ---------- recent activity (GET /api/v1/dashboard/activity) ---------- */

type ActivityEvent = {
  at: string;
  kind: "stage" | "sent" | "reply";
  lead_id: string | null;
  lead_name: string | null;
  company_name: string | null;
  detail: string | null;
};

type ActivityState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; events: ActivityEvent[] };

type InventoryState = {
  status: "loading" | "ready";
  audiences: AudienceSummary[] | null;
  campaigns: CampaignSummary[] | null;
  assets: CompanyAsset[] | null;
};

/* The pool of sending accounts behind ConnectionSetup. Loads alongside the
   summary and never gates the page: the cards paint from the /auth/me
   booleans until it lands, and keep that paint if it fails. */
type AccountsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; page: AccountsPage };

function ApprovedView({ user }: { user: User }) {
  // Solo accounts carry no org and stay full-control. An owner and an admin
  // get identical controls. A member sees every section and gets no write
  // control.
  const role = user.org?.role ?? "owner";
  const canWrite = role !== "member";
  // The managed pool feeds two surfaces: the email tile (count + add flow)
  // and the quiet capacity line on Today's sending — so it lives here.
  const { pool } = useManagedInboxes();
  const [summary, setSummary] = useState<SummaryState>({ status: "loading" });
  const [activity, setActivity] = useState<ActivityState>({ status: "loading" });
  const [inventory, setInventory] = useState<InventoryState>({
    status: "loading",
    audiences: null,
    campaigns: null,
    assets: null,
  });
  const [accounts, setAccounts] = useState<AccountsState>({ status: "loading" });
  const [importsOpen, setImportsOpen] = useState(false);
  const importsRef = useRef<HTMLDetailsElement>(null);

  const loadActivity = useCallback(async () => {
    try {
      // The mount run rides the module-eval prefetch; refreshes fetch fresh.
      const res = await (initialActivity.take() ??
        fetch("/api/v1/dashboard/activity?limit=8", {
          credentials: "include",
        }));
      if (!res.ok) throw new Error("request failed");
      const data = (await res.json()) as { events: ActivityEvent[] };
      setActivity({ status: "ready", events: data.events });
    } catch {
      // Keep whatever loaded before; MetricsCard hides the section on error.
      setActivity((prev) => (prev.status === "ready" ? prev : { status: "error" }));
    }
  }, []);

  // Reusable so a successful import can refresh the counts + funnel in place.
  // Kicks the activity feed too so "Latest" stays in step with the summary.
  const loadSummary = useCallback(async () => {
    void loadActivity();
    try {
      const res = await (initialSummary.take() ??
        fetch("/api/v1/dashboard/summary", {
          credentials: "include",
        }));
      if (!res.ok) throw new Error("request failed");
      const data = (await res.json()) as DashboardSummary;
      setSummary({ status: "ready", summary: data });
    } catch {
      // Don't blank out an already-loaded summary if a refresh fails.
      setSummary((prev) => (prev.status === "ready" ? prev : { status: "error" }));
    }
  }, [loadActivity]);

  useEffect(() => {
    void (async () => {
      await loadSummary();
    })();
  }, [loadSummary]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [audiences, campaigns, assets] = await (initialInventory.take() ??
        Promise.allSettled([listAudiences(), listCampaigns(), listAssets()]));
      if (cancelled) return;
      setInventory({
        status: "ready",
        audiences: audiences.status === "fulfilled" ? audiences.value : null,
        campaigns: campaigns.status === "fulfilled" ? campaigns.value : null,
        assets: assets.status === "fulfilled" ? assets.value : null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const page = await (initialAccounts.take() ?? getAccounts());
        if (!cancelled) setAccounts({ status: "ready", page });
      } catch {
        // Keep the /auth/me-driven paint; the cards say the list is unavailable.
        if (!cancelled) setAccounts((prev) => (prev.status === "ready" ? prev : { status: "error" }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // A disconnect answers with the page after the removal, which replaces
  // the lists in place.


  const snapshot = buildOverviewSnapshot(
    summary.status === "ready" ? summary.summary.pending_reviews : null,
    {
      audienceCount: inventory.audiences?.length ?? null,
      assetCount: inventory.assets?.length ?? null,
      campaigns: inventory.campaigns,
    },
  );

  /* the email channel's daily ceiling — own connected mailbox (20/day)
     plus what the managed pool carries today. Shown quietly where the
     dashboard already talks send volume; absent whenever there is no pool
     (or the fetch failed). "Own mailbox" reads the account pool once it
     lands, so a disconnect updates the line in place. */
  const emailConnected =
    accounts.status === "ready" ? channelConnected(accounts.page.email) : (user.email_connected ?? false);
  const emailCapLine = pool
    ? `Up to ${(emailConnected ? 20 : 0) + managedInboxCap(pool.mailboxes)} emails/day`
    : null;

  function openImports() {
    setImportsOpen(true);
    window.requestAnimationFrame(() => {
      importsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      importsRef.current?.querySelector("summary")?.focus();
    });
  }

  return (
    <div className="overview-page">
      <LinkedInBanner />
      <header className="overview-heading">
        <h1>Overview</h1>
        <div className="overview-heading-links" aria-label="Lead database shortcuts">
          <a href={withMockMode("/dashboard/leads")}>{formatCount(summary, "leads")} leads</a>
          <a href={withMockMode("/dashboard/companies")}>{formatCount(summary, "companies")} qualified companies</a>
        </div>
      </header>

      <div className="overview-heading-links"><a href={withMockMode("/dashboard/settings?tab=accounts")}>Manage sending accounts →</a><a href={withMockMode("/dashboard/metrics")}>Detailed performance →</a></div>
      <TodaysSending summary={summary} activity={activity} emailCapLine={emailCapLine} />
      <MetricsCard state={summary} />
      {canWrite && <QuickActions onImport={openImports} />}
      <CampaignDesk snapshot={snapshot} inventory={inventory} canWrite={canWrite} />

      <details
        className="overview-imports"
        open={importsOpen}
        ref={importsRef}
        onToggle={(event) => setImportsOpen(event.currentTarget.open)}
      >
        <summary>
          <strong>Imports and blacklist</strong>
          <span aria-hidden="true" className="overview-imports-toggle">+</span>
        </summary>
        <ListsCard state={summary} canWrite={canWrite} onImported={loadSummary} />
      </details>
    </div>
  );
}

function formatCount(state: SummaryState, key: "leads" | "companies") {
  if (state.status !== "ready") return "—";
  const value = key === "leads" ? state.summary.lists.leads : state.summary.companies.qualified;
  return value.toLocaleString();
}

/* Every role sees this section, including a member: the same pages for
   everyone, and only the write controls differ. Each card lists the
   workspace's pool for its channel — one row per linked account, each
   linked by its own person. `canWrite` (then the page's own can_connect)
   gates only the connect and add-inbox controls; a row's Disconnect
   follows that row's can_disconnect. Until the pool lands the cards paint
   from the /auth/me booleans, which now mean "the workspace has at least
   one active account for that channel". LinkedIn and X share one row as
   half-width cards; Email, which can hold many mailboxes, takes the full
   width below them (overview.css). */
function ConnectionSetup({
  user,
  canWrite,
  pool,
  applyPurchase,
  accounts,
  onAccounts,
}: {
  user: User;
  canWrite: boolean;
  pool: MailboxesOverview | null;
  applyPurchase: (result: PurchaseResult, senders: SenderInput[]) => void;
  accounts: AccountsState;
  onAccounts: (page: AccountsPage) => void;
}) {
  const page = accounts.status === "ready" ? accounts.page : null;
  const linkedInFallback = user.linkedin_connected;
  const emailFallback = user.email_connected ?? false;
  const xFallback = user.twitter_connected ?? false;
  const xLockedFallback = user.twitter_chat_locked ?? false;
  // "N of 3": channels with at least one usable row. A chat-locked X does
  // not count, as before.
  const connected = page
    ? connectedChannelCount(page)
    : [linkedInFallback, emailFallback, xFallback && !xLockedFallback].filter(Boolean).length;
  const remaining = 3 - connected;

  return (
    <section className="overview-connections" aria-labelledby="connections-title">
      <div className="overview-section-heading">
        <h2 id="connections-title">Sending accounts</h2>
        <span>{connected} of 3 connected{remaining > 0 ? ` · ${remaining} left` : ""}</span>
      </div>
      <div className="overview-connection-grid">
        <LinkedInCard
          connected={linkedInFallback}
          rows={page?.linkedin ?? []}
          accounts={accounts}
          canWrite={canWrite}
          onAccounts={onAccounts}
        />
        <TwitterCard
          connected={xFallback}
          chatLocked={xLockedFallback}
          rows={page?.x ?? []}
          accounts={accounts}
          canWrite={canWrite}
          onAccounts={onAccounts}
        />
        <EmailCard
          connected={emailFallback}
          rows={page?.email ?? []}
          accounts={accounts}
          emailError={user.email_error ?? null}
          companyName={user.org?.name ?? null}
          pool={pool}
          applyPurchase={applyPurchase}
          canWrite={canWrite}
          onAccounts={onAccounts}
        />
      </div>
    </section>
  );
}

function TodaysSending({
  summary,
  activity,
  emailCapLine,
}: {
  summary: SummaryState;
  activity: ActivityState;
  /** the email channel's daily ceiling (own mailbox + managed pool);
   *  null when there is no managed pool */
  emailCapLine: string | null;
}) {
  const sending = summary.status === "ready" ? summary.summary.sending : null;
  const emailSending = summary.status === "ready" ? summary.summary.email_sending ?? null : null;
  const pendingReviews = summary.status === "ready" ? summary.summary.pending_reviews : null;
  const queuedSends = summary.status === "ready" ? summary.summary.queued_sends ?? null : null;
  /* "On track" means approved outreach is actually queued and flowing — not
     merely "under cap". No queued sends but items waiting on the founder is
     an approval bottleneck; neither queued nor pending is an empty pipe. */
  const statusValue = summary.status === "loading"
    ? "—"
    : summary.status === "error"
      ? "Unavailable"
      : sending?.within_limits === false || emailSending?.within_limits === false
        ? "Near limit"
        : sending === null && emailSending === null
          ? "Setup needed"
          : queuedSends === null
            ? "On track"
            : queuedSends > 0
              ? "On track"
              : (pendingReviews ?? 0) > 0
                ? "Awaiting review"
                : "Nothing queued";
  const statusTone = statusValue === "On track" ? "success" : statusValue === "—" || statusValue === "Unavailable" ? undefined : "warning";
  const latestSends = activity.status === "ready"
    ? activity.events.filter((event) => event.kind === "sent").slice(0, 6)
    : [];

  return (
    <section className="overview-panel overview-sending" aria-labelledby="sending-title">
      <div className="overview-panel-heading">
        <h2 id="sending-title">Today&rsquo;s sending</h2>
        <a href={withMockMode("/dashboard/inbox")}>Open Inbox</a>
      </div>
      <div className="overview-sending-layout">
        <div className="overview-sending-stats">
          <SendingStat label="Email capacity remaining" value={summary.status !== "ready" ? "—" : emailSending ? Math.max(0, emailSending.emails_cap - emailSending.emails_sent).toLocaleString() : "Not connected"} />
          <SendingStat label="Outreach queued" value={queuedSends === null ? "—" : queuedSends.toLocaleString()} sub="Across all channels" />
          <SendingStat
            label="Emails sent today"
            value={summary.status !== "ready" ? "—" : emailSending ? emailSending.emails_sent.toLocaleString() : "Not connected"}
            sub={emailCapLine}
          />
          <SendingStat
            label="Awaiting approval"
            value={pendingReviews === null ? "—" : pendingReviews.toLocaleString()}
          />
          <SendingStat
            label="Status"
            value={statusValue}
            tone={statusTone}
          />
        </div>
        <div className="overview-latest-sends">
          <h3>
            Latest sends
            <a
              className="overview-latest-sends-all"
              href={withMockMode("/dashboard/inbox?tab=sent")}
            >
              View all
            </a>
          </h3>
          {activity.status === "loading" && (
            <div role="status" aria-label="Loading latest sends">
              {["78%", "62%", "70%"].map((width) => (
                <div key={width} className="overview-skeleton-line" aria-hidden="true">
                  <span className="overview-skeleton" style={{ width, height: "0.7rem" }} />
                  <span className="overview-skeleton" style={{ width: "2.2rem", height: "0.6rem" }} />
                </div>
              ))}
            </div>
          )}
          {activity.status === "error" && <p className="overview-empty" role="alert">Unavailable right now.</p>}
          {activity.status === "ready" && latestSends.length === 0 && <p className="overview-empty">Nothing sent yet today.</p>}
          {latestSends.map((event, index) => (
            <ActivityLine key={`${event.at}-${index}`} event={event} />
          ))}
        </div>
      </div>
    </section>
  );
}

function SendingStat({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning";
  /** quiet context line under the figure (e.g. the email channel's daily
   *  ceiling when a managed pool exists) */
  sub?: string | null;
}) {
  return (
    <div className="overview-sending-stat">
      <span>{label}</span>
      <div>
        <strong className={tone ? `is-${tone}` : value === "Not connected" ? "is-muted" : undefined}>{value}</strong>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  );
}

function QuickActions({ onImport }: { onImport: () => void }) {
  return (
    <section className="overview-panel overview-add" aria-labelledby="add-title">
      <div className="overview-panel-heading">
        <h2 id="add-title">Add more</h2>
      </div>
      <div className="overview-action-grid">
        <a href={withMockMode("/dashboard/audiences")}><AudienceIcon size={18} /><span>Find leads</span></a>
        <a href={withMockMode("/dashboard/campaigns/new")}><CampaignIcon size={18} /><span>New campaign</span></a>
        <a href={withMockMode("/dashboard/assets")}><AssetsIcon size={18} /><span>Add assets</span></a>
        <button type="button" onClick={onImport}><PeopleIcon size={18} /><span>Import CSV</span></button>
      </div>
    </section>
  );
}

function CampaignDesk({
  snapshot,
  inventory,
  canWrite,
}: {
  snapshot: OverviewSnapshot;
  inventory: InventoryState;
  canWrite: boolean;
}) {
  return (
    <section className="overview-panel overview-campaign-desk" aria-labelledby="campaign-desk-title">
      <div className="overview-panel-heading">
        <h2 id="campaign-desk-title">Campaigns</h2>
        <a href={withMockMode("/dashboard/campaigns")}>View all</a>
      </div>
      {inventory.status === "loading" ? (
        <div className="overview-campaign-list" role="status" aria-label="Loading campaigns">
          {[0, 1, 2].map((row) => (
            <div key={row} className="overview-campaign-skeleton-row" aria-hidden="true">
              <span className="overview-skeleton" style={{ width: "3.2rem", height: "0.7rem" }} />
              <span className="overview-skeleton" style={{ width: `${46 - row * 8}%`, height: "0.75rem" }} />
              <span className="overview-skeleton overview-skeleton-meta" style={{ width: "5.4rem", height: "0.65rem" }} />
              <span className="overview-skeleton" style={{ width: "2.6rem", height: "0.65rem" }} />
            </div>
          ))}
        </div>
      ) : inventory.campaigns === null ? (
        <p className="overview-empty" role="alert">Campaigns are temporarily unavailable.</p>
      ) : snapshot.recentCampaigns.length === 0 ? (
        <p className="overview-empty">
          {canWrite ? (
            <>
              No campaigns yet.{" "}
              <a href={withMockMode("/dashboard/campaigns/new")}>Create your first campaign</a>{" "}
              to start sending.
            </>
          ) : (
            <>No campaigns yet. An owner or admin can create the first campaign.</>
          )}
        </p>
      ) : (
        <div className="overview-campaign-list">
          {snapshot.recentCampaigns.map((campaign) => (
            <a href={withMockMode(`/dashboard/campaigns/${encodeURIComponent(campaign.id)}`)} key={campaign.id}>
              <span className={`overview-campaign-status is-${campaign.status}`}>
                {campaign.status}
              </span>
              <strong>{campaign.name}</strong>
              <small>{campaign.contactCount} leads · {campaign.stepCount} steps</small>
              <time dateTime={campaign.updatedAt}>{relativeTime(campaign.updatedAt) ?? "Recently"}</time>
            </a>
          ))}
        </div>
      )}
    </section>
  );
}

/* shared disconnect logic — reused by LinkedInCard, EmailCard and
   TwitterCard. One removal in flight per card; a failure renders beside
   the row it belongs to. The DELETE answers with the page after the
   removal, which replaces the lists in place. A 403 carries the backend's
   own sentence (code "cannot_disconnect"); anything else gets the fixed
   line. */
function useAccountDisconnect(onAccounts: (page: AccountsPage) => void) {
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  async function disconnect(id: string) {
    if (disconnecting !== null) return;
    setDisconnecting(id);
    setRowError(null);
    try {
      onAccounts(await disconnectAccount(id));
    } catch (reason) {
      setRowError({
        id,
        message:
          reason instanceof AccountApiError && reason.code === "cannot_disconnect" && reason.message
            ? reason.message
            : "Couldn't disconnect. Please try again.",
      });
    } finally {
      setDisconnecting(null);
    }
  }

  return { disconnecting, rowError, disconnect };
}

/* The per-channel list inside a card: the Team page's member row
   (team.css), one per linked account. While the pool loads it mirrors the
   /auth/me boolean — a skeleton row when the channel is connected, nothing
   otherwise — so a single-account customer never sees a "Connect mine"
   flash over their own row. */
function AccountRows<S>({
  accounts,
  rows,
  connected,
  canConnect,
  detail,
  chip,
  disconnecting,
  rowError,
  onDisconnect,
}: {
  accounts: AccountsState;
  rows: SendingAccount<S>[];
  /** the /auth/me boolean — drives the paint until the pool lands */
  connected: boolean;
  canConnect: boolean;
  /** per-channel second-line detail (an address, a handle); omitted when
   *  it repeats the label */
  detail?: (account: SendingAccount<S>) => string | null;
  /** an extra state chip for an active row, e.g. "Messages locked" */
  chip?: (account: SendingAccount<S>) => string | null;
  disconnecting: string | null;
  rowError: { id: string; message: string } | null;
  onDisconnect: (account: SendingAccount<S>) => void;
}) {
  if (accounts.status === "loading") {
    if (!connected) return null;
    return (
      <ul className="team-member-list overview-accounts" aria-hidden="true">
        <li className="team-member-row is-skeleton">
          <span className="team-avatar team-skel" />
          <div className="team-member-id">
            <span className="team-skel team-skel-line" style={{ width: "7rem" }} />
            <span className="team-skel team-skel-line is-faint" style={{ width: "5rem" }} />
          </div>
        </li>
      </ul>
    );
  }
  if (accounts.status === "error") {
    return (
      <p className="overview-accounts-note is-error" role="alert">
        Couldn&rsquo;t load the account list.
      </p>
    );
  }
  if (rows.length === 0) {
    return canConnect ? null : <p className="overview-accounts-note">No accounts linked yet.</p>;
  }
  return (
    <ul className="team-member-list overview-accounts">
      {rows.map((account) => {
        const label = accountLabel(account);
        const extra = detail?.(account) ?? null;
        const showExtra = extra !== null && extra !== label;
        const sub = showExtra ? `${extra} · ${linkedByLine(account)}` : linkedByLine(account);
        const stateChip =
          account.status === "pending" ? "Pending" : account.status === "error" ? "Error" : (chip?.(account) ?? null);
        const busy = disconnecting === account.id;
        return (
          <li key={account.id} className="team-member-row">
            <span className="team-avatar" aria-hidden="true">
              {label.charAt(0).toUpperCase()}
            </span>
            <div className="team-member-id">
              <div className="team-member-name">{label}</div>
              {/* one line, ellipsis at the end (team.css). An address or a
                  name never breaks inside itself: the hyphen in
                  new-hire@… is not a break point. */}
              <div className="team-member-sub" title={sub}>
                {showExtra && (
                  <>
                    <span className="overview-account-who">{extra}</span> ·{" "}
                  </>
                )}
                Linked by <span className="overview-account-who">{linkedBy(account)}</span>
              </div>
              {account.error && (
                <p className="team-inline-error" role="alert">
                  {account.error}
                </p>
              )}
              {rowError?.id === account.id && (
                <p className="team-inline-error" role="alert">
                  {rowError.message}
                </p>
              )}
            </div>
            {(stateChip || account.canDisconnect) && (
              /* chip + button travel as one cluster, so in a narrow card
                 they wrap under the name together instead of squeezing it */
              <div className="overview-account-tail">
                {stateChip && (
                  <span className={`team-role${account.status === "error" ? " is-error" : ""}`}>{stateChip}</span>
                )}
                {account.canDisconnect && (
                  <div className="team-member-actions">
                    <button
                      type="button"
                      className="team-remove"
                      disabled={disconnecting !== null}
                      onClick={() => onDisconnect(account)}
                    >
                      {busy ? "Disconnecting…" : "Disconnect"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* Honest summary metrics remain the overview's largest surface. Activity has
   its own supporting panel so the funnel stays scannable at a glance. */
function MetricsCard({ state }: { state: SummaryState }) {
  return (
    <section className="overview-panel overview-metrics" aria-labelledby="pipeline-title">
      <div className="overview-panel-heading">
        <h2 id="pipeline-title">Results</h2>
        <a href={withMockMode("/dashboard/metrics")}>Open metrics</a>
      </div>
      {state.status === "loading" && <MetricsSkeleton />}
      {state.status === "error" && (
        <p className="m-0 text-[14px] font-medium text-red-700" role="alert">
          Couldn&rsquo;t load your metrics. Please refresh.
        </p>
      )}
      {state.status === "ready" && (
        <>
          <InlineResults results={state.summary.results} />
          <div className="overview-metrics-rule" />
          <FunnelBars funnel={state.summary.funnel} />
        </>
      )}
    </section>
  );
}

/* Mirrors the ready layout — three result columns over the funnel rows —
   so nothing jumps when the summary lands. Blocks are sand-toned with the
   shared slow pulse; reduced motion gets static blocks (overview.css). */
function MetricsSkeleton() {
  return (
    <div role="status" aria-label="Loading metrics">
      <div className="mt-2.5 flex gap-4" aria-hidden="true">
        <div className="flex-1">
          <span className="overview-skeleton" style={{ width: "6rem", height: "0.7rem" }} />
          <span className="overview-skeleton mt-2" style={{ width: "3.4rem", height: "2rem" }} />
        </div>
        <div className="flex-1 border-l border-line pl-4">
          <span className="overview-skeleton" style={{ width: "3.6rem", height: "0.7rem" }} />
          <span className="overview-skeleton mt-2" style={{ width: "2.6rem", height: "1.375rem" }} />
        </div>
        <div className="flex-1 border-l border-line pl-4">
          <span className="overview-skeleton" style={{ width: "3.6rem", height: "0.7rem" }} />
          <span className="overview-skeleton mt-2" style={{ width: "2.6rem", height: "1.375rem" }} />
        </div>
      </div>
      <div className="overview-metrics-rule" aria-hidden="true" />
      <div className="mt-2.5 flex flex-col gap-2" aria-hidden="true">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="grid grid-cols-[74px_1fr_auto] items-center gap-3">
            <span className="overview-skeleton" style={{ width: "3.4rem", height: "0.7rem" }} />
            <span className="overview-skeleton rounded-md" style={{ height: "18px" }} />
            <span className="overview-skeleton" style={{ width: "1.8rem", height: "0.7rem" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* One "Latest" line — copy composed client-side from the event's kind +
   detail; lead name bold ink, company in parens, mono timestamp on the right. */
function ActivityLine({ event }: { event: ActivityEvent }) {
  const who = event.lead_name && (
    <>
      <span className="font-semibold text-ink">{event.lead_name}</span>
      {event.company_name && <> ({event.company_name})</>}
    </>
  );

  let body: ReactNode;
  if (event.kind === "reply") {
    body = who ? <>{who} replied</> : "New LinkedIn reply";
  } else if (event.kind === "sent") {
    const verb = event.detail === "email"
      ? "Email sent"
      : event.detail === "message"
        ? "LinkedIn message sent"
        : event.detail === "connection_request"
          ? "LinkedIn invite sent"
          : event.detail === "x_dm"
            ? "X DM sent"
            : event.detail === "x_follow"
              ? "X follow sent"
              : "Outreach sent";
    body = who ? (
      <>
        {verb} to {who}
      </>
    ) : (
      verb
    );
  } else {
    body = who ? <>{who} moved to {event.detail}</> : <>Moved to {event.detail}</>;
  }

  const rel = relativeTime(event.at);
  return (
    <div className="flex gap-2.5 pt-1.5 text-[12.5px] text-ink-soft">
      <span className="min-w-0">{body}</span>
      {rel && (
        <span className="ml-auto flex-none text-[11px] text-ink-faint tabular-nums">
          {rel}
        </span>
      )}
    </div>
  );
}

/* Results — meetings is the focal figure; replies + reply rate support it,
   separated by hairline dividers (no boxes). */
function InlineResults({ results }: { results: Results }) {
  return (
    <div className="mt-2.5 flex gap-4">
      <div className="flex-1">
        <div className="text-[11.5px] font-medium text-tide">Meetings booked</div>
        <div className="mt-1.5 text-[32px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-tide-deep">
          {results.meetings}
        </div>
        {results.meetings_delta_7d > 0 && (
          <div className="mt-1.5 text-[11px] font-semibold text-tide tabular-nums">
            ↑ {results.meetings_delta_7d} this week
          </div>
        )}
      </div>
      <div className="flex-1 border-l border-line pl-4">
        <div className="text-[11.5px] font-medium text-ink-faint">Replies</div>
        <div className="mt-1.5 text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink">
          {results.replies}
        </div>
        {results.replies_delta_7d > 0 && (
          <div className="mt-1.5 text-[11px] font-semibold text-tide tabular-nums">
            ↑ {results.replies_delta_7d} this week
          </div>
        )}
      </div>
      <div className="flex-1 border-l border-line pl-4">
        <div className="text-[11.5px] font-medium text-ink-faint">Reply rate</div>
        <div className="mt-1.5 text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-ink">
          {(results.reply_rate * 100).toFixed(1)}%
        </div>
      </div>
    </div>
  );
}

/* Pipeline funnel — horizontal bars, tide fill on a tide-wash track. */
function FunnelBars({ funnel }: { funnel: Funnel }) {
  const rows: { name: string; count: number }[] = [
    { name: "Active", count: funnel.active },
    { name: "Contacted", count: funnel.contacted },
    { name: "Replied", count: funnel.replied },
    { name: "Meeting", count: funnel.meetings },
  ];
  const active = funnel.active;

  return (
    <div className="mt-2.5 flex flex-col gap-2">
      {rows.map((row) => {
        const pct = active > 0 ? (row.count / active) * 100 : 0;
        return (
          <div
            key={row.name}
            className="grid grid-cols-[74px_1fr_auto] items-center gap-3"
          >
            <span className="text-[12.5px] text-ink-soft">{row.name}</span>
            <div className="h-[18px] overflow-hidden rounded-md bg-sand">
              <div
                className="h-full rounded-md bg-tide"
                style={{ width: `max(3px, ${pct}%)` }}
              />
            </div>
            <span className="whitespace-nowrap text-right text-[12.5px] font-semibold tabular-nums">
              {row.count.toLocaleString()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* `canWrite` (then the page's can_connect) hides the "Connect mine"
   control for a member; a row's Disconnect follows its own can_disconnect.
   The card, its connected-or-not state, and every row stay visible to
   every role. One LinkedIn per person: an own active row hides "Connect
   mine". */
function LinkedInCard({
  connected: connectedFallback,
  rows,
  accounts,
  canWrite,
  onAccounts,
}: {
  connected: boolean;
  rows: SendingAccount<LinkedInState>[];
  accounts: AccountsState;
  canWrite: boolean;
  onAccounts: (page: AccountsPage) => void;
}) {
  const [connectPending, setConnectPending] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const { disconnecting, rowError, disconnect } = useAccountDisconnect(onAccounts);
  const ready = accounts.status === "ready";
  const connected = ready ? channelConnected(rows) : connectedFallback;
  const canConnect = ready ? accounts.page.canConnect : canWrite;
  const own = ownAccount(rows);
  // Until the pool lands, offer connect only when nothing is connected — a
  // connected channel might already hold the viewer's own row.
  const showConnect = canConnect && (ready ? own?.status !== "active" : !connectedFallback);
  // "Connect LinkedIn" only while the channel holds no row at all.
  const hasRows = ready && rows.length > 0;
  const pending = connectPending || disconnecting !== null;

  async function handleConnect() {
    setConnectPending(true);
    setConnectError(null);
    try {
      const res = await fetch("/linkedin/connect", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("request failed");
      const data = (await res.json()) as { url: string };
      window.location.href = data.url;
    } catch {
      setConnectError("Couldn't start the connection. Please try again.");
      setConnectPending(false);
    }
  }

  return (
    <div className="overview-channel-row">
      <div className="flex items-start gap-4">
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
            connected
              ? "bg-ok/10 text-ok"
              : "bg-tide/10 text-tide"
          }`}
          aria-hidden="true"
        >
          {connected ? (
            <CheckMark className="size-6" />
          ) : (
            <LinkedInMark className="size-6" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[18px] font-semibold tracking-[-0.01em]">
            {connected || hasRows ? "LinkedIn" : "Connect LinkedIn"}
          </h3>
          {!connected && (
            <p className="m-0 mt-2 text-[15px] leading-relaxed text-ink-soft">
              Required for LinkedIn outreach.
            </p>
          )}

          <AccountRows
            accounts={accounts}
            rows={rows}
            connected={connectedFallback}
            canConnect={canConnect}
            disconnecting={disconnecting}
            rowError={rowError}
            onDisconnect={(account) => void disconnect(account.id)}
          />

          {showConnect && (
            <button
              type="button"
              onClick={handleConnect}
              disabled={pending}
              className="mt-5 inline-flex cursor-pointer items-center justify-center gap-2.5 rounded-full bg-tide px-4.5 py-2.5 text-[14.5px] font-semibold text-white transition-[background,transform] hover:-translate-y-px hover:bg-tide-deep disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LinkedInMark className="size-4.5 shrink-0" />
              {connectPending ? "Connecting…" : "Connect mine"}
            </button>
          )}

          {connectError && (
            <p
              className="m-0 mt-3 text-[13.5px] font-medium text-red-700"
              role="alert"
            >
              {connectError}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function MicrosoftMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 21 21" aria-hidden="true" className={className}>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

type EmailProvider = "gmail" | "outlook";

/* The Email card, against the /email/* endpoints (Composio hosted auth;
   the redirect comes back to the settings accounts tab with
   ?email=connected|failed). One primary "Add mailbox" menu starts a
   Google or Microsoft sign-in, or opens the buy flow. The provider must
   match where the mailbox lives: a Google sign-in on an M365-hosted
   address completes OAuth but can't send. One list holds the connected
   mailboxes and the bought pool alike. */
/* `canWrite` (then the page's can_connect) hides the menu's sign-in items
   for a member, and `canWrite` with the pool caps hides its buy item; a
   row's Disconnect follows its own can_disconnect. A bought inbox has no
   Disconnect here. The card, its summary and every row stay visible to
   every role. A person may link more than one mailbox, so the menu stays
   even when the viewer already has a row. */
function EmailCard({
  connected: connectedFallback,
  rows,
  accounts,
  emailError,
  companyName,
  pool,
  applyPurchase,
  canWrite,
  onAccounts,
}: {
  connected: boolean;
  rows: SendingAccount<EmailState>[];
  accounts: AccountsState;
  emailError: string | null;
  companyName: string | null;
  pool: MailboxesOverview | null;
  applyPurchase: (result: PurchaseResult, senders: SenderInput[]) => void;
  canWrite: boolean;
  onAccounts: (page: AccountsPage) => void;
}) {
  const [connectPending, setConnectPending] = useState<EmailProvider | null>(
    null,
  );
  const [connectError, setConnectError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const { disconnecting, rowError, disconnect } = useAccountDisconnect(onAccounts);
  const ready = accounts.status === "ready";
  const connected = ready ? channelConnected(rows) : connectedFallback;
  const canConnect = ready ? accounts.page.canConnect : canWrite;
  // Until the pool lands, offer connect only when nothing is connected.
  const showConnect = canConnect && (ready || !connectedFallback);
  /* the managed pool is null for every customer without one (and on any
     fetch error); its inboxes then simply do not appear in the list. The
     pool and its buy flow do NOT wait for the customer's own mailbox:
     warmup takes weeks, so a fresh account buys inboxes first and
     connects Gmail/Outlook whenever. */
  const mailboxes = pool?.mailboxes ?? [];
  const underCaps =
    (pool?.domains.length ?? 0) < DOMAIN_CAP && mailboxes.length < INBOX_CAP;
  const showBuy = canWrite && underCaps;
  // "Connect email" only while the card holds no row at all.
  const hasRows = (ready && rows.length > 0) || mailboxes.length > 0;
  const empty = !connected && !hasRows;
  const pending = connectPending !== null || disconnecting !== null;
  const summary = ready && !empty ? emailSummaryLine(emailSummary(rows, mailboxes)) : null;

  /* Back from the consent screen: ?email=connected names the viewer's
     newest active mailbox and highlights its row; ?email=failed keeps the
     fixed line. The redirect only proves OAuth finished — when the
     server-side mailbox probe failed (email_error), stay quiet and let
     the card explain instead of flashing green over a red error. */
  const returned = useOneShotParam("email");
  const justConnected =
    returned === "connected" && !emailError && ready ? newestOwnActive(rows) : null;

  // A pending link's "expires in N min" ticks while any row carries one.
  const now = useClock(
    rows.some((row) => row.status === "pending" && row.linkMintedAt !== null) ? 30_000 : null,
  );

  /* One opener for the menu's sign-in items, the pending row's "Open the
     sign-in again" and the expired row's Reconnect: the backend re-mints
     the link into the same row for the provider it is given. */
  async function handleConnect(provider: EmailProvider) {
    setConnectPending(provider);
    setConnectError(null);
    try {
      const res = await fetch("/email/connect", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      });
      if (!res.ok) throw new Error("request failed");
      const data = (await res.json()) as { url: string };
      window.location.href = data.url;
    } catch {
      setConnectError("Couldn't start the connection. Please try again.");
      setConnectPending(null);
    }
  }

  return (
    <div className="overview-channel-row is-email">
      {justConnected && (
        <div className="email-return-banner" role="status">
          <CheckMark />
          <span>
            <b>{emailAddress(justConnected)}</b> is connected.
          </span>
        </div>
      )}
      {returned === "failed" && (
        <div className="email-return-banner is-failed" role="status">
          <span aria-hidden="true">✕</span>
          Connection failed, please try again.
        </div>
      )}
      <div className="flex items-start gap-4">
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
            connected
              ? "bg-ok/10 text-ok"
              : "bg-tide/10 text-tide"
          }`}
          aria-hidden="true"
        >
          {connected ? (
            <CheckMark className="size-6" />
          ) : (
            <MailMark className="size-6" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="email-card-head">
            <div className="email-card-title">
              <h3 className="m-0 text-[18px] font-semibold tracking-[-0.01em]">
                {empty ? "Connect email" : "Email"}
              </h3>
              {summary !== null ? (
                <p className="m-0 text-[15px] leading-relaxed text-ink-soft">{summary}</p>
              ) : (
                empty && (
                  <p className="m-0 text-[15px] leading-relaxed text-ink-soft">
                    Send from your own Google Workspace or Outlook mailboxes, or buy warmed inboxes.
                  </p>
                )
              )}
            </div>
            {(showConnect || showBuy) && (
              <AddMailboxMenu
                connect={showConnect}
                buy={showBuy}
                disabled={pending}
                onConnect={(provider) => void handleConnect(provider)}
                onBuy={() => setAddOpen(true)}
              />
            )}
          </div>

          <EmailRows
            accounts={accounts}
            rows={rows}
            mailboxes={mailboxes}
            connected={connectedFallback}
            canConnect={canConnect}
            now={now}
            highlightId={justConnected?.id ?? null}
            disconnecting={disconnecting}
            connectPending={connectPending}
            rowError={rowError}
            onDisconnect={(account) => void disconnect(account.id)}
            onReconnect={(provider) => void handleConnect(provider)}
          />

          {!connected && emailError && (
            <p
              className="m-0 mt-3 text-[13.5px] font-medium text-red-700"
              role="alert"
            >
              {emailError}
            </p>
          )}

          {connectError && (
            <p
              className="m-0 mt-3 text-[13.5px] font-medium text-red-700"
              role="alert"
            >
              {connectError}
            </p>
          )}

          {addOpen && (
            <AddInboxes
              companyName={companyName}
              ownedDomains={pool?.domains.map((d) => d.name) ?? []}
              existingDomains={pool?.domains.length ?? 0}
              existingInboxes={mailboxes.length}
              onClose={() => setAddOpen(false)}
              onPurchased={(result, senders) => {
                applyPurchase(result, senders);
                setAddOpen(false);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* The card's one control: a primary pill with a menu. Two sign-in items
   when the viewer can connect, then the buy item when the pool has room.
   Keyboard handling follows the assets page's add menu: arrows move,
   Home/End jump, a letter jumps to the item that starts with it, Escape
   closes and returns focus to the pill. */
function AddMailboxMenu({
  connect,
  buy,
  disabled,
  onConnect,
  onBuy,
}: {
  connect: boolean;
  buy: boolean;
  disabled: boolean;
  onConnect: (provider: EmailProvider) => void;
  onBuy: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const initialIndex = useRef(0);
  const id = useId();

  const items: { key: string; label: string; icon: ReactNode; run: () => void }[] = [];
  if (connect) {
    items.push({
      key: "gmail",
      label: "Google Workspace or Gmail",
      icon: <GoogleMark />,
      run: () => onConnect("gmail"),
    });
    items.push({
      key: "outlook",
      label: "Outlook or Microsoft 365",
      icon: <MicrosoftMark />,
      run: () => onConnect("outlook"),
    });
  }
  if (buy) {
    items.push({
      key: "buy",
      label: "Buy warmed inboxes",
      icon: <HelmMark variant="line" />,
      run: onBuy,
    });
  }

  useEffect(() => {
    if (!open) return;
    itemRefs.current[initialIndex.current]?.focus();
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function menuKeyDown(event: KeyboardEvent) {
    const current = itemRefs.current.findIndex((item) => item === document.activeElement);
    let next: number;
    if (event.key === "ArrowDown") next = (current + 1) % items.length;
    else if (event.key === "ArrowUp") next = (current - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    } else if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      next = items.findIndex((item) => item.label.toLowerCase().startsWith(event.key.toLowerCase()));
    } else return;
    if (next < 0) return;
    event.preventDefault();
    itemRefs.current[next]?.focus();
  }

  return (
    <div
      className="email-card-actions"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type="button"
        className="email-add-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => {
          initialIndex.current = 0;
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          initialIndex.current = event.key === "ArrowUp" ? items.length - 1 : 0;
          setOpen(true);
        }}
      >
        Add mailbox
        <svg className="email-add-caret" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div id={id} className="email-add-menu" role="menu" aria-labelledby={`${id}-trigger`} onKeyDown={menuKeyDown}>
          {items.map((item, index) => (
            <Fragment key={item.key}>
              {item.key === "buy" && index > 0 && <div className="email-add-sep" role="separator" />}
              <button
                ref={(element) => {
                  itemRefs.current[index] = element;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  triggerRef.current?.focus();
                  item.run();
                }}
              >
                {item.icon}
                {item.label}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

/* The Email card's list: the connected mailboxes (one row per linked
   account, in the backend's order), then the bought pool. While the
   account pool loads it mirrors the /auth/me boolean, as AccountRows
   does, so a single-mailbox customer never sees the menu flash over
   their own row. Bought inboxes render whatever the account pool is
   doing, since they come from a separate fetch. */
function EmailRows({
  accounts,
  rows,
  mailboxes,
  connected,
  canConnect,
  now,
  highlightId,
  disconnecting,
  connectPending,
  rowError,
  onDisconnect,
  onReconnect,
}: {
  accounts: AccountsState;
  rows: SendingAccount<EmailState>[];
  mailboxes: ManagedMailbox[];
  /** the /auth/me boolean — drives the paint until the pool lands */
  connected: boolean;
  canConnect: boolean;
  /** the clock the pending rows count down against */
  now: number;
  /** the row the return banner names, washed in the accent */
  highlightId: string | null;
  disconnecting: string | null;
  connectPending: EmailProvider | null;
  rowError: { id: string; message: string } | null;
  onDisconnect: (account: SendingAccount<EmailState>) => void;
  onReconnect: (provider: EmailProvider) => void;
}) {
  const ready = accounts.status === "ready";
  if (ready && rows.length === 0 && mailboxes.length === 0) {
    return canConnect ? null : <p className="overview-accounts-note">No accounts linked yet.</p>;
  }
  const skeleton = accounts.status === "loading" && connected;
  const hasList = skeleton || (ready && rows.length > 0) || mailboxes.length > 0;
  const busy = disconnecting !== null || connectPending !== null;
  return (
    <>
      {accounts.status === "error" && (
        <p className="overview-accounts-note is-error" role="alert">
          Couldn&rsquo;t load the account list.
        </p>
      )}
      {hasList && (
        <ul className="team-member-list overview-accounts email-accounts">
          {skeleton && (
            <li className="team-member-row is-skeleton" aria-hidden="true">
              <span className="team-avatar team-skel" />
              <div className="team-member-id">
                <span className="team-skel team-skel-line" style={{ width: "7rem" }} />
                <span className="team-skel team-skel-line is-faint" style={{ width: "5rem" }} />
              </div>
            </li>
          )}
          {ready &&
            rows.map((account) => (
              <EmailAccountRow
                key={account.id}
                account={account}
                now={now}
                highlighted={account.id === highlightId}
                canReconnect={canConnect}
                busy={busy}
                disconnecting={disconnecting === account.id}
                connectPending={connectPending}
                rowError={rowError?.id === account.id ? rowError.message : null}
                onDisconnect={() => onDisconnect(account)}
                onReconnect={onReconnect}
              />
            ))}
          {mailboxes.map((box) => (
            <BoughtInboxRow key={box.address} box={box} now={now} />
          ))}
        </ul>
      )}
    </>
  );
}

/* One connected mailbox: the provider mark, the address, one sub line,
   then a state chip when the row is not simply active, and the quiet
   Disconnect. What the sub line and the tail hold follows the row's
   state (emailRowState):
   - active: who linked it and today's count against the cap;
   - pending: the tab to finish in, how long the link has left, and a
     text link that mints a fresh one;
   - expired: what happened, the Workspace-admin hint for Google, and a
     Reconnect pill;
   - error: the backend's own sentence, as before.
   The text link and the Reconnect pill both start a sign-in, so they
   follow the same gate as the Add mailbox menu: a member sees the state
   and neither control. */
function EmailAccountRow({
  account,
  now,
  highlighted,
  canReconnect,
  busy,
  disconnecting,
  connectPending,
  rowError,
  onDisconnect,
  onReconnect,
}: {
  account: SendingAccount<EmailState>;
  now: number;
  highlighted: boolean;
  /** the viewer holds a seat that can start a sign-in */
  canReconnect: boolean;
  /** any connect or disconnect in flight on the card */
  busy: boolean;
  /** this row's Disconnect is the one in flight */
  disconnecting: boolean;
  connectPending: EmailProvider | null;
  rowError: string | null;
  onDisconnect: () => void;
  onReconnect: (provider: EmailProvider) => void;
}) {
  const state = emailRowState(account);
  const provider = account.channelState.provider;
  const providerName = emailProviderName(provider);
  const who = <span className="overview-account-who">{linkedBy(account)}</span>;
  const linkedLine = `Linked by ${linkedBy(account)}`;

  let chip: string | null = null;
  let chipError = false;
  let sub: ReactNode;
  let subTitle: string | undefined = linkedLine;
  let action: ReactNode = null;
  let showError = false;

  if (state === "active") {
    sub =
      account.sentToday === null ? (
        <>Linked by {who}</>
      ) : (
        <>
          Linked by {who} · {account.sentToday} of {emailDailyCap(account)} sent today
        </>
      );
    if (account.sentToday !== null) {
      subTitle = `${linkedLine} · ${account.sentToday} of ${emailDailyCap(account)} sent today`;
    }
  } else if (state === "pending" && provider !== null && providerName !== null) {
    chip = `Waiting for ${providerName}`;
    const minutes = linkMinutesLeft(account.linkMintedAt, now);
    subTitle = undefined;
    sub = (
      <>
        Finish the sign-in in the {providerName} tab.
        {minutes !== null && <> The link expires in {minutes} min.</>}
        {canReconnect && (
          <>
            {" "}
            <button
              type="button"
              className="email-row-link"
              disabled={busy}
              onClick={() => onReconnect(provider)}
            >
              Open the sign-in again
            </button>
          </>
        )}
      </>
    );
  } else if (state === "pending") {
    // no provider on the row: nothing to re-mint, so the row reads as before
    chip = "Pending";
    sub = <>Linked by {who}</>;
  } else if (state === "expired") {
    chip = "Link expired";
    subTitle = undefined;
    sub = (
      <>
        The sign-in was not finished in time.
        {providerName === "Google" && (
          <>
            {" "}
            If Google showed Access blocked, ask your Workspace admin to trust driftwood under
            Security, API controls, Manage app access.
          </>
        )}
      </>
    );
    if (canReconnect && provider !== null) {
      action = (
        <button
          type="button"
          className="team-resend"
          disabled={busy}
          onClick={() => onReconnect(provider)}
        >
          {connectPending === provider ? "Connecting…" : "Reconnect"}
        </button>
      );
    }
  } else {
    chip = "Error";
    chipError = true;
    showError = true;
    sub = <>Linked by {who}</>;
  }

  const stateLine = subTitle === undefined;
  return (
    <li className={`team-member-row${highlighted ? " is-new" : ""}`}>
      <span className={`email-provider-mark${provider === null ? " is-plain" : ""}`} aria-hidden="true">
        {provider === "outlook" ? <MicrosoftMark /> : provider === "gmail" ? <GoogleMark /> : <MailMark />}
      </span>
      <div className="team-member-id">
        <div className="team-member-name">{emailAddress(account)}</div>
        {/* one line with an ellipsis at the end while it names the
            linker (team.css); a state line wraps instead. An address or a
            name never breaks inside itself. */}
        <div className={`team-member-sub${stateLine ? " is-state" : ""}`} title={subTitle}>
          {sub}
        </div>
        {showError && account.error && (
          <p className="team-inline-error" role="alert">
            {account.error}
          </p>
        )}
        {rowError && (
          <p className="team-inline-error" role="alert">
            {rowError}
          </p>
        )}
      </div>
      {(chip || action || account.canDisconnect) && (
        /* chip + buttons travel as one cluster, so in a narrow card they
           wrap under the address together instead of squeezing it */
        <div className="overview-account-tail">
          {chip && <span className={`team-role${chipError ? " is-error" : ""}`}>{chip}</span>}
          {action}
          {account.canDisconnect && (
            <button type="button" className="team-remove" disabled={busy} onClick={onDisconnect}>
              {disconnecting ? "Disconnecting…" : "Disconnect"}
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/* One bought inbox: the helm in the provider square, the address, and a
   sub line from the pool's own fields (boughtInboxLine): a warming inbox
   names its day of the warm-up and its ready date; a warm one counts
   against today's cap like a person's row, plus the full cap and its date
   while the cap still rises. Provisioning and paused carry their state as
   a chip. No Disconnect: the pool has no remove flow here. */
function BoughtInboxRow({ box, now }: { box: ManagedMailbox; now: number }) {
  const { sub, chip } = boughtInboxLine(box, now);
  return (
    <li className="team-member-row">
      <span className="email-provider-mark is-helm" aria-hidden="true">
        <HelmMark variant="line" />
      </span>
      <div className="team-member-id">
        <div className="team-member-name">{box.address}</div>
        <div className="team-member-sub" title={sub}>
          {sub}
        </div>
      </div>
      {chip && (
        <div className="overview-account-tail">
          <span className="team-role">{chip}</span>
        </div>
      )}
    </li>
  );
}

/* A clock that re-renders on an interval, or never when given null. The
   pending rows read their "expires in N min" against it. */
function useClock(intervalMs: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (intervalMs === null) return;
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

type TwitterState =
  | "idle"
  | "connecting" // a /connect or /unlock POST is in flight
  | "pending" // the login tab is open, we're watching for its close
  | "unlocking" // same, but the tab was opened to enter the chat PIN
  | "error";

/* The ordered list the card shows while the X tab is open.

   This exists because step 2 is the one people skip. The old copy — "Log in
   to X in the new tab, we'll pick it up automatically once you're back" —
   said login was the whole job, and a user who did exactly that got a green
   "Connected" card whose every DM then died at X's chat PIN wall. Closing
   the tab is listed LAST because the close is what confirms the connection:
   anything not done by then isn't in the saved profile. */
function TwitterSteps({ loggedIn }: { loggedIn: boolean }) {
  const steps = [
    { key: "login", done: loggedIn, text: <>Log in to your X account.</> },
    {
      key: "pin",
      done: false,
      text: <>Open Messages and enter your chat PIN.</>,
    },
    {
      key: "close",
      done: false,
      text: <>Close the X tab — that&rsquo;s what saves the connection.</>,
    },
  ];
  return (
    <ol className="m-0 mt-3.5 list-none p-0">
      {steps.map((step, i) => (
        <li key={step.key} className="relative mb-2.5 pl-[30px] text-[15px] leading-relaxed">
          <span
            aria-hidden="true"
            className={`absolute left-0 top-px inline-flex size-5 items-center justify-center rounded-full text-[11.5px] font-bold ${
              step.done ? "bg-ok/12 text-ok" : "bg-sand text-ink-soft"
            }`}
          >
            {step.done ? "✓" : i + 1}
          </span>
          <span className={step.done ? "text-ink-soft" : "text-ink"}>{step.text}</span>
        </li>
      ))}
    </ol>
  );
}

/* Same card shape as LinkedInCard/EmailCard, but against Kernel instead of
   an OAuth hosted-auth provider — X has none. handleConnect opens the
   returned live-view URL in a NEW TAB (nothing navigates the dashboard
   away, unlike the LinkedIn/Email redirect flows). There's no callback, so
   this card is the one that notices the user is done: it watches that tab
   for `closed` and POSTs /twitter/finish, which is what ends the Kernel
   session and confirms the login. It also polls /auth/me on the same
   interval + window focus, and reloads once connected. */
/* `canWrite` (then the page's can_connect) hides the connect and reopen
   controls for a member; a row's Disconnect follows its own
   can_disconnect. The card and its state — connected, pending, or
   chat-locked — stay visible to every role. The pending and locked states,
   and the watcher below, key on the viewer's OWN row (is_mine): the PIN is
   theirs to enter, and a teammate's half-finished login must not put this
   card into its watching state. One X per person: an own active row hides
   "Connect mine". */
function TwitterCard({
  connected: connectedFallback,
  chatLocked: chatLockedFallback,
  rows,
  accounts,
  canWrite,
  onAccounts,
}: {
  connected: boolean;
  chatLocked: boolean;
  rows: SendingAccount<XState>[];
  accounts: AccountsState;
  canWrite: boolean;
  onAccounts: (page: AccountsPage) => void;
}) {
  const [state, setState] = useState<TwitterState>("idle");
  const [error, setError] = useState<string | null>(null);
  const { disconnecting, rowError, disconnect } = useAccountDisconnect(onAccounts);
  const ready = accounts.status === "ready";
  const own = ownAccount(rows);
  // The viewer's own login is started but not confirmed. Read live from the
  // row instead of seeded at mount, so it holds whenever the pool lands.
  const ownPending = own !== null && (own.status === "pending" || own.channelState.pending);
  const pending = state === "connecting" || disconnecting !== null;
  const watching = state === "pending" || state === "unlocking" || (state === "idle" && ownPending);
  const connected = ready ? channelConnected(rows) : connectedFallback;
  const canConnect = ready ? accounts.page.canConnect : canWrite;
  // Connected but walled: the login is fine, chats aren't reachable. Treated
  // as its own state rather than a variant of "connected" because the user
  // has something left to do, and as its own state rather than a variant of
  // "pending" because nothing about the connection is in doubt.
  const locked = ready
    ? own !== null && own.status === "active" && own.channelState.chatLocked
    : connectedFallback && chatLockedFallback;
  // Until the pool lands, offer connect only when nothing is connected — a
  // connected channel might already hold the viewer's own row.
  const showConnect = canConnect && (ready ? own?.status !== "active" : !connectedFallback);
  // "Connect X" only while the channel holds no row at all. With any row
  // the heading follows the viewer's own state, then reads "X".
  const hasRows = ready && rows.length > 0;
  // Deliberately no noopener/noreferrer on the window.open below — we need
  // this reference back to watch for the user closing the tab (and to close
  // it ourselves if the backend confirms first), and the target is Kernel's
  // own live-view host, not arbitrary user content.
  const loginTab = useRef<Window | null>(null);

  useEffect(() => {
    if (!watching) return;
    const forUnlock = state === "unlocking";
    let cancelled = false;
    const check = async () => {
      // The user closing the tab is the trigger: the backend ends the Kernel
      // session (which is what flushes what they did into the saved profile)
      // and reads that profile back. Null the ref first so a focus +
      // interval overlap can't POST this twice.
      if (loginTab.current?.closed) {
        loginTab.current = null;
        try {
          await fetch("/twitter/finish", {
            method: "POST",
            credentials: "include",
          });
        } catch {
          /* the backend's own self-heal check still covers this */
        }
        if (cancelled) return;
      }
      try {
        // /auth/me stays in the loop for its Kernel-backed self-heal check
        // (routers/auth.py). Its booleans are workspace-wide now, so what
        // counts as done is read from the viewer's own row instead.
        const res = await fetch("/auth/me", { credentials: "include" });
        if (!res.ok || cancelled) return;
        const mine = ownAccount((await getAccounts()).x);
        if (cancelled) return;
        // What counts as done depends on why the tab was opened. An unlock
        // run starts already-connected, so waiting on the row being active
        // would be satisfied instantly and reload the page out from under
        // someone still typing their PIN.
        const done = forUnlock
          ? mine !== null && mine.status === "active" && !mine.channelState.chatLocked
          : mine !== null && mine.status === "active";
        if (done) {
          loginTab.current?.close();
          window.location.reload();
        }
      } catch {
        /* transient failure — keep polling, nothing to surface here */
      }
    };
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    // Tight enough that closing the tab feels instant; /auth/me itself is
    // cheap, and its Kernel-backed self-heal check is separately throttled
    // backend-side (routers/auth.py::_TWITTER_CHECK_MIN_INTERVAL).
    const interval = window.setInterval(() => void check(), 4_000);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
      window.clearInterval(interval);
    };
  }, [watching, state]);

  /* One opener for both tabs. /unlock reuses the profile that already holds
     the login (so the user isn't made to log in again just to type a PIN)
     and lands on the chat surface; /connect mints or reuses per its own
     rules and lands on the login page. */
  async function openTab(kind: "connect" | "unlock") {
    setState("connecting");
    setError(null);
    try {
      const res = await fetch(`/twitter/${kind}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("request failed");
      const data = (await res.json()) as { live_view_url: string };
      loginTab.current = window.open(data.live_view_url, "_blank");
      setState(kind === "unlock" ? "unlocking" : "pending");
    } catch {
      setError(
        kind === "unlock"
          ? "Couldn't reopen X. Please try again."
          : "Couldn't start the connection. Please try again.",
      );
      setState("error");
    }
  }

  return (
    <div className="overview-channel-row">
      <div className="flex items-start gap-4">
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${
            locked
              ? "bg-alert/10 text-alert"
              : connected
                ? "bg-ok/10 text-ok"
                : "bg-tide/10 text-tide"
          }`}
          aria-hidden="true"
        >
          {locked ? (
            <LockMark className="size-6" />
          ) : connected ? (
            <CheckMark className="size-6" />
          ) : (
            <XMark className="size-6" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="m-0 text-[18px] font-semibold tracking-[-0.01em]">
            {/* No @handle to show: the login check reads cookies, not X's
                DOM, so nothing scrapes the handle any more. The viewer's
                own half-finished login outranks a teammate's working row,
                since the steps below are theirs to finish. */}
            {locked
              ? "Almost there — Messages is locked"
              : watching
                ? "Finish in the X tab"
                : connected || hasRows
                  ? "X"
                  : "Connect X"}
          </h3>
          {locked ? (
            <p className="m-0 mt-2 text-[15px] leading-relaxed text-ink-soft">
              Enter your chat PIN to enable DMs.
            </p>
          ) : watching ? (
            <p className="m-0 mt-2 text-[15px] leading-relaxed text-ink-soft">
              Complete these steps in X:
            </p>
          ) : (
            !connected && (
              <p className="m-0 mt-2 text-[15px] leading-relaxed text-ink-soft">
                Send direct messages from X.
              </p>
            )
          )}

          {(watching || locked) && <TwitterSteps loggedIn={locked} />}

          <AccountRows
            accounts={accounts}
            rows={rows}
            connected={connectedFallback}
            canConnect={canConnect}
            detail={(account) => (account.channelState.handle ? `@${account.channelState.handle}` : null)}
            chip={(account) => (account.channelState.chatLocked ? "Messages locked" : null)}
            disconnecting={disconnecting}
            rowError={rowError}
            onDisconnect={(account) => void disconnect(account.id)}
          />

          {canConnect && locked ? (
            <div className="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => void openTab("unlock")}
                disabled={pending}
                className="inline-flex cursor-pointer items-center justify-center gap-2.5 rounded-full bg-tide px-4.5 py-2.5 text-[14.5px] font-semibold text-white transition-[background,transform] hover:-translate-y-px hover:bg-tide-deep disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <XMark className="size-4.5 shrink-0" />
                {state === "connecting" ? "Opening…" : "Reopen X tab"}
              </button>
            </div>
          ) : showConnect ? (
            <button
              type="button"
              onClick={() => void openTab("connect")}
              disabled={pending}
              className="mt-5 inline-flex cursor-pointer items-center justify-center gap-2.5 rounded-full bg-tide px-4.5 py-2.5 text-[14.5px] font-semibold text-white transition-[background,transform] hover:-translate-y-px hover:bg-tide-deep disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <XMark className="size-4.5 shrink-0" />
              {state === "connecting"
                ? "Connecting…"
                : watching
                  ? "Reopen login tab"
                  : "Connect mine"}
            </button>
          ) : null}

          {error && (
            <p
              className="m-0 mt-3 text-[13.5px] font-medium text-red-700"
              role="alert"
            >
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------- lists (lead list + blacklist uploads) ---------- */

type RowError = { row: number; reason: string };
type LeadImportResult = {
  added: number;
  skipped_duplicate: number;
  skipped_suppressed: number;
  errors: RowError[];
  audience?: { id: string; name: string; member_count: number; created: boolean } | null;
};
type BlacklistImportResult = {
  added: number;
  already_present: number;
  overlap_removed: number;
  errors: RowError[];
};

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

function summarizeLeads(r: LeadImportResult): string {
  const parts = [`Added ${plural(r.added, "lead", "leads")}`];
  if (r.audience)
    parts.push(
      `${r.audience.created ? "created" : "updated"} audience “${r.audience.name}” (${r.audience.member_count})`,
    );
  if (r.skipped_duplicate)
    parts.push(`${r.skipped_duplicate} already in your pipeline`);
  if (r.skipped_suppressed) parts.push(`${r.skipped_suppressed} on your blacklist`);
  if (r.errors.length) parts.push(`${r.errors.length} skipped (empty rows)`);
  return parts.join(" · ") + ".";
}

function summarizeBlacklist(r: BlacklistImportResult): string {
  const parts = [`Added ${plural(r.added, "entry", "entries")}`];
  if (r.overlap_removed)
    parts.push(`removed ${plural(r.overlap_removed, "matching lead", "matching leads")}`);
  if (r.already_present) parts.push(`${r.already_present} already listed`);
  return parts.join(" · ") + ".";
}

function ListsCard({
  state,
  canWrite,
  onImported,
}: {
  state: SummaryState;
  canWrite: boolean;
  onImported: () => void;
}) {
  const lists = state.status === "ready" ? state.summary.lists : null;
  const leadsLine =
    lists &&
    (lists.leads
      ? `${plural(lists.leads, "lead", "leads")} in your pipeline`
      : "No leads yet.");
  const blacklistLine =
    lists &&
    (lists.blacklist
      ? `${plural(lists.blacklist, "entry", "entries")} on your blacklist`
      : "Nothing blacklisted yet.");

  return (
    <div className="overview-import-body">
      <div className="flex flex-1 flex-col gap-3">
        <UploadField
          className="flex-1"
          title="Lead list"
          hint="CSV with a name plus email or LinkedIn URL."
          endpoint="/api/v1/imports/leads"
          canWrite={canWrite}
          summarize={summarizeLeads}
          current={leadsLine}
          onImported={onImported}
          clearEndpoint="/api/v1/imports/leads"
          clearCount={lists?.leads ?? 0}
          clearArmedLabel={(n) => `Clear ${plural(n, "lead", "leads")}? Confirm`}
          clearNote="This removes every lead in your pipeline and can't be undone."
          summarizeClear={(n) => `Cleared ${plural(n, "lead", "leads")}.`}
        />
        <UploadField
          className="flex-1"
          title="Blacklist"
          hint="Emails, domains, or LinkedIn URLs to exclude."
          endpoint="/api/v1/imports/blacklist"
          canWrite={canWrite}
          summarize={summarizeBlacklist}
          current={blacklistLine}
          onImported={onImported}
          clearEndpoint="/api/v1/imports/blacklist"
          clearCount={lists?.blacklist ?? 0}
          clearArmedLabel={(n) => `Clear ${plural(n, "entry", "entries")}? Confirm`}
          clearNote="Unsubscribes and bounces are kept. This can't be undone."
          summarizeClear={(n) => `Cleared ${plural(n, "entry", "entries")}.`}
        />
      </div>
    </div>
  );
}

type UploadStatus = "idle" | "uploading" | "done" | "error";

function UploadField<T>({
  className = "",
  title,
  hint,
  endpoint,
  canWrite,
  summarize,
  current,
  onImported,
  clearEndpoint,
  clearCount = 0,
  clearArmedLabel,
  clearNote,
  summarizeClear,
}: {
  className?: string;
  title: string;
  hint: string;
  endpoint: string;
  /** Read-only members keep the counts; the upload/clear controls hide. */
  canWrite: boolean;
  summarize: (data: T) => string;
  /** Persisted state from the summary (e.g. "200 leads in your pipeline"),
   *  shown until a fresh upload this session replaces it. */
  current?: string | null;
  /** Called after a successful import so the parent can refresh the counts. */
  onImported?: () => void;
  /** DELETE endpoint that clears this list. Enables the "Clear" button. */
  clearEndpoint?: string;
  /** How many rows exist now — the Clear button hides when this is 0. */
  clearCount?: number;
  /** Armed-state button label ("Clear 240 leads? Confirm"). */
  clearArmedLabel?: (count: number) => string;
  /** One-line consequence note shown while the Clear button is armed. */
  clearNote?: string;
  /** Builds the success toast from the cleared count. */
  summarizeClear?: (cleared: number) => string;
}) {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [uploadingName, setUploadingName] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  /* Destructive clear is arm-then-confirm (the Review-queue idiom): first
     press arms the button, second executes, and an armed button disarms
     itself after a beat — no blocking window.confirm. */
  const [confirmClear, setConfirmClear] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!confirmClear) return;
    const t = window.setTimeout(() => setConfirmClear(false), 5000);
    return () => window.clearTimeout(t);
  }, [confirmClear]);

  async function handleClear() {
    if (!clearEndpoint) return;
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    setConfirmClear(false);
    setClearing(true);
    try {
      const res = await fetch(clearEndpoint, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("request failed");
      const data = (await res.json()) as { cleared: number };
      toast(`${title}: ${summarizeClear?.(data.cleared) ?? `cleared ${data.cleared}.`}`, "success");
      onImported?.();
    } catch {
      toast(`Couldn't clear ${title.toLowerCase()}. Please try again.`, "error");
    } finally {
      setClearing(false);
    }
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so picking the same file again still fires onChange.
    event.target.value = "";
    if (!file) return;

    setStatus("uploading");
    setUploadingName(file.name);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        body,
      });
      if (!res.ok) throw new Error("request failed");
      const data = (await res.json()) as T;
      setStatus("done");
      toast(`${title}: ${summarize(data)}`, "success");
      onImported?.();
    } catch {
      setStatus("error");
      toast(`${title} upload failed. Check the file and try again.`, "error");
    }
  }

  const uploading = status === "uploading";
  const busy = uploading || clearing;
  const label = uploading
    ? "Importing…"
    : status === "done"
      ? "Replace file"
      : "Upload CSV";
  const showClear = Boolean(clearEndpoint) && clearCount > 0;

  return (
    <div className={`rounded-xl border border-line bg-surface p-4 shadow-win-sm ${className}`}>
      <h3 className="m-0 text-[15px] font-semibold">{title}</h3>
      <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-ink-faint">{hint}</p>
      {canWrite && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {/* The file input stays focusable (sr-only, not display:none) so the
              control is reachable by keyboard; the label carries the visible
              ring while the input inside it holds keyboard focus. */}
          <label
            className={`inline-flex items-center gap-2 rounded-full border border-tide/40 bg-surface px-3.5 py-2 text-[13px] font-medium text-tide transition-colors hover:border-tide hover:bg-tide-wash ${
              busy ? "pointer-events-none opacity-60" : "cursor-pointer"
            }`}
          >
            <input
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              onChange={handleFile}
              disabled={busy}
            />
            {uploading && (
              <span
                aria-hidden="true"
                className="size-3.5 animate-spin rounded-full border-[1.5px] border-tide/30 border-t-tide"
              />
            )}
            {label}
          </label>
          {showClear && (
            <button
              type="button"
              onClick={handleClear}
              disabled={busy}
              className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-3.5 py-2 text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                confirmClear
                  ? "bg-red-700 font-semibold text-white hover:bg-red-800"
                  : "border border-line bg-surface font-medium text-ink-soft hover:border-red-600/40 hover:text-red-700"
              }`}
            >
              {clearing && (
                <span
                  aria-hidden="true"
                  className="size-3.5 animate-spin rounded-full border-[1.5px] border-red-600/30 border-t-red-600"
                />
              )}
              {clearing
                ? "Clearing…"
                : confirmClear
                  ? clearArmedLabel?.(clearCount) ?? `Clear ${clearCount.toLocaleString()}? Confirm`
                  : "Clear"}
            </button>
          )}
        </div>
      )}
      {confirmClear && !busy && clearNote && (
        <p className="m-0 mt-2.5 text-[13px] font-medium text-red-700" role="status">
          {clearNote}
        </p>
      )}
      {busy ? (
        <>
          <div
            role="progressbar"
            aria-label={clearing ? `Clearing ${title.toLowerCase()}` : `Importing ${title.toLowerCase()}`}
            className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-line/70"
          >
            <div className="progress-indeterminate h-full w-1/4 rounded-full bg-tide" />
          </div>
          {uploading && (
            /* Names what is happening (rule 4). The API is a single POST with
               no progress endpoint, so this narrates the one stage there is;
               finer stages need server-side import state. */
            <p className="m-0 mt-2 text-[13px] text-ink-faint" role="status">
              Uploading and checking {uploadingName ?? "your file"}…
            </p>
          )}
        </>
      ) : (
        current && (
          <p className="m-0 mt-2.5 text-[13px] font-medium text-ink-soft">{current}</p>
        )
      )}
    </div>
  );
}

/* Strips a one-shot redirect param from the address bar so the banner it
   drives can't replay on every reload or bookmark of that URL. The banner
   itself keeps rendering (its state was captured before the strip). */
function useOneShotParam(name: string): string | null {
  const [value] = useState(() =>
    new URLSearchParams(window.location.search).get(name),
  );
  useEffect(() => {
    if (value === null) return;
    const url = new URL(window.location.href);
    url.searchParams.delete(name);
    window.history.replaceState(window.history.state, "", url);
  }, [name, value]);
  return value;
}

function LinkedInBanner() {
  const status = useOneShotParam("linkedin");
  if (status !== "connected" && status !== "failed") return null;

  const connected = status === "connected";
  return (
    <div
      role="status"
      className={`mb-7 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-[14px] font-medium ${
        connected
          ? "border-ok/25 bg-ok/10 text-ok"
          : "border-red-600/25 bg-red-500/10 text-red-800"
      }`}
    >
      <span aria-hidden="true">{connected ? "✓" : "✕"}</span>
      {connected
        ? "LinkedIn connected — you're all set."
        : "Connection failed, please try again."}
    </div>
  );
}

export function SendingAccountSettings() {
 const [user, setUser] = useState<User | null>(null);
 const [error, setError] = useState(false);
 const [accounts, setAccounts] = useState<AccountsState>({status:"loading"});
 const { pool, applyPurchase } = useManagedInboxes();
 useEffect(() => {
  let current = true;
  loadIdentity<User>().fresh.then((u) => {if(current) {setUser(u);setError(!u);}}).catch(() => {if(current) setError(true);});
  getAccounts().then((page) => {if(current) setAccounts({status:"ready",page});}).catch(() => {if(current) setAccounts({status:"error"});});
  return () => {current = false;};
 }, []);
 if (error) return <p role="alert">Sending accounts could not load. Refresh to try again.</p>;
 if (!user) return <p role="status">Loading sending accounts…</p>;
 return <ConnectionSetup user={user} canWrite={user.org?.role !== "member"} pool={pool} applyPurchase={applyPurchase} accounts={accounts} onAccounts={(page) => setAccounts({status:"ready",page})} />;
}
