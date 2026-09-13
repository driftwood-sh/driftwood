import { parsePolicy, reviewerFor, type ApprovalMode, type ApprovalPolicy } from "./approvals/model.ts";
import { initializeMockMode, mockBlockedResponse } from "./mock-mode.ts";
import { resendRefusalMessage, resendWaitMinutes } from "./team/team-model.ts";
import { uploadKindFor } from "./assets/model.ts";
import { faceMock, installCaptureFixture } from "./face-cloning/mock.ts";

/* Preview-branch mock: `?mock=1` serves canned dashboard data so the
   redesigned dashboard can be seen (and screenshotted) without the backend.
   Numbers mirror the real Autosana account. Dev/preview aid only. */

/* The CSV import fixture mirrors the backend contract: an upload creates a
   `csv_upload` audience named after the file, and re-uploading the same file
   reports every row as already imported. These two helpers are pure and
   exported so node tests can pin the mocked upload's response shape. */
export function mockAudienceNameFromFile(fileName: string): string {
  const name = fileName
    .replace(/\.[^.]*$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return name || "uploaded leads";
}

export type MockLeadImportResult = {
  added: number;
  skipped_duplicate: number;
  skipped_suppressed: number;
  errors: Array<{ row: number; reason: string }>;
  audience: { id: string; name: string; member_count: number; created: boolean };
};

export function mockLeadImportResult(
  fileName: string,
  existing: { id: string; memberCount: number } | null,
): MockLeadImportResult {
  const name = mockAudienceNameFromFile(fileName);
  if (existing) {
    return {
      added: 0,
      skipped_duplicate: existing.memberCount,
      skipped_suppressed: 0,
      errors: [],
      audience: { id: existing.id, name, member_count: existing.memberCount, created: false },
    };
  }
  return {
    added: 1,
    skipped_duplicate: 0,
    skipped_suppressed: 0,
    errors: [],
    audience: { id: crypto.randomUUID(), name, member_count: 1, created: true },
  };
}

// Guarded so importing this module under node (tests) stays a no-op.
const search = typeof location === "undefined" ? "" : location.search;
const params = new URLSearchParams(search);
const mockMode = typeof location === "undefined" ? null : initializeMockMode(search, location.pathname);
if (mockMode) {
  if (import.meta.env.DEV && params.has("facecamera")) installCaptureFixture(params.get("facecamera")!);
  params.set("mock", mockMode);
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  /* The workspace role the fixture reports, for /auth/me and for the Team
     page. `?mock=admin` already means the internal-admin chrome (is_admin
     below), so the workspace-admin preview takes its own value:
     `?mock=org-admin`. An owner and a workspace admin must render
     identically, so this mode exists to prove that by hand. */
  const mockOrgRole: "owner" | "admin" | "member" =
    mockMode === "member" ? "member" : mockMode === "org-admin" ? "admin" : "owner";
  // The workspace's pool of sending accounts (GET /dashboard/accounts,
  // DELETE /dashboard/accounts/{id}). One row per state the cards can
  // show: the viewer's own LinkedIn, a teammate's LinkedIn, the viewer's
  // Gmail, a teammate's Outlook still pending, a teammate's Gmail in error
  // (no name, so the label falls back to the address), and a teammate's X
  // that sits behind the chat PIN wall. ?x=pending|connected|locked adds
  // the viewer's own X row in that state (omit for "Connect mine", as
  // before). An owner or admin can connect and can disconnect any row. In
  // ?mock=member the viewer holds no seat that can connect, so no row is
  // theirs, nothing can be disconnected, and the rows that would be theirs
  // belong to Priya instead.
  const viewerCanConnect = mockOrgRole !== "member";
  type MockPerson = { id: string; name: string | null; email: string };
  const viewer: MockPerson = viewerCanConnect
    ? { id: "mock", name: "Marc Andreessen", email: "marc@a16z.com" }
    : { id: "m-4", name: "Priya Nair", email: "priya@example.com" };
  const sam: MockPerson = { id: "m-1", name: "Sam Field", email: "sam@example.com" };
  const newHire: MockPerson = { id: "m-2", name: null, email: "new-hire@example.com" };
  type MockAccount = {
    id: string; display: string | null;
    connected_by: MockPerson;
    is_mine: boolean; can_disconnect: boolean; status: string; error: string | null;
    connected_at: string | null; channel_state: Record<string, unknown>;
    sent_today?: number | null; daily_cap?: number | null; link_minted_at?: string | null;
  };
  const account = (
    id: string, display: string | null, by: MockPerson, status: string,
    channel_state: Record<string, unknown>, error: string | null = null,
    extra: Pick<MockAccount, "sent_today" | "daily_cap" | "link_minted_at"> = {},
  ): MockAccount => ({
    id, display, connected_by: by,
    is_mine: viewerCanConnect && by === viewer,
    can_disconnect: viewerCanConnect,
    status, error: status === "error" ? error : null,
    connected_at: status === "pending" ? null : hoursAgo(24 * 12),
    channel_state,
    ...extra,
  });
  /* `?senders=named` puts a sender on every queued row, which is the only
     thing that brings the queue's From column back: the column reads the
     rows, not the account list. Nothing serves that field yet, so the default
     fixture leaves it unset and the column stays away. */
  const namedSenders = params.get("senders") === "named";
  const xMode = params.get("x");
  const mockAccounts: Record<"linkedin" | "email" | "x", MockAccount[]> = {
    linkedin: [
      account("acct-li-1", viewer.name, viewer, "active", {}),
      account("acct-li-2", sam.name, sam, "active", {}),
    ],
    // Email rows also carry the day's count, the cap, and (while pending)
    // when the sign-in link was minted, so the card's row states render.
    // The expired row is an error row whose channel state says the link
    // ran out.
    email: [
      account("acct-em-1", viewer.email, viewer, "active", { provider: "gmail", address: viewer.email }, null,
        { sent_today: 12, daily_cap: 20 }),
      account("acct-em-2", sam.email, sam, "pending", { provider: "outlook", address: sam.email }, null,
        { link_minted_at: new Date(Date.now() - 2 * 60e3).toISOString() }),
      account("acct-em-3", null, newHire, "error", { provider: "gmail", address: newHire.email },
        "Google signed this mailbox out. Connect it again to resume sending."),
      account("acct-em-4", "team@example.com", sam, "error",
        { provider: "gmail", address: "team@example.com", link_state: "expired" }),
    ],
    x: [
      account("acct-x-1", "Sam Field", sam, "active", { handle: "samfield", pending: false, chat_locked: true }),
      ...(xMode === "pending"
        ? [account("acct-x-2", viewer.name, viewer, "pending", { handle: null, pending: true, chat_locked: false })]
        : xMode === "connected" || xMode === "locked"
          ? [account("acct-x-2", viewer.name, viewer, "active", { handle: "pmarca", pending: false, chat_locked: xMode === "locked" })]
          : []),
    ],
  };
  const accountsPage = () => ({
    can_connect: viewerCanConnect,
    linkedin: mockAccounts.linkedin,
    email: mockAccounts.email,
    x: mockAccounts.x,
  });
  const accountsApi = (init?: RequestInit, url?: string) => {
    const method = init?.method ?? "GET";
    const path = new URL(url ?? location.href, location.href).pathname;
    if (method !== "DELETE") return accountsPage();
    const id = decodeURIComponent(path.split("/accounts/")[1] ?? "");
    const channel = (["linkedin", "email", "x"] as const).find((c) => mockAccounts[c].some((a) => a.id === id));
    const row = channel ? mockAccounts[channel].find((a) => a.id === id) : undefined;
    if (!channel || !row) {
      return new Response(JSON.stringify({ detail: "That account is no longer on the page." }), { status: 404, headers: { "Content-Type": "application/json" } });
    }
    if (!row.can_disconnect) {
      return new Response(
        JSON.stringify({ detail: "Only the person who linked this account, or an owner or admin, can disconnect it.", code: "cannot_disconnect" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }
    mockAccounts[channel] = mockAccounts[channel].filter((a) => a.id !== id);
    return accountsPage();
  };
  const me = {
    id: "mock",
    email: "marc@a16z.com",
    name: "Marc Andreessen",
    avatar_url: null,
    is_approved: true,
    linkedin_connected: true,
    email_connected: true,
    impersonating: params.get("impersonating") === "1",
    // ?mock=admin flips the admin chrome on (God mode + the SEO / GEO pill)
    // for QA'ing admin-only pages like /dashboard/admin/search-visibility. Plain ?mock=1
    // stays the customer view the baked marketing screenshots are shot from.
    is_admin: mockMode === "admin",
    org: {
      name: "Example workspace",
      role: mockOrgRole,
    },
    // ?x=pending|connected|locked walks the X card's later states without a
    // real Kernel profile. "locked" is the one worth looking at: connected,
    // but sitting behind X's chat PIN wall so DMs can't go out. Omit for
    // the default "Connect your X account".
    twitter_connected: ["connected", "locked"].includes(params.get("x") ?? ""),
    twitter_pending: params.get("x") === "pending",
    twitter_chat_locked: params.get("x") === "locked",
  };
  const summary = {
    linkedin_connected: true,
    sending: {
      invites_sent: 0,
      invites_cap: 20,
      messages_sent: 0,
      messages_cap: 25,
      within_limits: true,
      last_action_at: hoursAgo(3),
    },
    email_sending: {
      emails_sent: 7,
      emails_cap: 40,
      within_limits: true,
    },
    funnel: { active: 6, contacted: 6, replied: 2, meetings: 1 },
    results: {
      meetings: 1,
      meetings_delta_7d: 1,
      replies: 2,
      replies_delta_7d: 1,
      reply_rate: 0.333,
    },
    lists: { leads: 6, blacklist: 2 },
    companies: { qualified: 6, screened_out: 0, unknown: 0 },
    pending_reviews: 3,
    queued_sends: 5,
  };
  const activity = {
    events: [
      { at: hoursAgo(2), kind: "stage", lead_id: "m1", lead_name: "Dana Whitfield", company_name: "Meridian", detail: "booked" },
      { at: hoursAgo(2.4), kind: "reply", lead_id: null, lead_name: null, company_name: null, detail: null },
      { at: hoursAgo(6), kind: "sent", lead_id: null, lead_name: null, company_name: null, detail: "email" },
      { at: hoursAgo(7), kind: "sent", lead_id: null, lead_name: null, company_name: null, detail: "message" },
      { at: hoursAgo(9), kind: "reply", lead_id: null, lead_name: null, company_name: null, detail: null },
      { at: hoursAgo(17), kind: "sent", lead_id: null, lead_name: null, company_name: null, detail: "connection_request" },
    ],
  };
  // Managed inboxes (GET /mailboxes/overview) are opt-in via ?mock=1&inboxes=1
  // so the default mock view — the one the baked marketing screenshots are
  // shot from — stays exactly as it was. Without the flag the fixture serves
  // an empty pool, which keeps the panel absent (and keeps mock mode from
  // ever reaching the real backend on this path). Capacity counts the managed
  // pool only; the UI adds 20/day for the connected mailbox. Each managed
  // inbox ramps to 20/day over 14 days: 20 active + 20 ready + 10 + 10
  // warming = 60 now, 80 when warm (the paused inbox carries nothing).
  const inboxesFlag = params.get("inboxes");
  const managedInboxes = inboxesFlag && !["0", "off", "false"].includes(inboxesFlag.toLowerCase())
    ? {
        own_mailbox: { connected: true, address: "yuvan@autosana.ai" },
        capacity: { current_per_day: 60, projected_per_day: 80 },
        domains: [
          { name: "autosana-ai.com", status: "active", registered_at: hoursAgo(24 * 40) },
          { name: "autosanahq.com", status: "active", registered_at: hoursAgo(24 * 6) },
          { name: "useautosana.com", status: "active", registered_at: hoursAgo(24 * 40) },
        ],
        mailboxes: [
          { address: "yuvan@autosana-ai.com", domain: "autosana-ai.com", status: "active", warming_day: null, warming_days_total: 14, todays_cap: 20, sent_today: 14, health: "good", paused_reason: null },
          { address: "yuvan.sundrani@autosana-ai.com", domain: "autosana-ai.com", status: "ready", warming_day: null, warming_days_total: 14, todays_cap: 20, sent_today: 0, health: "good", paused_reason: null },
          { address: "yuvan@autosanahq.com", domain: "autosanahq.com", status: "warming", warming_day: 5, warming_days_total: 14, todays_cap: 10, sent_today: 8, health: "good", paused_reason: null },
          { address: "yuvan.sundrani@autosanahq.com", domain: "autosanahq.com", status: "warming", warming_day: 5, warming_days_total: 14, todays_cap: 10, sent_today: 7, health: "unknown", paused_reason: null },
          { address: "yuvan@useautosana.com", domain: "useautosana.com", status: "paused", warming_day: null, warming_days_total: 14, todays_cap: 0, sent_today: 0, health: "warning", paused_reason: "Paused Aug 24 after a bounce spike on this address. Sending resumes automatically once bounce rates settle." },
        ],
      }
    : { capacity: { current_per_day: 0, projected_per_day: 0 }, domains: [], mailboxes: [] };
  // The add-inboxes flow's two endpoints. Availability marks a handful of
  // shapes taken — a few of the workspace-seeded suggestions ("Example
  // workspace" cleans to exampleworkspace) so the progressive sweep and its
  // Show more control have to dig past taken names, plus a few Autosana
  // shapes so typing autosana behaves the same, and getautosana.com keeps
  // the taken exact-domain line demoable. Everything else is available.
  // Purchase always succeeds, echoing the requested domains back in their
  // registering state — the tile's optimistic merge takes it from there.
  const takenDomains = new Set([
    "getautosana.com",
    "tryautosana.com",
    "meetautosana.com",
    "autosanaai.com",
    "autosana-app.com",
    "getexampleworkspace.com",
    "tryexampleworkspace.com",
    "exampleworkspaceai.com",
    "exampleworkspace-app.com",
  ]);
  const mailboxAvailability = (_init?: RequestInit, url?: string) => {
    const domain = new URL(url ?? "", location.origin).searchParams.get("domain") ?? "";
    return { domain, available: !takenDomains.has(domain) };
  };
  const mailboxPurchase = (init?: RequestInit) => {
    try {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        domains?: string[];
        senders?: { username: string }[];
      };
      const domains = body.domains ?? [];
      const senders = body.senders ?? [];
      return {
        domains: domains.map((name) => ({ name, status: "registering" })),
        mailboxes_planned: domains.length * senders.length,
      };
    } catch {
      return { domains: [], mailboxes_planned: 0 };
    }
  };
  const daysAhead = (d: number) =>
    new Date(Date.now() + d * 86400e3).toISOString();
  const dateAhead = (d: number) =>
    new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);
  /* The page groups by the projected date in the reader's own timezone, so
     the fixture's days are local days. dateAhead() is UTC and drifts a day
     after 5pm Pacific, which would label today's block "Tomorrow". */
  /* Demo slugs that resolve to real bytes. The page asks for /d/<slug>, and
     the browser folds "/d/../case-autosana.mp4" to "/case-autosana.mp4"
     before it ever leaves, so these fixtures serve three clips that really
     play, out of the landing assets, in dev and on a preview alike. Without
     them every card is a dead frame and the console carries a 404 per card. */
  const clip = (name: string) => `../${name}`;
  const localDateAhead = (dayOffset: number) => {
    const at = new Date();
    at.setDate(at.getDate() + dayOffset);
    return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
  };
  const lead = (name: string, title: string, company: string) => ({
    lead_id: name, name, title, company,
    linkedin_url: `https://www.linkedin.com/in/${name.toLowerCase().replace(/\s+/g, "-")}`,
    stage: "new", prior_sends: 0, last_sent_at: null,
  });
  const sentLedger = [
    {
      id: "sl1", batch_id: "sb0", kind: "email",
      note: "hi dana \u2014 built meridian a working demo of the same-day booking fix. 19 seconds, real data: https://driftwood.sh/d/meridian-demo. worth a look?",
      subject: "same-day booking fix \u2014 live demo",
      attachment_slug: null, lead: lead("Dana Whitfield", "VP Ops", "Meridian"),
      status: "sent", error: null, error_class: null,
      due_at: hoursAgo(30), projected_date: null, created_at: hoursAgo(31),
      sent_at: hoursAgo(28),
    },
    {
      id: "sl2", batch_id: "sb0", kind: "message",
      note: "hey jordan, the brex one-pager is live \u2014 entity-by-entity rollout and the yield math. link below.",
      subject: null, attachment_slug: null,
      lead: lead("Jordan Reyes", "Head of Growth", "Brex"),
      status: "sent", error: null, error_class: null,
      due_at: hoursAgo(50), projected_date: null, created_at: hoursAgo(52),
      sent_at: hoursAgo(49),
    },
    {
      id: "sl3", batch_id: "sb0", kind: "connection_request",
      note: "hey riley \u2014 saw anchorpoint's reconciliation launch. building agents that do outbound the way founders do it by hand. would love to connect.",
      subject: null, attachment_slug: null,
      lead: lead("Riley Chen", "Cofounder", "Anchorpoint"),
      status: "sent", error: null, error_class: null,
      due_at: hoursAgo(75), projected_date: null, created_at: hoursAgo(76),
      sent_at: hoursAgo(74),
    },
    // An email whose body carries the linked-image transport marker \u2014 the
    // sent ledger must render it as recipient-facing media, never as the
    // raw markdown line.
    {
      id: "sl4", batch_id: "sb0", kind: "email",
      subject: "Working demo of the checkout fix",
      note: "Hey Priya,\n\nBuilt Northstar a working demo of the checkout fix \u2014 19 seconds, real data.\n\n[![Northstar checkout demo](https://driftwood.sh/case-autosana-poster.webp)](https://driftwood.sh/customers/autosana)\n\nWorth a look?\n\nBest,\nYuvan",
      attachment_slug: null, lead: lead("Priya Patel", "Head of Growth", "Northstar"),
      status: "sent", error: null, error_class: null,
      due_at: hoursAgo(100), projected_date: null, created_at: hoursAgo(101),
      sent_at: hoursAgo(99),
    },
  ];
  /* Three demos, each the pair the agent files: a bug_validation item that
     carries the clip and its evidence, and a send_email item that carries the
     copy. The Demos page groups a pair into one card by lead. The message and
     the connection request below are the rest of the review queue, and prove
     the customer's page leaves them out. */
  sentLedger.push({
    id: "sl5", batch_id: "sb0", kind: "message",
    note: "hey ines \u2014 the relayworks segment editor saves an empty rule without a warning. 36-second clip attached.",
    subject: null, attachment_slug: null,
    lead: lead("Ines Duarte", "Product lead", "Relayworks"),
    status: "sent", error: null, error_class: null,
    due_at: hoursAgo(76), projected_date: null, created_at: hoursAgo(77),
    sent_at: hoursAgo(73),
  });
  const reviews = {
    counts: {
      pending: 8,
      pending_sends: 5,
      pending_system: 3,
      approved_7d: 12,
      denied_7d: 2,
    },
    pending: [
      {
        id: "rb1", batch_id: "b9", agent_id: "demo", kind: "bug_validation",
        title: "Northstar · pricing page drops the plan choice",
        body: "Picking the Growth plan on northstar.io/pricing and pressing back loses the choice, so checkout opens on Starter.",
        lead: lead("Priya Patel", "Head of Growth", "Northstar"),
        attachment_slug: clip("compare.mp4"),
        evidence: {
          repro_steps: [
            "Open northstar.io/pricing on a clean profile",
            "Pick the Growth plan and press Continue",
            "Press back once, then Continue again",
            "Checkout opens on Starter, with the Growth price still shown above it",
          ],
          url: "northstar.io/pricing",
          device: "iPhone 15 Pro · iOS 18.5 · 393x852",
          video_timestamp: "bug visible at 0:19",
        },
        status: "pending", decision_reason: null, decided_at: null,
        scheduled_batch_id: null, created_at: hoursAgo(30),
      },
      {
        id: "rb2", batch_id: "b9", agent_id: "demo", kind: "bug_validation",
        title: "Autosana · run history loses its filter",
        body: "The run history filter resets to All every time a run finishes, so a long suite cannot be watched on one label.",
        lead: lead("Yuvan Kumar", "CEO", "Autosana"),
        attachment_slug: clip("case-autosana.mp4"),
        evidence: {
          repro_steps: [
            "Open the run history and filter to one label",
            "Start a run and wait for it to finish",
            "The filter is back on All",
          ],
          url: "app.autosana.dev/runs",
          device: "Chrome 141 · macOS 15.6",
          video_timestamp: "bug visible at 0:08",
        },
        status: "pending", decision_reason: null, decided_at: null,
        scheduled_batch_id: null, created_at: hoursAgo(6),
      },
      {
        id: "rb3", batch_id: "b10", agent_id: "demo", kind: "bug_validation",
        title: "Meridian · booking flow bug",
        body: "Selecting a same-day slot on meridian.com/book throws a 500 and drops the reservation.",
        lead: lead("Dana Whitfield", "VP Ops", "Meridian"),
        attachment_slug: clip("case-oruk.mp4"),
        evidence: {
          repro_steps: [
            "Open meridian.com/book and pick today",
            "Choose any open slot and press Reserve",
            "The page shows a 500 and the reservation is gone from the list",
          ],
          url: "meridian.com/book",
          device: "Pixel 9 · Android 16",
          video_timestamp: "bug visible at 0:12",
        },
        status: "pending", decision_reason: null, decided_at: null,
        scheduled_batch_id: null, created_at: hoursAgo(1.2),
      },
      {
        id: "r1", batch_id: "b1", agent_id: "demo", kind: "send_message",
        title: "Brex \u00b7 Jordan Reyes (message)",
        body: "hey jordan, notion is one of ramp's flagship case studies. built the one-pager brex could send notion's finance team to flip it: entity-by-entity rollout, the yield math, live page linked below. worth a look?",
        lead: lead("Jordan Reyes", "Head of Growth", "Brex"),
        attachment_slug: null, evidence: null, status: "pending",
        decision_reason: null, decided_at: null, scheduled_batch_id: null,
        created_at: hoursAgo(0.15),
      },
      {
        id: "r2", batch_id: "b1", agent_id: "demo", kind: "send_email",
        title: "Northstar \u00b7 Priya Patel (email)",
        subject: "The plan choice your pricing page loses",
        body: "Hey Priya,\n\nPicking Growth on your pricing page and pressing back opens checkout on Starter. Here is a 22-second clip of it, and the fix running.\n\nWorth a look?\n\nBest,\nAayush",
        lead: lead("Priya Patel", "Head of Growth", "Northstar"),
        attachment_slug: clip("compare.mp4"), evidence: null, status: "pending",
        decision_reason: null, decided_at: null, scheduled_batch_id: null,
        created_at: hoursAgo(29.5),
      },
      {
        id: "r5", batch_id: "b10", agent_id: "demo", kind: "send_email",
        title: "Meridian \u00b7 Dana Whitfield (email)",
        subject: "Same-day booking is dropping reservations",
        body: "Hey Dana,\n\nA same-day slot on meridian.com/book returns a 500 and the reservation disappears. Short clip of the repro, and of it working after the fix.\n\nHappy to run the same pass on your next release.\n\nBest,\nAayush",
        lead: lead("Dana Whitfield", "VP Ops", "Meridian"),
        attachment_slug: clip("case-oruk.mp4"), evidence: null, status: "pending",
        decision_reason: null, decided_at: null, scheduled_batch_id: null,
        created_at: hoursAgo(1),
      },
      {
        id: "r3", batch_id: "b2", agent_id: "demo", kind: "send_connection",
        title: "Ledgerline \u00b7 Sam Okafor (connect)",
        body: "fellow yc founder! building in the fintech tooling space too.",
        lead: lead("Sam Okafor", "CTO", "Ledgerline"),
        attachment_slug: null, evidence: null, status: "pending",
        decision_reason: null, decided_at: null, scheduled_batch_id: null,
        created_at: hoursAgo(1.1),
      },
      {
        id: "r4", batch_id: "b3", agent_id: "demo", kind: "send_email",
        title: "Autosana · Yuvan Kumar (email)",
        subject: "Two outreach fixes from this week",
        body: "Hey Yuvan,\n\nI pulled the two workflow changes into one short walkthrough.\n\n[![Autosana outreach workflow](https://driftwood.sh/case-autosana-poster.webp)](https://driftwood.sh/customers/autosana)\n\nWorth a look before our next check-in?\n\nBest,\nAayush",
        lead: lead("Yuvan Kumar", "CEO", "Autosana"),
        attachment_slug: null, evidence: null, status: "pending",
        decision_reason: null, decided_at: null, scheduled_batch_id: null,
        created_at: hoursAgo(1.4),
      },
    ],
    decided: [], total_pending: 8, limit: 25, offset: 0,
    queue_stats: [
      { kind: "connection_request", queued: 2, sent_24h: 3, cap: 20, runs_through: dateAhead(2), failed: 2 },
      { kind: "message", queued: 5, sent_24h: 6, cap: 25, runs_through: localDateAhead(39), failed: 0 },
      { kind: "email", queued: 3, sent_24h: 2, cap: 20, runs_through: localDateAhead(39), failed: 0 },
    ],
  };
  // Approved-but-undelivered ScheduledSends (the review page's Queued tab),
  // due_at asc = the send order. One sending, two failed (one classified,
  // one pre-classification null), the rest pending.
  type MockSend = { id: string; batch_id: string; kind: string; subject?: string | null; note: string; attachment_slug: string | null; lead: ReturnType<typeof lead> | null; status: string; error: string | null; error_class: string | null; due_at: string; projected_date: string | null; created_at: string; held?: boolean; sending_account?: string | null };
  const sends: { sends: MockSend[]; total: number; limit: number; offset: number; counts: { pending: number; sending: number; failed: number; sent: number } } = {
    sends: [
      {
        id: "s1", batch_id: "sb1", kind: "connection_request",
        note: "fellow yc founder! building in the fintech tooling space too.",
        attachment_slug: null, lead: lead("Riley Chen", "Cofounder", "Anchorpoint"),
        status: "failed", error_class: "already_connected",
        error: "Unipile 422 unprocessable_entity: cannot_resend_yet — an invitation was already sent to this recipient recently; provider allows a new invite after the previous one is withdrawn for 3 weeks",
        due_at: hoursAgo(20), projected_date: null, created_at: hoursAgo(26),
      },
      {
        id: "s7", batch_id: "sb1", kind: "connection_request",
        note: "hey marcus — saw the tidewater incident postmortem on your blog. building agents that do outbound the way founders do it by hand. would love to connect.",
        attachment_slug: null, lead: lead("Marcus Hale", "Cofounder", "Tidewater"),
        status: "failed", error_class: null,
        error: "Unipile 422 unprocessable_entity: provider rejected the invitation (raw error body not captured)",
        due_at: hoursAgo(18), projected_date: null, created_at: hoursAgo(25),
      },
      {
        id: "s2", batch_id: "sb1", kind: "message",
        note: "hey dana, congrats on the meridian launch. the booking flow demo is live at the link below — 19 seconds, real data. worth a look?",
        attachment_slug: null, lead: lead("Dana Whitfield", "VP Engineering", "Meridian"),
        status: "sending", error: null, error_class: null,
        due_at: hoursAgo(0.05), projected_date: dateAhead(0), created_at: hoursAgo(22),
      },
      {
        id: "s3", batch_id: "sb2", kind: "message",
        note: "hey priya, found a dead link on northstar's pricing page. built you a working demo of the fix, 19 seconds, link below. worth a look?",
        attachment_slug: clip("compare.mp4"), lead: lead("Priya Patel", "Head of Growth", "Northstar"),
        status: "pending", error: null, error_class: null,
        due_at: daysAhead(0.2), projected_date: dateAhead(0), created_at: hoursAgo(21),
      },
      {
        id: "s4", batch_id: "sb2", kind: "connection_request",
        note: "hey sam — saw ledgerline's reconciliation launch on hn. we're building agents that do outbound the way founders do it by hand. would love to connect.",
        attachment_slug: null, lead: lead("Sam Okafor", "CTO", "Ledgerline"),
        status: "pending", error: null, error_class: null,
        due_at: daysAhead(1), projected_date: dateAhead(1), created_at: hoursAgo(21),
      },
      {
        id: "s5", batch_id: "sb2", kind: "message",
        note: "hey jordan, notion is one of ramp's flagship case studies. built the one-pager brex could send notion's finance team to flip it: entity-by-entity rollout, the yield math against their current sweep setup, and the migration path their controllers would actually sign off on. live page linked below — took a real pass at the numbers, not a template. if it's useful, i can rework it against whatever deck your team already runs with. worth a look?",
        attachment_slug: null, lead: lead("Jordan Reyes", "Head of Growth", "Brex"),
        status: "pending", error: null, error_class: null,
        due_at: daysAhead(2), projected_date: dateAhead(2), created_at: hoursAgo(20),
      },
      {
        id: "s6", batch_id: "sb3", kind: "connection_request",
        note: "hey — loved your talk on mobile release trains. building in the qa tooling space, would love to swap notes.",
        attachment_slug: null, lead: null,
        status: "pending", error: null, error_class: null,
        due_at: daysAhead(2.5), projected_date: null, created_at: hoursAgo(4),
      },
      {
        id: "s9", batch_id: "sb5", kind: "email",
        subject: "The plan choice your pricing page loses",
        note: "Hey Priya,\n\nPicking Growth on your pricing page and pressing back opens checkout on Starter. Here is a 22-second clip of it, and the fix running.\n\nWorth a look?\n\nBest,\nAayush",
        attachment_slug: clip("compare.mp4"), lead: lead("Priya Patel", "Head of Growth", "Northstar"),
        status: "pending", error: null, error_class: null,
        due_at: daysAhead(0.3), projected_date: dateAhead(0), created_at: hoursAgo(9),
      },
      {
        id: "s10", batch_id: "sb5", kind: "message",
        note: "hey ines — the relayworks segment editor saves an empty rule without a warning. 36-second clip of it, and of the guard that catches it.",
        attachment_slug: "relayworks-segment-rule", lead: lead("Ines Duarte", "Product lead", "Relayworks"),
        status: "pending", error: null, error_class: null,
        due_at: daysAhead(1.2), projected_date: dateAhead(1), created_at: hoursAgo(9),
      },
      {
        id: "s11", batch_id: "sb5", kind: "email",
        subject: "Same-day booking is dropping reservations",
        note: "Hey Dana,\n\nA same-day slot on meridian.com/book returns a 500 and the reservation disappears. Short clip of the repro, and of it working after the fix.\n\nBest,\nAayush",
        attachment_slug: clip("case-oruk.mp4"), lead: lead("Dana Whitfield", "VP Ops", "Meridian"),
        status: "pending", error: null, error_class: null,
        due_at: daysAhead(1.4), projected_date: dateAhead(1), created_at: hoursAgo(7),
      },
      {
        id: "s12", batch_id: "sb6", kind: "message",
        note: "hey owen — juniper's photo upload reports done before the bytes land. clip attached, plus the retry that fixes it.",
        attachment_slug: "juniper-upload-race", lead: lead("Owen Brooks", "Engineering director", "Juniper Systems"),
        status: "pending", error: null, error_class: null,
        due_at: daysAhead(2.2), projected_date: dateAhead(2), created_at: hoursAgo(5),
      },
      {
        id: "s8", batch_id: "sb4", kind: "email",
        subject: "Two outreach fixes from this week",
        note: "Hey Yuvan,\n\nI pulled the two workflow changes into one short walkthrough.\n\n[![Autosana outreach workflow](https://driftwood.sh/case-autosana-poster.webp)](https://driftwood.sh/customers/autosana)\n\nWorth a look before our next check-in?\n\nBest,\nAayush",
        attachment_slug: null, lead: lead("Yuvan Kumar", "CEO", "Autosana"),
        status: "pending", error: null, error_class: null,
        due_at: daysAhead(1.5), projected_date: dateAhead(1), created_at: hoursAgo(8),
      },
    ],
    total: 12, limit: 100, offset: 0,
    counts: { pending: 9, sending: 1, failed: 2, sent: 2 },
  };
  /* A real customer's queue is weeks deep, so the fixture is too: about
     1,200 demos over 40 sending days, paced by the same daily caps the
     settings endpoint reports (20 emails, 25 LinkedIn). That is what makes
     the day collapse, the "Full" day, and the displacement cascade real
     rather than a drawing of themselves. */
  const QUEUE_DAYS = 40;
  const DAY_EMAIL_CAP = 20;
  const DAY_MESSAGE_CAP = 25;
  const bulkCompanies = [
    "Chime", "Rosebud", "Roame", "Inkitt", "Superhuman", "Instabug", "OneSignal",
    "DraftKings", "Sentry", "Coinbase", "Notion", "Figma", "Linear", "Retool",
    "Vanta", "Deel", "Mercury", "Ramp", "Loom", "Airtable", "Webflow", "Zapier",
    "Miro", "Cal", "Render", "Fly", "Neon", "Clerk", "Resend", "Sanity",
  ];
  const bulkFirst = ["Ava", "Noah", "Mia", "Leo", "Zoe", "Kai", "Ida", "Rey", "Nora", "Otis"];
  const bulkLast = ["Marsh", "Okafor", "Hale", "Duarte", "Brooks", "Nair", "Reyes", "Chen", "Moretti", "Shah"];
  const bulkRoles = ["Head of Growth", "VP Engineering", "CTO", "Head of Product", "Director of Marketing"];
  /* The dispatcher hands out due stamps inside the sending window, so the
     fixture does too: 9am plus a slot, capped inside the day. */
  const slotAt = (dayOffset: number, index: number) => {
    const at = new Date();
    at.setDate(at.getDate() + dayOffset);
    at.setHours(9, 0, 0, 0);
    at.setMinutes(index * 11);
    return at.toISOString();
  };
  let bulkId = 0;
  for (let day = 0; day < QUEUE_DAYS; day += 1) {
    /* Today is deliberately at its email cap, so Move to top has a full day
       to displace out of. */
    const emails = day === 0 ? DAY_EMAIL_CAP : 12 + (day % 7);
    const messages = day === 0 ? DAY_MESSAGE_CAP : 14 + (day % 6);
    for (let i = 0; i < emails + messages; i += 1) {
      const isEmail = i < emails;
      const company = bulkCompanies[bulkId % bulkCompanies.length];
      const person = `${bulkFirst[bulkId % bulkFirst.length]} ${bulkLast[(bulkId >> 1) % bulkLast.length]}`;
      bulkId += 1;
      sends.sends.push({
        id: `q${bulkId}`,
        batch_id: `qb${day}`,
        kind: isEmail ? "email" : "message",
        subject: isEmail ? `A working demo for ${company}` : null,
        note: `Hey ${person.split(" ")[0]},\n\nWe put ${company}'s checkout through a pass and filmed what it does on a slow connection. Short clip, real data.\n\nWorth a look?\n\nBest,\nAayush`,
        attachment_slug: null,
        lead: lead(person, bulkRoles[bulkId % bulkRoles.length], company),
        status: "pending", error: null, error_class: null,
        due_at: slotAt(day, i),
        projected_date: localDateAhead(day),
        created_at: hoursAgo(20 + day),
        sending_account: namedSenders
          ? isEmail
            ? `outbound${(bulkId % 3) + 1}@example.test`
            : `${viewer.name ?? "you"} on LinkedIn`
          : null,
      });
    }
  }
  sends.total = sends.sends.length;
  sends.counts.pending = sends.sends.filter((row) => row.status === "pending").length;
  // GET /sends mirrors the real endpoint's contract: view=sent serves the
  // delivered ledger with server-side kind filtering + newest/oldest order,
  // and both views carry kind_counts (the census behind the filter chips,
  // kind-filter- and pagination-independent).
  const kindCensus = (rows: { kind: string }[]) => {
    const census: Record<string, number> = {};
    for (const row of rows) census[row.kind] = (census[row.kind] ?? 0) + 1;
    return census;
  };
  const sendsApi = (_init?: RequestInit, url?: string) => {
    const params = new URL(url ?? "", location.origin).searchParams;
    /* Nothing queued and nothing sent, so Queue and Sent are both empty. */
    if (mockMode === "library-only")
      return { sends: [], total: 0, limit: 100, offset: 0, counts: { pending: 0, pending_sends: 0, pending_system: 0, sent: 0 }, kind_counts: {} };
    if (params.get("view") !== "sent")
      return {
        ...sends,
        // due_at asc is the send order the real endpoint returns, so fixture
        // order never has to be kept by hand.
        sends: [...sends.sends].sort((a, b) => a.due_at.localeCompare(b.due_at)),
        kind_counts: kindCensus(sends.sends),
      };
    const kind = params.get("kind");
    const rows = sentLedger
      .filter((row) => kind === null || row.kind === kind)
      .sort((a, b) =>
        params.get("order") === "oldest"
          ? a.sent_at.localeCompare(b.sent_at)
          : b.sent_at.localeCompare(a.sent_at),
      );
    return {
      sends: rows, total: rows.length, limit: 100, offset: 0,
      counts: { ...sends.counts, sent: sentLedger.length },
      kind_counts: kindCensus(sentLedger),
    };
  };
  // Bodies may be functions of the request init so POST results can echo the
  // request (e.g. cancel reports how many ids it was sent).
  const cancelSends = (init?: RequestInit) => {
    let n = 0;
    try {
      const parsed = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { send_ids?: unknown[] };
      n = Array.isArray(parsed.send_ids) ? parsed.send_ids.length : 0;
    } catch { /* malformed body — report 0 canceled */ }
    return { canceled: n, skipped: [], agent_woken: true };
  };
  const dismissSends = (init?: RequestInit) => {
    let n = 0;
    try {
      const parsed = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { send_ids?: unknown[] };
      n = Array.isArray(parsed.send_ids) ? parsed.send_ids.length : 0;
    } catch { /* malformed body — report 0 dismissed */ }
    return { dismissed: n, skipped: [] };
  };
  /* The queue controls and the staging pin are being added on the backend. By
     default they answer 404 here, which is what the page meets in prod today
     and what makes it say "Not available yet." beside the control; `?queueops=1`
     turns them on so the flows can be driven end to end. */
  const queueOpsLive = params.get("queueops") === "1";
  const notBuiltYet = (path: string) =>
    new Response(
      JSON.stringify({ error: { code: "not_found", detail: `Nothing serves ${path} yet.` } }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  /* One send: Send next moves it to the front of the due order, Hold and
     Resume flip the row's own flag, Pull takes it out of the queue. */
  const sendOpApi = (_init?: RequestInit, url?: string) => {
    const path = new URL(url ?? "", location.origin).pathname;
    const [, sendId, action] = /\/sends\/([^/]+)\/([^/]+)$/.exec(path) ?? [];
    if (!sendId || !action) return notBuiltYet(path);
    if (!queueOpsLive) return notBuiltYet(path);
    const row = sends.sends.find((send) => send.id === sendId);
    if (!row)
      return new Response(JSON.stringify({ error: { detail: "That send is gone." } }), { status: 404 });
    if (action === "hold") { row.held = true; return { id: row.id, held: true }; }
    if (action === "resume") { row.held = false; return { id: row.id, held: false }; }
    if (action === "send-next") {
      /* The real rule, mirrored: the row takes the first slot of today, today
         is bounded by the daily cap for its channel, so the day's last row of
         that channel moves to the next day, and that cascades while the next
         day is full too. The response names what moved, which is what the
         toast reads. */
      const capFor = (kind: string) => (kind === "email" ? DAY_EMAIL_CAP : DAY_MESSAGE_CAP);
      const onDay = (day: string, kind: string) =>
        sends.sends
          .filter((send) => send.projected_date === day && send.kind === kind && send.status === "pending")
          .sort((a, b) => a.due_at.localeCompare(b.due_at));
      const soonest = sends.sends.reduce((min, send) => (send.due_at < min ? send.due_at : min), row.due_at);
      const fromDay = row.projected_date;
      row.due_at = new Date(Date.parse(soonest) - 60_000).toISOString();
      row.projected_date = localDateAhead(0);
      row.held = false;
      const displaced: Array<Record<string, unknown>> = [];
      let dayIndex = 0;
      while (dayIndex < QUEUE_DAYS) {
        const day = localDateAhead(dayIndex);
        const rows = onDay(day, row.kind);
        if (rows.length <= capFor(row.kind)) break;
        const last = rows[rows.length - 1];
        if (last.id === row.id) break;
        const nextDay = localDateAhead(dayIndex + 1);
        last.projected_date = nextDay;
        last.due_at = slotAt(dayIndex + 1, onDay(nextDay, row.kind).length);
        displaced.push({
          id: last.id,
          name: last.lead?.name ?? null,
          company: last.lead?.company ?? null,
          projected_date: nextDay,
        });
        dayIndex += 1;
      }
      return { id: row.id, due_at: row.due_at, moved_from: fromDay, displaced };
    }
    if (action === "pull") {
      sends.sends = sends.sends.filter((send) => send.id !== sendId);
      sends.total = Math.max(0, sends.total - 1);
      sends.counts.pending = Math.max(0, sends.counts.pending - 1);
      return { id: sendId, pulled: true };
    }
    return notBuiltYet(path);
  };
  const holdAllApi = () => {
    if (!queueOpsLive) return notBuiltYet("/api/v1/dashboard/sends/hold-all");
    sends.sends.forEach((send) => { if (send.status === "pending") send.held = true; });
    return { held: sends.sends.filter((send) => send.held).length };
  };
  const resumeAllApi = () => {
    if (!queueOpsLive) return notBuiltYet("/api/v1/dashboard/sends/resume-all");
    sends.sends.forEach((send) => { send.held = false; });
    return { resumed: sends.sends.length };
  };
  /* Pin keeps one demo in Staging past the 3-day expiry, and unpin is the way
     back out. Both answer here, so the pair can be driven end to end. */
  const pinReviewApi = (_init?: RequestInit, url?: string) => {
    const path = new URL(url ?? "", location.origin).pathname;
    if (!queueOpsLive || !(path.endsWith("/pin") || path.endsWith("/unpin")))
      return notBuiltYet(path);
    return { pinned: path.endsWith("/unpin") ? false : true };
  };
  const approvalStorageKey = "driftwood.dashboard.mock-approval-policy";
  const decisionStorageKey = "driftwood.dashboard.mock-review-decisions";
  /* Who approves. `?approval=auto` and `?approval=manual` set it outright and
     beat anything the approvals UI saved, so both halves of the Demos page
     (the cards, and the one line that replaces them) are one URL apart.
     Without the param: manual on a customer workspace, so Staging has cards
     to show, and auto in `?mock=admin`, where Driftwood is the reviewer and
     the internal queue is what is being looked at. */
  const approvalParam = params.get("approval");
  const explicitApproval: ApprovalMode | null =
    approvalParam === "auto" ? "auto" : approvalParam === "manual" ? "manual" : null;
  let approvalPolicy: ApprovalPolicy = {
    mode: explicitApproval ?? (mockMode === "admin" ? "auto" : "manual"),
    campaign_reviewers: {},
    version: 1,
  };
  try { const saved = sessionStorage.getItem(approvalStorageKey); if (saved && !explicitApproval) approvalPolicy = parsePolicy(JSON.parse(saved)); } catch { /* Use the explicit fixture default. */ }
  const reviewCampaign = (id: string) => ["r1", "r4"].includes(id) ? "founder-led-qa" : id === "r2" ? "expansion-outreach" : null;
  const isOutreachReview = (kind: string) => ["send_email", "send_message", "send_connection", "send_x_dm"].includes(kind);
  const reviewPermissions = (row: typeof reviews.pending[number]) => {
    const reviewer = isOutreachReview(row.kind) ? reviewerFor(approvalPolicy,reviewCampaign(row.id)) : "driftwood";
    return {campaign_id:reviewCampaign(row.id),reviewer,can_decide:mockMode !== "member" && (mockMode === "admin" ? reviewer === "driftwood" : reviewer === "customer"),approval_policy_version:approvalPolicy.version};
  };
  let savedDecisions: Array<{item_id:string;decision:string}> = [];
  const applyMockDecision = (id: string, decision: string) => {
    const row = reviews.pending.find((item) => item.id === id);
    if (!row || row.status !== "pending") return false;
    row.status = decision === "approve" ? "approved" : "denied";
    if (decision === "approve" && isOutreachReview(row.kind)) {
      /* An approved demo joins the END of the queue: the dispatcher gives it
         the first day that still has room on its channel, which is what the
         "Queued for Tuesday" toast reads back. */
      const kind = row.kind === "send_email" ? "email" : row.kind === "send_connection" ? "connection_request" : "message";
      const cap = kind === "email" ? DAY_EMAIL_CAP : DAY_MESSAGE_CAP;
      const usedOn = (day: number) =>
        sends.sends.filter((send) => send.projected_date === localDateAhead(day) && send.kind === kind && send.status === "pending").length;
      let last = 0;
      for (let day = 0; day <= QUEUE_DAYS + 1; day += 1)
        if (sends.sends.some((send) => send.projected_date === localDateAhead(day) && send.status === "pending")) last = day;
      const landing = usedOn(last) < cap ? last : last + 1;
      const landingDate = localDateAhead(landing);
      const slot = sends.sends.filter((send) => send.projected_date === landingDate && send.status === "pending").length;
      sends.sends.push({id:`approved-${row.id}`,batch_id:row.batch_id,kind,subject:row.subject,note:row.body,attachment_slug:row.attachment_slug,lead:row.lead,status:"pending",error:null,error_class:null,due_at:slotAt(landing,slot),projected_date:landingDate,created_at:new Date().toISOString()});
      sends.counts.pending += 1; sends.total += 1;
    }
    return true;
  };
  try { const stored = JSON.parse(sessionStorage.getItem(decisionStorageKey) ?? "[]"); if (Array.isArray(stored)) savedDecisions = stored.filter((row) => typeof row?.item_id === "string" && ["approve","deny"].includes(row.decision)); } catch { /* No stored fixture decisions. */ }
  savedDecisions.forEach((row) => applyMockDecision(row.item_id,row.decision));
  const approvalPolicyApi = (init?:RequestInit) => {
    if ((init?.method ?? "GET") === "GET") return approvalPolicy;
    if (mockMode === "member") return new Response(JSON.stringify({error:{detail:"Only owners and admins can change approvals."}}),{status:403});
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    if (body.expected_version !== approvalPolicy.version) return new Response(JSON.stringify({error:{detail:"Approval settings changed. Reload before saving."}}),{status:409});
    let next: ApprovalPolicy;
    try { next = parsePolicy({...body,version:approvalPolicy.version+1}); } catch { return new Response(JSON.stringify({error:{detail:"Invalid approval settings."}}),{status:422}); }
    sessionStorage.setItem(approvalStorageKey,JSON.stringify(next)); approvalPolicy = next;
    return approvalPolicy;
  };
  const pendingReviewsApi = (_init?:RequestInit,url?:string) => {
    const query = new URL(url ?? location.href,location.href).searchParams;
    const offset = Number(query.get("offset") ?? 0), limit = Number(query.get("limit") ?? 100);
    /* The library-only workspace has nothing pending: that is the whole point
       of the fixture. */
    const pending = mockMode === "library-only" ? [] : reviews.pending.filter((row) => row.status === "pending");
    return {...reviews,pending:pending.slice(offset,offset+limit).map((row) => ({...row,...reviewPermissions(row)})),total_pending:pending.length,offset,limit};
  };
  const decideReviews = (init?: RequestInit) => {
    const parsed = JSON.parse(typeof init?.body === "string" ? init.body : "[]") as Array<{item_id:string;decision:string}>;
    const headers = new Headers(init?.headers);
    if (!Array.isArray(parsed)) return new Response(JSON.stringify({error:{detail:"Choose pending messages."}}),{status:422});
    if (mockMode === "member" || (mockMode !== "admin" && parsed.some((d) => {
      const row=reviews.pending.find((r) => r.id === d.item_id);
      return !row || !reviewPermissions(row).can_decide;
    }))) return new Response(JSON.stringify({error:{detail:"These messages are assigned to Driftwood for review."}}),{status:403});
    if (mockMode !== "admin" && headers.get("If-Match") !== String(approvalPolicy.version)) return new Response(JSON.stringify({error:{detail:"Approval settings changed. Refresh Pending before approving."}}),{status:409});
    let approved=0,denied=0; const skipped:string[]=[];
    for (const d of parsed) {
      if (!["approve","deny"].includes(d.decision) || !applyMockDecision(d.item_id,d.decision)) {skipped.push(d.item_id);continue;}
      savedDecisions.push(d); if (d.decision === "approve") approved++; else denied++;
    }
    sessionStorage.setItem(decisionStorageKey,JSON.stringify(savedDecisions));
    return {approved,denied,skipped,queued:approved ? [`${approved} messages queued`] : [],agent_woken:true};
  };
  // /api/v1/admin/probes/dashboard deliberately mocks a 404, not data: that
  // exercises the SEO/GEO page's run-zero empty state (its launch state)
  // through the real no-data code path, without the network-error console
  // noise an actually-missing backend would add.
  const probesNotFound = () =>
    new Response(JSON.stringify({ detail: "no probe runs yet" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  const status = (
    whats_happening: string,
    outcome: string,
    next_action: string,
    steps: { text: string; status: string; evidence?: string }[],
    latest_output: { title: string; summary: string; url: string } | null = null,
    needs_human: (string | { id?: string; kind?: string; question: string; url?: string; link_label?: string; options?: { id: string; label: string; consequence?: string }[] })[] = [],
  ) => ({
    state: needs_human.length
      ? "waiting_for_review"
      : steps.length > 0 && steps.every((step) => step.status === "done")
        ? "complete"
        : steps.some((step) => step.status === "blocked")
          ? "blocked"
          : "running",
    whats_happening,
    goals: [{
      id: outcome.toLowerCase().replace(/\W+/g, "-").slice(0, 48), outcome, status: "active", priority: "P1",
      // A calendar date, exactly as the update_status tool requires it.
      deadline: dateAhead(1),
      next_action, steps,
    }],
    needs_human, subagents: [], latest_output,
  });
  const agentDashboard = {
    refreshed_at: new Date().toISOString(),
    agents: [
      {
        agent_id: "autosana", paused: false, customer_health: 3, is_running: true,
        attention_required: true, attention_reasons: [],
        current_assignment: "Report target review, bug hunts, demo readiness, and blockers from current pipeline data.",
        status: status(
          "It has 35 demo runs ready, but work is stalled until you review its target batches and roughly 107 pending connections.",
          "Keep the target-review and bug-hunt pipeline moving",
          "Run bug hunts on the targets Aayush approves",
          [
            { text: "Publish the daily pipeline checkpoint", status: "done", evidence: "35 take-ready runs" },
            { text: "Review the pending target batches", status: "blocked" },
            { text: "Run bug hunts on approved targets", status: "todo" },
          ],
          { title: "Taste re-screen", summary: "Promoted and maybe companies awaiting review.", url: "https://driftwood.sh/d/autosana-taste-rescreen" },
          [
            { id: "target-batches", kind: "review", question: "Approve or reject the pending target batches.", url: "https://driftwood.sh/d/autosana-taste-rescreen", link_label: "Open target review" },
            {
              id: "sprocket-breakaway", kind: "decision",
              question: "Sprocket Sports and BreakAway Data look strong — add both to this week's wave?",
              options: [
                { id: "both", label: "Add both", consequence: "Connection requests queue tonight" },
                { id: "hold", label: "Hold for now", consequence: "They stay in the sourcing list" },
              ],
            },
            { id: "stale-batch", kind: "question", question: "The oldest connection batch is 10 days old — drop it or send as-is?" },
          ],
        ),
        status_updated_at: hoursAgo(0.3), last_activity_at: hoursAgo(0.05),
      },
      {
        agent_id: "autosana_demo", paused: false, customer_health: 3, is_running: false,
        attention_required: true, attention_reasons: ["Started a turn hours ago and never reported finishing"], current_assignment: null,
        status: status(
          "Its warm outreach wave cannot start because LinkedIn is disconnected.",
          "Submit the warm wave after LinkedIn reconnects", "Recheck LinkedIn",
          [{ text: "Reconnect LinkedIn", status: "blocked" }, { text: "Submit the warm wave", status: "todo" }],
          null, [{ id: "reconnect-linkedin", kind: "question", question: "Reconnect LinkedIn for this account?" }],
        ),
        status_updated_at: hoursAgo(3), last_activity_at: hoursAgo(3),
      },
      {
        agent_id: "cyberneticphysics", paused: false, customer_health: 3, is_running: false,
        attention_required: true, attention_reasons: [], current_assignment: null,
        status: status(
          "The corrected robot comparison is finished and waiting for your review.",
          "Deliver the corrected robot comparison", "Collect review feedback",
          [{ text: "Restore all three opening swings", status: "done" }, { text: "Review the corrected cut", status: "blocked" }],
          { title: "Ngannou robot side-by-side", summary: "Corrected cut with all three swings.", url: "https://driftwood.sh/d/cyberneticphysics-ngannou-ko-sbs" },
          [{ id: "robot-video", kind: "review", question: "Review the corrected side-by-side.", url: "https://driftwood.sh/d/cyberneticphysics-ngannou-ko-sbs", link_label: "Open video", options: [{ id: "approve", label: "Good to send", consequence: "Goes to the customer today" }, { id: "another-pass", label: "One more pass", consequence: "Agent does another round first" }] }],
        ),
        status_updated_at: hoursAgo(22), last_activity_at: hoursAgo(22),
      },
      {
        agent_id: "driftwood", paused: false, customer_health: 3, is_running: false,
        attention_required: true, attention_reasons: [], current_assignment: null,
        status: status(
          "It stopped sourcing to avoid duplicates because roughly 449 outreach items are already in your review queue.",
          "Keep the connection-request queue supplied without duplicates", "Wait for review backlog to clear",
          [{ text: "Verify the review backlog", status: "done" }, { text: "Review existing outreach waves", status: "blocked" }],
          null, ["Review the existing outreach waves."],
        ),
        status_updated_at: hoursAgo(8), last_activity_at: hoursAgo(8),
      },
      {
        agent_id: "gracegong", paused: false, customer_health: 3, is_running: false,
        attention_required: false, attention_reasons: [], current_assignment: null,
        status: status(
          "It finished the hosted outreach brief and has nothing else assigned.",
          "Finish the hosted outreach brief", "No next action until redirected",
          [{ text: "Publish the hosted brief", status: "done" }, { text: "Apply the show-not-tell revision", status: "done" }],
          { title: "Grace Gong outreach brief", summary: "The hosted full draft.", url: "https://driftwood.sh/d/smartventure-truell-brief" },
        ),
        status_updated_at: hoursAgo(26), last_activity_at: hoursAgo(26),
      },
      {
        agent_id: "madhumita_krishnan", paused: true, customer_health: 2, is_running: false,
        attention_required: false, attention_reasons: [], current_assignment: null,
        status: status("Paused with no assignment in flight.", "Await the next assignment", "Resume when restored", []),
        status_updated_at: hoursAgo(48), last_activity_at: hoursAgo(48),
      },
      {
        agent_id: "oruk", paused: false, customer_health: 3, is_running: true,
        attention_required: false, attention_reasons: [],
        current_assignment: "Redo the remaining demos with a verified Oruk emotion tag for every caption cue.",
        status: status(
          "It is actively rebuilding caption demos. Disney and Paramount passed; Comcast and the remaining cuts are in progress.",
          "Rebuild every demo with verified Oruk emotion tags", "Finish Comcast and the remaining rebuilds",
          [
            { text: "Pass Disney and Paramount strict QA", status: "done", evidence: "Disney 21/21; Paramount 22/22" },
            { text: "Finish Comcast and remaining rebuilds", status: "doing" },
            { text: "Update the action-items artifact", status: "todo" },
          ],
          { title: "Oruk action items", summary: "Standing review surface for the caption rebuilds.", url: "https://driftwood.sh/d/oruk-action-items" },
        ),
        status_updated_at: hoursAgo(0.1), last_activity_at: hoursAgo(0.01),
      },
    ],
  };
  // A second goal on a no-ask agent, so the card's goals-list state (shown
  // when nothing waits on the founder) is visible with canned data.
  agentDashboard.agents
    .find((agent) => agent.agent_id === "oruk")
    ?.status.goals.push({
      id: "hit-100-caption-demos", outcome: "Hit 100 caption demos this week", status: "active", priority: "P2",
      deadline: dateAhead(5),
      next_action: "Queue the next batch after the emotion-tag rebuilds",
      steps: [
        { text: "Ship the first 40 demos", status: "done" },
        { text: "Ship the remaining 60", status: "doing" },
      ],
    });
  // One canned exchange, close to what a real founder channel holds: prose,
  // a Slack-syntax link, and a mention the page has to unwrap.
  const conversationLog = [
    { role: "founder", text: "we need to get something out to nathan tonight", at: 5.5 },
    {
      role: "agent",
      text: "Plan for tonight, working now: fix Zootopia and Studio first, since they unlock the six send-ready rows that already have verified captions. ETA about 40 minutes for both.",
      at: 5.4,
    },
    { role: "founder", text: "why is the ETA so long? should be 20 minutes max if you run them in parallel", at: 4.2 },
    {
      role: "agent",
      text: "Fair push. The caption edit itself is minutes; the rest was product-side QA I was serialising for no good reason. Running them in parallel now.",
      at: 4.1,
    },
    {
      role: "agent",
      text: "All four demos are rebuilt and republished with your tags verbatim. Latest cut is up at <https://driftwood.sh/d/oruk-caption-demos|the demo page> if you want to check before it goes out.",
      at: 0.6,
    },
    { role: "founder", text: "Flash should not have a disappointed tag. otherwise ready to send", at: 0.2 },
  ];
  const answerAsks = (init?: RequestInit, url?: string) => {
    const agentId = decodeURIComponent(url?.match(/\/agents\/([^/]+)\/asks/)?.[1] ?? "");
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    const agent = agentDashboard.agents.find((row) => row.agent_id === agentId);
    const slugs = (body.answers ?? []).map((a: { slug: string }) => a.slug);
    if (agent?.status) {
      agent.status.needs_human = agent.status.needs_human.filter(
        (need) => typeof need === "string" || !slugs.includes(need.id ?? ""),
      );
    }
    return (body.answers ?? []).map((a: { slug: string; text: string }) => ({
      slug: a.slug, state: "resolved", resolved_by: "founder", answer: a.text,
    }));
  };
  const conversation = (init?: RequestInit, url?: string) => {
    const agentId = decodeURIComponent(url?.match(/\/agents\/([^/]+)\/conversation/)?.[1] ?? "oruk");
    const agent = agentDashboard.agents.find((row) => row.agent_id === agentId);
    if (url?.includes("/backfill")) return { agent_id: agentId, scanned: 200, imported: 167 };
    if (init?.method === "POST") {
      const body = JSON.parse(typeof init.body === "string" ? init.body : "{}");
      conversationLog.push({ role: "founder", text: String(body.text ?? ""), at: 0 });
    }
    return {
      agent_id: agentId,
      paused: Boolean(agent?.paused),
      online: !agent?.paused,
      can_send: true,
      has_more: true,
      oldest_at: hoursAgo(conversationLog[0].at),
      messages: conversationLog.map((row, index) => ({
        id: `m${index}`,
        role: row.role,
        text: row.text,
        source: "slack",
        created_at: hoursAgo(row.at),
      })),
    };
  };
  const mutateAgent = (init?: RequestInit, url?: string) => {
    if (url?.includes("/asks/answers")) return answerAsks(init, url);
    if (url?.includes("/conversation")) return conversation(init, url);
    const match = url?.match(/\/api\/v1\/admin\/agents\/([^/]+)\/(pause|health)$/);
    if (!match) return {};
    const agent = agentDashboard.agents.find((row) => row.agent_id === decodeURIComponent(match[1]));
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    if (agent && match[2] === "pause") agent.paused = Boolean(body.paused);
    if (agent && match[2] === "health") agent.customer_health = Number(body.score);
    return { agent_id: agent?.agent_id, paused: agent?.paused, customer_health: agent?.customer_health };
  };
  type MockCampaignContact = {
    id: string; name: string; company: string; role: string; stage: string;
    selected: boolean; selectable: boolean; enrollment_status: string | null;
    current_step: number | null; next_action_at: string | null;
  };
  const mockCampaignContacts: MockCampaignContact[] = [
    ["c78e9104-eedd-4962-8779-d6ba9541da19", "Mara Okafor", "Ternary Labs", "VP Operations"],
    ["235d4c45-7d22-4498-b252-2a673a390e39", "Anika Shah", "Northstar Health", "Head of QA"],
    ["4238a3f1-b9d2-4b12-9eb0-b491bc0c9ecb", "Luca Moretti", "Clearline", "Founder"],
    ["64d728a7-cd39-4758-99cb-6d319f5c517f", "Ines Duarte", "Relayworks", "Product lead"],
    ["20f90c58-aa21-4c24-a7f8-aae18c1b4bf8", "Owen Brooks", "Juniper Systems", "Engineering director"],
    ["69fac83b-6ce8-472f-a095-a1ca4a4ff680", "Nadia Rahman", "Fieldnote", "COO"],
  ].map(([id, name, company, role], index) => ({
    id, name, company, role, stage: "new", selected: index < 3, selectable: true,
    enrollment_status: index < 3 ? "draft" : null, current_step: null, next_action_at: null,
  }));
  type MockCampaign = {
    id: string; series_id: string; version: number; name: string; description: string;
    audience_name: string; audience_id: string | null; lock_version: number;
    status: string; step_count: number; contact_count: number;
    created_at: string; updated_at: string; steps: Record<string, unknown>[];
    contacts: MockCampaignContact[];
  };
  const campaignSummary = (campaign: MockCampaign) => ({
    id: campaign.id, series_id: campaign.series_id, version: campaign.version,
    name: campaign.name, description: campaign.description, audience_name: campaign.audience_name,
    audience_id: campaign.audience_id, lock_version: campaign.lock_version,
    status: campaign.status, step_count: campaign.steps.length,
    contact_count: campaign.contacts.filter((contact) => contact.selected).length,
    created_at: campaign.created_at, updated_at: campaign.updated_at,
  });
  const mockCampaigns: MockCampaign[] = [{
    id: "founder-led-qa",
    series_id: "8f909c22-8785-4877-a1ae-cc659b389de3",
    version: 1,
    name: "Founder-led QA teams",
    description: "Lead with a tailored workflow demo, then follow up on LinkedIn.",
    audience_name: "Qualified QA leaders",
    audience_id: "audience-qualified-qa",
    lock_version: 0,
    status: "draft",
    step_count: 2,
    contact_count: 3,
    created_at: hoursAgo(72),
    updated_at: hoursAgo(1),
    steps: [
      {
        id: "0b088b8b-cbc8-40fe-b167-59d2e80db846", position: 1, kind: "email",
        label: "Tailored intro", subject: "Built this for {{company}}",
        body: "Hi {{first_name}},\n\nI put together a short, tailored look at how this could work for {{company}}.",
        delay_days: 0, send_window: "business-hours", stop_on_reply: true, attachment_slug: null,
      },
      {
        id: "2d095dbf-517f-43df-87f7-b09fc96de314", position: 2, kind: "wait",
        label: "Wait", subject: null, body: "", delay_days: 3,
        send_window: "business-hours", stop_on_reply: false, attachment_slug: null,
      },
    ],
    contacts: mockCampaignContacts,
  }, {
    // Paused fixture: resuming it previews an overlap with the active
    // "Expansion outreach" campaign below (Ines Duarte and Owen Brooks).
    id: "warm-intro-revival",
    series_id: "3d1a06a4-19cf-4f2a-9f8e-1f0a3f6f9c21",
    version: 1,
    name: "Warm intro revival",
    description: "Follow up with product leaders who went quiet after the first touch.",
    audience_name: "Product-led teams",
    audience_id: null,
    lock_version: 2,
    status: "paused",
    step_count: 2,
    contact_count: 3,
    created_at: hoursAgo(120),
    updated_at: hoursAgo(6),
    steps: [
      {
        id: "8f4de0cb-6cf0-4a34-9f0f-6a4f6f5cfd1a", position: 1, kind: "email",
        label: "Reintro email", subject: "Picking this back up for {{company}}",
        body: "Hi {{first_name}},\n\nCircling back with the tailored walkthrough I promised for {{company}}.",
        delay_days: 0, send_window: "business-hours", stop_on_reply: true, attachment_slug: null,
      },
      {
        id: "b0a4c7de-30a4-4f56-8e0e-2a7f3c1d9b42", position: 2, kind: "wait",
        label: "Wait", subject: null, body: "", delay_days: 4,
        send_window: "business-hours", stop_on_reply: false, attachment_slug: null,
      },
    ],
    contacts: mockCampaignContacts.map((contact, index) => ({
      ...contact,
      selected: index >= 3,
      enrollment_status: index >= 3 ? "waiting" : null,
      current_step: index >= 3 ? 1 : null,
      next_action_at: null,
    })),
  }, {
    id: "expansion-outreach",
    series_id: "5be0f7d3-4a91-4dd1-a2b4-8c50c3f8ab77",
    version: 1,
    name: "Expansion outreach",
    description: "Active sequence for operations leaders at growth-stage teams.",
    audience_name: "Operations leaders",
    audience_id: null,
    lock_version: 3,
    status: "active",
    step_count: 1,
    contact_count: 2,
    created_at: hoursAgo(96),
    updated_at: hoursAgo(2),
    steps: [
      {
        id: "e1c9a2f6-7b8d-4c3e-9a51-0d2f4b6c8e13", position: 1, kind: "email",
        label: "Send email", subject: "An operations idea for {{company}}",
        body: "Hi {{first_name}},\n\nSharing a short workflow idea built around {{company}}.",
        delay_days: 0, send_window: "business-hours", stop_on_reply: true, attachment_slug: null,
      },
    ],
    contacts: mockCampaignContacts.map((contact, index) => ({
      ...contact,
      selected: index === 3 || index === 4,
      enrollment_status: index === 3 || index === 4 ? "ready" : null,
      current_step: index === 3 || index === 4 ? 1 : null,
      next_action_at: index === 3 || index === 4 ? hoursAgo(-4) : null,
    })),
  }];
  const mockFixtureCampaignIds = new Set(mockCampaigns.map((campaign) => campaign.id));
  const mockCampaignStorageKey = "driftwood.dashboard.mock-campaigns";
  /* Created campaigns must survive the full-document navigation from "New
     campaign" into the builder (create -> redirect -> reload resets the
     in-memory store, and the builder would show "Campaign not found").
     sessionStorage is the primary home: per-tab, gone when the demo tab
     closes (the mock-mode.ts pattern). But automation browsers — the kind
     scripted demos and baked marketing shots actually run in — reset
     sessionStorage on EVERY document load, which is exactly the create
     redirect. So each persist also mirrors to localStorage stamped with a
     save time, and hydration falls back to that copy only while it is
     fresh. Hydration re-persists, so the stamp rolls forward as long as
     the demo keeps navigating, while a stray demo campaign still cannot
     leak into next week's pristine default view. */
  const mockCampaignFallbackMaxAgeMs = 10 * 60 * 1000;
  const readStoredMockCampaigns = (): MockCampaign[] => {
    try {
      const raw = sessionStorage.getItem(mockCampaignStorageKey);
      if (raw !== null) return JSON.parse(raw) as MockCampaign[];
    } catch {
      try { sessionStorage.removeItem(mockCampaignStorageKey); } catch { /* unreadable AND unremovable: nothing left to do */ }
    }
    try {
      const raw = localStorage.getItem(mockCampaignStorageKey);
      if (raw === null) return [];
      const parsed = JSON.parse(raw) as { saved_at?: unknown; campaigns?: unknown };
      if (
        typeof parsed.saved_at !== "number" ||
        Date.now() - parsed.saved_at > mockCampaignFallbackMaxAgeMs ||
        !Array.isArray(parsed.campaigns)
      ) {
        localStorage.removeItem(mockCampaignStorageKey);
        return [];
      }
      return parsed.campaigns as MockCampaign[];
    } catch {
      try { localStorage.removeItem(mockCampaignStorageKey); } catch { /* same */ }
      return [];
    }
  };
  const persistMockCampaigns = () => {
    const created = mockCampaigns.filter((campaign) => !mockFixtureCampaignIds.has(campaign.id));
    // Guarded independently: either store may be blocked (Safari private
    // mode) — the preview stays usable, only reload persistence is lost.
    try {
      sessionStorage.setItem(mockCampaignStorageKey, JSON.stringify(created));
    } catch { /* ignore */ }
    try {
      localStorage.setItem(
        mockCampaignStorageKey,
        JSON.stringify({ saved_at: Date.now(), campaigns: created }),
      );
    } catch { /* ignore */ }
  };
  let hydratedStoredCampaign = false;
  for (const campaign of readStoredMockCampaigns()) {
    if (
      campaign && typeof campaign.id === "string" &&
      Array.isArray(campaign.steps) && Array.isArray(campaign.contacts) &&
      !mockCampaigns.some((item) => item.id === campaign.id)
    ) {
      mockCampaigns.unshift(campaign);
      hydratedStoredCampaign = true;
    }
  }
  if (hydratedStoredCampaign) persistMockCampaigns();
  const demoRequests = new Map<string, Array<{id:string;status:string;lead_count:number;error:null}>>();
  const campaignsApi = (init?: RequestInit, url?: string) => {
    const method = init?.method ?? "GET";
    const pathname = new URL(url ?? location.href, location.href).pathname;
    const suffix = pathname.replace("/api/v1/dashboard/campaigns", "").replace(/^\//, "");
    const [encodedId, action] = suffix.split("/");
    if (!encodedId) {
      if (method === "POST") {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        const audienceId = typeof body.audience_id === "string" ? body.audience_id : null;
        const audience = mockAudiences.find((item) => item.id === audienceId);
        const selectedLeadIds = new Set(
          audience?.members
            .filter((member) => member.outreach_eligible)
            .map((member) => member.lead_id) ?? [],
        );
        const now = new Date().toISOString();
        const id = crypto.randomUUID();
        const campaign: MockCampaign = {
          id, series_id: crypto.randomUUID(), version: 1,
          name: String(body.name ?? "Untitled campaign") === "Untitled campaign" && audience
            ? `${audience.name} campaign`
            : String(body.name ?? "Untitled campaign"),
          description: "Build a deliberate sequence for a focused group of leads.",
          audience_name: audience?.name ?? "Choose an audience",
          audience_id: audience?.id ?? null,
          lock_version: 0,
          status: "draft", step_count: 2, contact_count: selectedLeadIds.size,
          created_at: now, updated_at: now,
          steps: [
            {
              id: crypto.randomUUID(), position: 1, kind: "email", label: "Send email",
              subject: "A quick idea for {{company}}",
              body: "Hi {{first_name}},\n\nI put together a short, tailored look at how this could work for {{company}}.",
              delay_days: 0, send_window: "business-hours", stop_on_reply: true, attachment_slug: null,
            },
            {
              id: crypto.randomUUID(), position: 2, kind: "wait", label: "Wait", subject: null,
              body: "", delay_days: 3, send_window: "business-hours", stop_on_reply: false,
              attachment_slug: null,
            },
          ],
          contacts: mockCampaignContacts.map((contact) => ({
            ...contact,
            selected: selectedLeadIds.has(contact.id),
            enrollment_status: selectedLeadIds.has(contact.id) ? "draft" : null,
            current_step: null,
            next_action_at: null,
          })),
        };
        mockCampaigns.unshift(campaign);
        persistMockCampaigns();
        return campaign;
      }
      return { campaigns: mockCampaigns.map(campaignSummary) };
    }
    const id = decodeURIComponent(encodedId);
    const campaign = mockCampaigns.find((row) => row.id === id);
    if (!campaign) return new Response(JSON.stringify({ error: { detail: "Campaign not found" } }), { status: 404, headers: { "Content-Type": "application/json" } });
    if (action === "demo-requests") {
      if (method === "GET") return demoRequests.get(id) ?? [];
      if (mockMode === "member") return new Response(null,{status:403});
      const body=JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      const result={id:crypto.randomUUID(),status:"queued",lead_count:body.lead_ids.length,error:null};
      demoRequests.set(id,[result,...(demoRequests.get(id) ?? [])]);return result;
    }
    if (method === "GET" && action === "contacts") {
      const query = new URL(url ?? location.href, location.href).searchParams;
      const search = (query.get("q") ?? "").trim().toLowerCase();
      const limit = Math.max(1, Number(query.get("limit") ?? 50));
      const offset = Math.max(0, Number(query.get("offset") ?? 0));
      const contacts = search
        ? campaign.contacts.filter((contact) =>
          [contact.name, contact.company, contact.role].some((value) => value.toLowerCase().includes(search)),
        )
        : campaign.contacts;
      return {
        contacts: contacts.slice(offset, offset + limit),
        total: contacts.length,
        limit,
        offset,
      };
    }
    const activeOverlaps = () => {
      const selectedIds = new Set(
        campaign.contacts.filter((contact) => contact.selected).map((contact) => contact.id),
      );
      const conflicts = mockCampaigns.flatMap((other) => {
        if (other.id === campaign.id || other.status !== "active") return [];
        return other.contacts.flatMap((contact) =>
          contact.selected && selectedIds.has(contact.id)
            ? [{
              lead_id: contact.id,
              lead_name: contact.name,
              campaign_id: other.id,
              campaign_name: other.name,
            }]
            : [],
        );
      });
      return {
        lead_count: new Set(conflicts.map((conflict) => conflict.lead_id)).size,
        campaign_count: new Set(conflicts.map((conflict) => conflict.campaign_id)).size,
        conflicts,
      };
    };
    if (method === "GET" && action === "overlaps") return activeOverlaps();
    if (method === "PUT") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      campaign.name = String(body.name ?? campaign.name);
      campaign.description = String(body.description ?? campaign.description);
      campaign.audience_name = String(body.audience_name ?? campaign.audience_name);
      campaign.audience_id = typeof body.audience_id === "string" ? body.audience_id : null;
      campaign.lock_version += 1;
      campaign.steps = (body.steps ?? []).map((step: Record<string, unknown>, index: number) => ({ ...step, position: index + 1 }));
      const selectedIds = new Set<string>(body.lead_ids ?? []);
      campaign.contacts = campaign.contacts.map((contact) => ({
        ...contact, selected: selectedIds.has(contact.id),
        enrollment_status: selectedIds.has(contact.id) ? "draft" : null,
      }));
      campaign.updated_at = new Date().toISOString();
      persistMockCampaigns();
      return campaign;
    }
    if (method === "POST" && action === "activate") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      const confirmed = new Set<string>(body.confirmed_overlap_lead_ids ?? []);
      const overlaps = activeOverlaps();
      if (overlaps.conflicts.some((conflict) => !confirmed.has(conflict.lead_id))) {
        return new Response(
          JSON.stringify({ error: { code: "campaign_lead_overlap", detail: "Confirm the active campaign overlap before continuing." } }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      campaign.status = "active";
      campaign.lock_version += 1;
      campaign.contacts = campaign.contacts.map((contact) => ({
        ...contact,
        enrollment_status: contact.selected ? "ready" : null,
        current_step: contact.selected ? 1 : null,
        next_action_at: contact.selected ? new Date().toISOString() : null,
      }));
      campaign.updated_at = new Date().toISOString();
      persistMockCampaigns();
      return { campaign, outreach_queued: false, message: "Campaign version frozen. No outreach was queued or sent." };
    }
    if (method === "POST" && (action === "pause" || action === "resume")) {
      if (action === "resume") {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        const confirmed = new Set<string>(body.confirmed_overlap_lead_ids ?? []);
        const overlaps = activeOverlaps();
        if (overlaps.conflicts.some((conflict) => !confirmed.has(conflict.lead_id))) {
          return new Response(
            JSON.stringify({ error: { code: "campaign_lead_overlap", detail: "Confirm the active campaign overlap before continuing." } }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
        }
      }
      campaign.status = action === "pause" ? "paused" : "active";
      campaign.updated_at = new Date().toISOString();
      persistMockCampaigns();
      return campaign;
    }
    if (method === "POST" && action === "revisions") {
      const revision: MockCampaign = JSON.parse(JSON.stringify(campaign));
      revision.id = crypto.randomUUID();
      revision.version += 1;
      revision.status = "draft";
      revision.lock_version = 0;
      revision.created_at = new Date().toISOString();
      revision.updated_at = revision.created_at;
      revision.steps = revision.steps.map((step) => ({ ...step, id: crypto.randomUUID() }));
      revision.contacts = revision.contacts.map((contact) => ({
        ...contact, enrollment_status: contact.selected ? "draft" : null,
        current_step: null, next_action_at: null,
      }));
      mockCampaigns.unshift(revision);
      persistMockCampaigns();
      return revision;
    }
    return campaign;
  };
  type MockAsset = {
    id: string; kind: "image" | "video" | "audio" | "link" | "skill" | "repo"; name: string; description: string;
    tags: string[]; original_filename: string | null; content_type: string | null;
    byte_size: number | null; external_url: string | null; content_url: string | null;
    created_at: string; updated_at: string;
    assignment_mode: "all" | "selected"; assigned_agent_ids: string[];
  };
  const mockAssetAgents = [
    { id: "outbound", label: "Outbound agent", paused: false },
    { id: "demo", label: "Demo agent", paused: false },
    { id: "research", label: "Research agent", paused: true },
  ];
  const assetPreview = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='720' height='420' viewBox='0 0 720 420'%3E%3Crect width='720' height='420' fill='%23eaf1f7'/%3E%3Cpath d='M0 330L190 170l108 96 105-82 317 236H0z' fill='%2315557e' opacity='.72'/%3E%3Ccircle cx='555' cy='100' r='40' fill='%23fff' opacity='.8'/%3E%3C/svg%3E";
  const mockAssets: MockAsset[] = [
    { id: "asset-messaging", kind: "video", name: "Messaging walkthrough", description: "Public Driftwood site clip showing the messaging workflow.", tags: ["product"], original_filename: "compare.mp4", content_type: "video/mp4", byte_size: 1093813, external_url: null, content_url: "/compare.mp4", created_at: hoursAgo(72), updated_at: hoursAgo(4), assignment_mode: "all", assigned_agent_ids: [] },
    { id: "asset-product", kind: "image", name: "Product workflow", description: "Approved overview visual for outbound demos.", tags: ["product", "approved"], original_filename: "workflow.png", content_type: "image/png", byte_size: 184200, external_url: null, content_url: assetPreview, created_at: hoursAgo(72), updated_at: hoursAgo(4), assignment_mode: "all", assigned_agent_ids: [] },
    { id: "asset-proof", kind: "link", name: "Enterprise customer story", description: "Use when a prospect asks for implementation proof.", tags: ["proof", "enterprise"], original_filename: null, content_type: null, byte_size: null, external_url: "https://driftwood.sh/", content_url: null, created_at: hoursAgo(96), updated_at: hoursAgo(28), assignment_mode: "selected", assigned_agent_ids: ["outbound", "demo"] },
    { id: "asset-skill", kind: "skill", name: "Demo recording", description: "How to record a product demo from a prospect's app.", tags: ["skill"], original_filename: "demo-recording.zip", content_type: "application/zip", byte_size: 24576, external_url: null, content_url: "/api/v1/dashboard/assets/asset-skill/content", created_at: hoursAgo(48), updated_at: hoursAgo(48), assignment_mode: "all", assigned_agent_ids: [] },
    { id: "asset-repo", kind: "repo", name: "Example app", description: "The product the agent demos. Clone before a walkthrough.", tags: ["code"], original_filename: null, content_type: null, byte_size: null, external_url: "https://github.com/example/example-app", content_url: null, created_at: hoursAgo(40), updated_at: hoursAgo(40), assignment_mode: "all", assigned_agent_ids: [] },
  ];
  const assetError = (detail: string, status = 422) =>
    new Response(JSON.stringify({ detail }), { status, headers: { "Content-Type": "application/json" } });
  const assetsApi = (init?: RequestInit, url?: string) => {
    const method = init?.method ?? "GET";
    const pathname = new URL(url ?? location.href, location.href).pathname;
    const suffix = pathname.replace("/api/v1/dashboard/assets", "").replace(/^\//, "");
    if (suffix === "agents" && method === "GET") return { agents: mockAssetAgents };
    const assignmentMatch = suffix.match(/^([^/]+)\/assignments$/);
    if (assignmentMatch && method === "PUT") {
      const asset = mockAssets.find((item) => item.id === decodeURIComponent(assignmentMatch[1]));
      if (!asset) return new Response(JSON.stringify({ detail: "Asset not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      asset.assignment_mode = body.assignment_mode === "selected" ? "selected" : "all";
      asset.assigned_agent_ids = asset.assignment_mode === "all" ? [] : Array.isArray(body.agent_ids) ? body.agent_ids : [];
      asset.updated_at = new Date().toISOString();
      return asset;
    }
    if (!suffix && method === "GET") return { assets: mockAssets };
    if (suffix === "link" && method === "POST") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      const now = new Date().toISOString();
      const linkKind = body.kind === "repo" ? "repo" : "link";
      if (linkKind === "repo" && !String(body.url).startsWith("https://")) return assetError("A repository link must start with https://.");
      const asset: MockAsset = { id: crypto.randomUUID(), kind: linkKind, name: String(body.name), description: String(body.description ?? ""), tags: Array.isArray(body.tags) ? body.tags : [], original_filename: null, content_type: null, byte_size: null, external_url: String(body.url), content_url: null, created_at: now, updated_at: now, assignment_mode: "all", assigned_agent_ids: [] };
      mockAssets.unshift(asset);
      return asset;
    }
    if (suffix === "upload" && method === "POST") {
      const form = init?.body instanceof FormData ? init.body : new FormData();
      const file = form.get("file");
      const now = new Date().toISOString();
      const isFile = file instanceof File;
      /* Mirrors the backend: archives and markdown must say skill or repo;
         media must not. */
      const fileClass = isFile ? uploadKindFor(file.name) : "media";
      const askedKind = form.get("kind");
      const skillOrRepo = askedKind === "skill" || askedKind === "repo" ? askedKind : null;
      if (fileClass !== "media" && !skillOrRepo) return assetError("Choose whether this file is a skill or a repository.");
      if (fileClass === "media" && askedKind !== null) return assetError("A media file does not take a kind.");
      const kind = skillOrRepo ?? (isFile && file.type.startsWith("audio/")
        ? "audio"
        : isFile && file.type.startsWith("video/")
          ? "video"
          : "image");
      const contentType = !isFile ? null : file.type || (fileClass === "markdown" ? "text/markdown" : file.name.toLowerCase().endsWith(".zip") ? "application/zip" : fileClass === "archive" ? "application/gzip" : null);
      const asset: MockAsset = { id: crypto.randomUUID(), kind, name: String(form.get("name") || (isFile ? file.name : "Uploaded asset")), description: String(form.get("description") ?? ""), tags: String(form.get("tags") ?? "").split(",").map((tag) => tag.trim()).filter(Boolean), original_filename: isFile ? file.name : null, content_type: contentType, byte_size: isFile ? file.size : null, external_url: null, content_url: isFile ? URL.createObjectURL(file) : null, created_at: now, updated_at: now, assignment_mode: "all", assigned_agent_ids: [] };
      mockAssets.unshift(asset);
      return asset;
    }
    if (method === "DELETE") {
      const index = mockAssets.findIndex((asset) => asset.id === decodeURIComponent(suffix));
      if (index >= 0) {
        const [removed] = mockAssets.splice(index, 1);
        if (removed.content_url?.startsWith("blob:")) URL.revokeObjectURL(removed.content_url);
      }
      return {};
    }
    return { assets: mockAssets };
  };
  const metricPeople = [
    { lead_id: "lead-1", name: "Mara Okafor", title: "VP Operations", email: "mara@example.test", company_name: "Ternary Labs", channel: "email", status: "contacted", occurred_at: hoursAgo(30), source: "confirmed_send" },
    { lead_id: "lead-2", name: "Anika Shah", title: "Head of QA", email: "anika@example.test", company_name: "Northstar Health", channel: "linkedin", status: "contacted", occurred_at: hoursAgo(28), source: "confirmed_send" },
    { lead_id: "lead-3", name: "Luca Moretti", title: "Founder", email: "luca@example.test", company_name: "Clearline", channel: "email", status: "contacted", occurred_at: hoursAgo(26), source: "confirmed_send" },
    { lead_id: "lead-4", name: "Ines Duarte", title: "Product lead", email: "ines@example.test", company_name: "Relayworks", channel: "linkedin", status: "contacted", occurred_at: hoursAgo(24), source: "confirmed_send" },
    { lead_id: "lead-5", name: "Owen Brooks", title: "Engineering director", email: "owen@example.test", company_name: "Juniper Systems", channel: "linkedin", status: "contacted", occurred_at: hoursAgo(20), source: "confirmed_send" },
    { lead_id: "lead-6", name: "Nadia Rahman", title: "COO", email: "nadia@example.test", company_name: "Fieldnote", channel: "x", status: "contacted", occurred_at: hoursAgo(18), source: "confirmed_send" },
    { lead_id: "lead-1", name: "Mara Okafor", title: "VP Operations", email: "mara@example.test", company_name: "Ternary Labs", channel: "email", status: "replied", occurred_at: hoursAgo(3), source: "email_reply", reply_subject: "Re: quick idea for Ternary", reply_text: "This is timely, actually. Can you send the deck and a couple times for Thursday?" },
    { lead_id: "lead-2", name: "Anika Shah", title: "Head of QA", email: "anika@example.test", company_name: "Northstar Health", channel: "linkedin", status: "replied", occurred_at: hoursAgo(9), source: "linkedin_reply", reply_text: "Interesting — how does this handle flaky device farms?" },
    { lead_id: "lead-4", name: "Ines Duarte", title: "Product lead", email: "ines@example.test", company_name: "Relayworks", channel: "email", status: "replied", occurred_at: hoursAgo(5), source: "email_reply", reply_subject: "Automatic reply: quick idea for Relayworks", reply_text: "I am out of the office until Monday, September 7, with limited access to email. For urgent matters contact ops@relayworks.test.", reply_is_automatic: true, reply_auto_reason: 'subject says "automatic reply"' },
    { lead_id: "lead-5", name: "Owen Brooks", title: "Engineering director", email: "owen@example.test", company_name: "Juniper Systems", channel: "email", status: "replied", occurred_at: hoursAgo(12), source: "email_reply", reply_subject: "Re: quick idea for Juniper", reply_text: "Owen is no longer with the company. Please direct product inquiries to engineering@juniper.test.", reply_is_automatic: true, reply_auto_reason: 'mentions "no longer with the company"' },
    { lead_id: "lead-3", name: "Luca Moretti", title: "Founder", email: "luca@example.test", company_name: "Clearline", channel: "email", status: "demos_booked", occurred_at: hoursAgo(26), source: "lead_stage" },
    /* These two carry the lead ids the delivered ledger uses, so the Demos
       page's Sent segment has a Replied badge to show on two of its rows. */
    { lead_id: "Dana Whitfield", name: "Dana Whitfield", title: "VP Ops", email: "dana@example.test", company_name: "Meridian", channel: "email", status: "replied", occurred_at: hoursAgo(24), source: "email_reply", reply_subject: "Re: same-day booking fix", reply_text: "Good catch. Can you send the repro to our platform lead?" },
    { lead_id: "Jordan Reyes", name: "Jordan Reyes", title: "Head of Growth", email: "jordan@example.test", company_name: "Brex", channel: "linkedin", status: "replied", occurred_at: hoursAgo(44), source: "linkedin_reply", reply_text: "This is useful. What would the rollout look like for us?" },
  ];
  const channelMetricsApi = (_init?: RequestInit, url?: string) => {
    const query = new URL(url ?? location.href, location.href).searchParams;
    const status = query.get("status") ?? "replied";
    const channel = query.get("channel");
    const people = metricPeople.filter((person) => person.status === status && (!channel || person.channel === channel));
    return {
      window: { start: query.get("start"), end: query.get("end") },
      channels: [
        { channel: "linkedin", contacted: { count: 3, available: true }, opened: { count: null, available: false }, clicked: { count: null, available: false }, replied: { count: 2, available: true }, demos_booked: { count: 0, available: true } },
        { channel: "email", contacted: { count: 2, available: true }, opened: { count: null, available: false }, clicked: { count: null, available: false }, replied: { count: 4, available: true }, demos_booked: { count: 1, available: true } },
        { channel: "x", contacted: { count: 1, available: true }, opened: { count: null, available: false }, clicked: { count: null, available: false }, replied: { count: null, available: false }, demos_booked: { count: 0, available: true } },
      ],
      definitions: [
        { id: "contacted", label: "Contacted", available: true, definition: "Distinct leads with a confirmed outbound send.", note: null },
        { id: "opened", label: "Opened", available: false, definition: "Distinct leads with a provider open event.", note: "Provider open events are not stored yet." },
        { id: "clicked", label: "Clicked", available: false, definition: "Distinct leads with a provider click event.", note: "Provider click events are not stored yet." },
        { id: "replied", label: "Replied", available: true, definition: "Distinct leads matched to an inbound reply.", note: null },
        { id: "demos_booked", label: "Demos booked", available: true, definition: "Distinct booked leads attributed to the latest prior send.", note: null },
      ],
      people,
      people_status: status,
      people_channel: channel,
      people_total: people.length,
      limit: 100,
      offset: 0,
      unmatched_replies: { linkedin: 0, email: 0, x: 0 },
      unattributed_demos_booked: 0,
    };
  };
  type MockLead = {
    id: string; name: string; company: string; company_id: string; title: string;
    email: string | null; linkedin_url: string; stage: string; origin: string;
    source: string; audiences: string[]; demo_idea: string | null;
    demo_artifact_id: string | null; created_at: string; updated_at: string;
  };
  const mockLeads: MockLead[] = mockCampaignContacts.map((contact, index) => ({
    id: contact.id,
    name: contact.name,
    company: contact.company,
    company_id: `company-${index + 1}`,
    title: contact.role,
    email: `${contact.name.toLowerCase().replace(/\s+/g, ".")}@example.test`,
    linkedin_url: `https://www.linkedin.com/in/${contact.name.toLowerCase().replace(/\s+/g, "-")}`,
    stage: contact.stage,
    origin: "generated",
    source: index < 3 ? "orange-slice:ocean" : "workspace",
    audiences: index < 3 ? ["Qualified QA leaders"] : index === 3 ? ["Product-led teams"] : [],
    demo_idea: null,
    demo_artifact_id: null,
    created_at: hoursAgo(48 + index),
    updated_at: hoursAgo(2 + index),
  }));
  const leadImportsApi = (init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "POST") return { detail: "Method not allowed" };
    const form = init?.body instanceof FormData ? init.body : null;
    const file = form?.get("file");
    if (!(file instanceof File)) {
      return new Response(JSON.stringify({ detail: "Choose a CSV file." }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    }
    const typedName = form?.get("audience_name");
    // A typed name beats the filename-derived default, like the real API.
    const audienceName =
      typeof typedName === "string" && typedName.trim()
        ? typedName.trim()
        : mockAudienceNameFromFile(file.name);
    const existing = mockAudiences.find(
      (item) => item.source_provider === "csv_upload" && item.name === audienceName,
    );
    const result = mockLeadImportResult(
      file.name,
      existing ? { id: existing.id, memberCount: existing.members.length } : null,
    );
    const now = new Date().toISOString();
    if (existing) {
      existing.updated_at = now;
      return result;
    }
    const id = crypto.randomUUID();
    const lead: MockLead = {
      id,
      name: "Camille Rivera",
      company: "Atlas Relay",
      company_id: `company-${id}`,
      title: "Revenue operations lead",
      email: `camille.rivera.${id.slice(0, 6)}@example.test`,
      linkedin_url: "https://www.linkedin.com/in/camille-rivera",
      stage: "new",
      origin: "uploaded",
      source: "uploaded:csv",
      audiences: [audienceName],
      demo_idea: null,
      demo_artifact_id: null,
      created_at: now,
      updated_at: now,
    };
    mockLeads.push(lead);
    summary.lists.leads = mockLeads.length;
    mockAudiences.unshift({
      id: result.audience.id,
      name: audienceName,
      description: `Imported from ${file.name}`,
      source_provider: "csv_upload",
      discovery_filters: {},
      members: [memberFromLead(lead)],
      created_at: now,
      updated_at: now,
    });
    return result;
  };
  const dashboardLeadsApi = (init?: RequestInit, url?: string) => {
    const method = init?.method ?? "GET";
    const parsed = new URL(url ?? location.href, location.href);
    const suffix = parsed.pathname.replace("/api/v1/dashboard/leads", "").replace(/^\//, "");
    if (method === "DELETE" && suffix) {
      const index = mockLeads.findIndex((item) => item.id === decodeURIComponent(suffix));
      if (index >= 0) mockLeads.splice(index, 1);
      return { lead_id: suffix, blacklisted: true };
    }
    const limit = Math.max(1, Number(parsed.searchParams.get("limit") ?? 25));
    const offset = Math.max(0, Number(parsed.searchParams.get("offset") ?? 0));
    return { leads: mockLeads.slice(offset, offset + limit), total: mockLeads.length, limit, offset };
  };
  const mockCompanies = mockCampaignContacts.map((contact, index) => ({
    id: `company-${index + 1}`,
    name: contact.company,
    domain: `${contact.company.toLowerCase().replace(/\s+/g, "")}.example`,
    linkedin_slug: null,
    icp_status: "qualified",
    disqualify_reason: null,
    qa_headcount: null,
    employee_count: 80 + index * 25,
    funding_stage: index < 3 ? "Series A" : "Seed",
    location: "United States",
    source: index < 3 ? "orange-slice:ocean" : "workspace",
    lead_count: 1,
    contacted_lead_count: index < 3 ? 1 : 0,
    last_sent_at: index < 3 ? hoursAgo(6 + index * 3) : null,
    last_verified_at: hoursAgo(24 + index),
    created_at: hoursAgo(72 + index),
    updated_at: hoursAgo(4 + index),
  }));
  const dashboardCompaniesApi = (init?: RequestInit, url?: string) => {
    const method = init?.method ?? "GET";
    const parsed = new URL(url ?? location.href, location.href);
    const suffix = parsed.pathname.replace("/api/v1/dashboard/companies", "").replace(/^\//, "");
    if (method === "DELETE" && suffix) {
      const index = mockCompanies.findIndex((item) => item.id === decodeURIComponent(suffix));
      if (index >= 0) mockCompanies.splice(index, 1);
      return { company_id: suffix, blacklisted_contacts: 1 };
    }
    const status = parsed.searchParams.get("icp_status");
    const filtered = status ? mockCompanies.filter((item) => item.icp_status === status) : mockCompanies;
    const limit = Math.max(1, Number(parsed.searchParams.get("limit") ?? 25));
    const offset = Math.max(0, Number(parsed.searchParams.get("offset") ?? 0));
    return { companies: filtered.slice(offset, offset + limit), total: filtered.length, limit, offset };
  };
  type MockAudience = {
    id: string; name: string; description: string; source_provider: string; source_kind?: string; tags?: string[];
    discovery_filters: Record<string, string>; members: Array<{
      lead_id: string; name: string; title: string; company: string;
      email: string | null; linkedin_url: string; stage: string; contactable: boolean;
      outreach_eligible: boolean;
    }>; created_at: string; updated_at: string;
  };
  const audienceSummary = (audience: MockAudience) => ({
    id: audience.id,
    name: audience.name,
    description: audience.description,
    source_provider: audience.source_provider,
    source_kind: audience.source_kind ?? (audience.source_provider === "csv_upload" ? "uploaded" : "other"),
    tags: audience.tags ?? [],
    member_count: audience.members.length,
    created_at: audience.created_at,
    updated_at: audience.updated_at,
  });
  const memberFromLead = (item: MockLead) => ({
    lead_id: item.id, name: item.name, title: item.title, company: item.company,
    email: item.email, linkedin_url: item.linkedin_url, stage: item.stage,
    contactable: true, outreach_eligible: true,
  });
  const mockAudiences: MockAudience[] = [{
    id: "audience-qualified-qa",
    name: "Qualified QA leaders",
    source_kind: "curated", tags: ["QA", "High intent"],
    description: "QA and operations leaders at teams with a live release workflow.",
    source_provider: "orange_slice",
    discovery_filters: { prompt: "QA and operations leaders at teams with a live release workflow" },
    members: mockLeads.slice(0, 3).map(memberFromLead),
    created_at: hoursAgo(72),
    updated_at: hoursAgo(2),
  }, {
    id: "audience-product-led",
    name: "Product-led teams",
    source_kind: "campaign", tags: ["Product-led"],
    description: "Product leaders evaluating a hands-on launch workflow.",
    source_provider: "workspace",
    discovery_filters: { prompt: "Product leaders evaluating a hands-on QA workflow" },
    members: [memberFromLead(mockLeads[3])],
    created_at: hoursAgo(120),
    updated_at: hoursAgo(24),
  }];
  const discoveryCandidates = [
    { provider_record_id: "orange-person-1", lead_id: null, name: "Talia Morgan", title: "VP Quality", company: "Proofline", email: null, linkedin_url: "https://www.linkedin.com/in/talia-morgan", stage: "new" },
    { provider_record_id: "orange-person-2", lead_id: null, name: "Ravi Menon", title: "Director of Engineering", company: "SignalNest", email: null, linkedin_url: "https://www.linkedin.com/in/ravi-menon", stage: "new" },
    { provider_record_id: "orange-person-3", lead_id: null, name: "Elena Park", title: "Founder", company: "Releasewise", email: null, linkedin_url: "https://www.linkedin.com/in/elena-park", stage: "new" },
  ];
  /* QA knobs for the audiences surface (additive, dev/preview only):
     - ?audlat=1500       delays every audiences/import response by that many ms
                          (drive skeletons and the search narration)
     - ?auderr=<op>       forces that operation to fail with a 502 —
                          ops: list, detail, discover, save, similar, grow,
                          rename, delete, upload
     - ?audempty=1        the library lists no audiences (empty state) */
  const AUD_LATENCY = Math.max(0, Number(params.get("audlat") ?? 0));
  const AUD_ERR = params.get("auderr");
  const AUD_EMPTY = params.get("audempty") === "1";
  const audKnob = (op: string, make: () => unknown): unknown => {
    const value =
      AUD_ERR === op
        ? new Response(
            JSON.stringify({ error: { detail: `Mock failure for "${op}" (auderr=${op}).` } }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          )
        : make();
    if (!AUD_LATENCY) return value;
    return new Promise((resolve) => setTimeout(() => resolve(value), AUD_LATENCY));
  };
  const audienceOp = (init?: RequestInit, url?: string): string => {
    const method = init?.method ?? "GET";
    const pathname = new URL(url ?? location.href, location.href).pathname;
    const suffix = pathname.replace("/api/v1/dashboard/audiences", "").replace(/^\//, "");
    if (suffix === "discovery-status") return "status";
    if (suffix === "discover") return "discover";
    if (suffix.endsWith("/similar")) return "similar";
    if (suffix.endsWith("/grow")) return "grow";
    if (!suffix) return method === "POST" ? "save" : "list";
    if (method === "PATCH") return "rename";
    if (method === "DELETE") return "delete";
    return "detail";
  };
  const audiencesApi = (init?: RequestInit, url?: string) => {
    const method = init?.method ?? "GET";
    const pathname = new URL(url ?? location.href, location.href).pathname;
    const suffix = pathname.replace("/api/v1/dashboard/audiences", "").replace(/^\//, "");
    if (suffix === "discovery-status" && method === "GET") {
      return {
        default_provider: "orange_slice",
        providers: [
          { provider: "orange_slice", label: "Orange Slice", configured: true },
          { provider: "workspace", label: "Workspace leads", configured: true },
        ],
      };
    }
    if (suffix === "discover" && method === "POST") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      if (body.source_provider === "workspace") {
        return {
          provider: "workspace",
          provider_label: "Workspace leads",
          candidates: mockLeads.slice(0, 4).map((lead) => ({
            provider_record_id: lead.id,
            lead_id: lead.id,
            name: lead.name,
            title: lead.title,
            company: lead.company,
            email: lead.email,
            linkedin_url: lead.linkedin_url,
            stage: lead.stage,
          })),
        };
      }
      return { provider: "orange_slice", provider_label: "Orange Slice", candidates: discoveryCandidates };
    }
    if (!suffix && method === "GET") return { audiences: (AUD_EMPTY ? [] : mockAudiences).map(audienceSummary) };
    if (!suffix && method === "POST") {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      const selectedProviderIds = Array.isArray(body.provider_record_ids) ? body.provider_record_ids : [];
      const selectedLeadIds = Array.isArray(body.lead_ids) ? body.lead_ids : [];
      const newlyDiscoveredLeadIds = new Set<string>();
      for (const providerId of selectedProviderIds) {
        const candidate = discoveryCandidates.find((item) => item.provider_record_id === providerId);
        if (!candidate) continue;
        const id = crypto.randomUUID();
        mockLeads.unshift({
          id, name: candidate.name, company: candidate.company, company_id: crypto.randomUUID(),
          title: candidate.title, email: null, linkedin_url: candidate.linkedin_url,
          stage: candidate.stage, origin: "generated", source: "orange-slice:ocean",
          audiences: [], demo_idea: null, demo_artifact_id: null,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        });
        selectedLeadIds.push(id);
        newlyDiscoveredLeadIds.add(id);
      }
      const memberLeads = selectedLeadIds.flatMap((id: string) => {
        const item = mockLeads.find((leadItem) => leadItem.id === id);
        return item ? [item] : [];
      });
      const now = new Date().toISOString();
      const created: MockAudience = {
        id: crypto.randomUUID(), name: String(body.name), description: String(body.description ?? ""),
        source_provider: String(body.source_provider ?? "workspace"),
        discovery_filters: body.discovery_filters ?? {},
        members: memberLeads.map((item: MockLead) => ({
          ...memberFromLead(item),
          outreach_eligible: !newlyDiscoveredLeadIds.has(item.id),
        })),
        created_at: now, updated_at: now,
      };
      for (const item of memberLeads) {
        if (!item.audiences.includes(created.name)) item.audiences.push(created.name);
      }
      mockAudiences.unshift(created);
      return { ...audienceSummary(created), discovery_filters: created.discovery_filters, members: created.members };
    }
    if (suffix.endsWith("/similar")) {
      return {
        provider: "orange_slice",
        provider_label: "Orange Slice",
        candidates: [
          {
            provider_record_id: "sim-1", lead_id: null, name: "Robin Lookalike",
            title: "Fleet Operations Lead", company: "Parallel Rentals",
            company_domain: "parallelrentals.example", email: null,
            linkedin_url: "https://www.linkedin.com/in/robin-lookalike", stage: "new",
          },
          {
            provider_record_id: "sim-2", lead_id: null, name: "Jules Adjacent",
            title: "Head of Growth", company: "Nearmiss Mobility",
            company_domain: "nearmiss.example", email: null,
            linkedin_url: "https://www.linkedin.com/in/jules-adjacent", stage: "new",
          },
        ],
      };
    }
    if (suffix.endsWith("/grow")) {
      const audienceId = decodeURIComponent(suffix.replace(/\/grow$/, ""));
      const audience = mockAudiences.find((item) => item.id === audienceId);
      if (!audience) return {};
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      const ids: string[] = Array.isArray(body.provider_record_ids) ? body.provider_record_ids : [];
      for (const rid of ids) {
        if (audience.members.some((m) => m.linkedin_url?.includes(rid))) continue;
        audience.members.push({
          lead_id: crypto.randomUUID(),
          name: rid === "sim-1" ? "Robin Lookalike" : "Jules Adjacent",
          title: rid === "sim-1" ? "Fleet Operations Lead" : "Head of Growth",
          company: rid === "sim-1" ? "Parallel Rentals" : "Nearmiss Mobility",
          email: null, linkedin_url: `https://mock/${rid}`, stage: "new",
          contactable: true, outreach_eligible: true,
        });
      }
      audience.updated_at = new Date().toISOString();
      return { ...audienceSummary(audience), discovery_filters: audience.discovery_filters, members: audience.members };
    }
    const audienceId = decodeURIComponent(suffix);
    const audience = mockAudiences.find((item) => item.id === audienceId);
    if (method === "PATCH" && audience) {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      if (Array.isArray(body.tags)) audience.tags = [...new Set<string>(body.tags.map((tag: unknown) => String(tag)))];
      if (typeof body.name === "string" && body.name.trim())
        audience.name = body.name.trim();
      if (typeof body.description === "string")
        audience.description = body.description;
      audience.updated_at = new Date().toISOString();
      return { ...audienceSummary(audience), discovery_filters: audience.discovery_filters, members: audience.members };
    }
    if (method === "DELETE") {
      const index = mockAudiences.findIndex((item) => item.id === audienceId);
      if (index >= 0) {
        const [removed] = mockAudiences.splice(index, 1);
        for (const item of mockLeads) item.audiences = item.audiences.filter((name) => name !== removed.name);
      }
      return {};
    }
    return audience ? { ...audienceSummary(audience), discovery_filters: audience.discovery_filters, members: audience.members } : {};
  };

  // --- admin fleet + drift fixtures (mock=admin pages) -----------------------
  const fleetPage = {
    refreshed_at: new Date().toISOString(),
    rows: agentDashboard.agents.map((agent, i) => ({
      customer: {
        user_id: `mock-user-${i}`,
        email: `${agent.agent_id}@example.com`,
        name: agent.agent_id.charAt(0).toUpperCase() + agent.agent_id.slice(1),
        avatar_url: null,
        is_approved: true,
        created_at: new Date(Date.now() - 86400000 * (14 + i)).toISOString(),
      },
      agent,
      agent_slack_channel_id: `C0AGENT${i}`,
      customer_slack_channel_id: `C0CUST${i}`,
      pipeline: { live: 40 - i * 9, contacted: 18 - i * 4, replied: 5 - i, booked: i === 0 ? 2 : 0, pending_reviews: agent.attention_required ? 3 : 0 },
      attention_required: agent.attention_required,
      attention_reasons: agent.attention_required ? ["waiting on founder review"] : [],
    })),
  };
  const driftFlow = {
    task: "behavior_ci_demo",
    stages: [
      { id: "research", name: "Flagship research", sub: "agent browse + judge", gate: true, judge_prefixes: ["official-flagship-robot-research-judge-"], emit_prefixes: ["official-robot-research-"] },
      { id: "accepted", name: "Research accepted", emit_prefixes: ["accepted-research-"] },
      { id: "still", name: "Still generation", gate: true, judge_prefixes: ["still-customization-judge-"] },
      { id: "page", name: "Demo page", gate: true, judge_prefixes: ["demo-page-judge-"] },
      { id: "published", name: "Page published", emit_prefixes: ["demo-page-"], exclude_prefixes: ["demo-page-judge-"] },
    ],
    terminals: {
      done: { label: "done", tone: "good" },
      research_exhausted: { label: "research exhausted", tone: "bad", at: "research" },
      quarantined: { label: "quarantined", tone: "bad", at: "still" },
      runner_error: { label: "runner error", tone: "bad" },
    },
  };
  const driftJudgment = (label: string, passed: boolean | null, minutesAgo: number) => ({
    label, passed, created_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
  });
  const driftRunRows = [
    {
      id: "11111111-1111-4111-8111-111111111111", agent_id: "autosana", task: "behavior_ci_demo",
      state: "done", parameters: { slug: "agility-robotics", company_name: "Agility Robotics" },
      result: { state: "done", demo_url: "https://driftwood.sh/d/mock-demo" },
      created_at: new Date(Date.now() - 7200000).toISOString(), claimed_at: new Date(Date.now() - 7190000).toISOString(),
      started_at: new Date(Date.now() - 7140000).toISOString(), finished_at: new Date(Date.now() - 6870000).toISOString(),
      judgments: [
        driftJudgment("official-robot-research-agility-robotics-transcript", null, 120),
        driftJudgment("official-flagship-robot-research-judge-agility-robotics-scores", false, 118),
        driftJudgment("official-robot-research-agility-robotics-transcript", null, 117),
        driftJudgment("official-flagship-robot-research-judge-agility-robotics-scores", true, 116),
        driftJudgment("accepted-research-agility-robotics", null, 115),
        driftJudgment("still-customization-judge-agility-robotics-scores", true, 114),
        driftJudgment("demo-page-judge-agility-robotics-scores", true, 113),
        driftJudgment("demo-page-agility-robotics", null, 113),
      ],
    },
    {
      id: "22222222-2222-4222-8222-222222222222", agent_id: "autosana", task: "behavior_ci_demo",
      state: "quarantined", parameters: { slug: "zoox", company_name: "Zoox" },
      result: { state: "quarantined" },
      created_at: new Date(Date.now() - 5400000).toISOString(), claimed_at: new Date(Date.now() - 5390000).toISOString(),
      started_at: new Date(Date.now() - 5340000).toISOString(), finished_at: new Date(Date.now() - 4830000).toISOString(),
      judgments: [
        driftJudgment("official-robot-research-zoox-transcript", null, 88),
        driftJudgment("official-flagship-robot-research-judge-zoox-scores", true, 86),
        driftJudgment("accepted-research-zoox", null, 85),
        driftJudgment("still-customization-judge-zoox-scores", false, 83),
        driftJudgment("still-customization-judge-zoox-scores", false, 81),
      ],
    },
    {
      id: "33333333-3333-4333-8333-333333333333", agent_id: "autosana", task: "behavior_ci_demo",
      state: "running", parameters: { slug: "apptronik", company_name: "Apptronik" },
      result: null,
      created_at: new Date(Date.now() - 600000).toISOString(), claimed_at: new Date(Date.now() - 590000).toISOString(),
      started_at: new Date(Date.now() - 540000).toISOString(), finished_at: null,
      judgments: [
        driftJudgment("official-robot-research-apptronik-transcript", null, 6),
        driftJudgment("official-flagship-robot-research-judge-apptronik-scores", true, 4),
      ],
    },
  ];
  const driftOverview = {
    refreshed_at: new Date().toISOString(),
    agents: [
      { agent_id: "autosana", states: { done: 1, quarantined: 1, running: 1 }, total: 3, in_flight: 1 },
      { agent_id: "oruk", states: {}, total: 0, in_flight: 0 },
    ],
    flows: { behavior_ci_demo: driftFlow },
    tasks: ["behavior_ci_demo"],
  };
  const driftAgentRuns = (_init?: RequestInit, url?: string) => {
    const agentId = decodeURIComponent(url?.split("/agents/")[1]?.split("/")[0]?.split("?")[0] ?? "");
    return {
      agent_id: agentId,
      refreshed_at: new Date().toISOString(),
      runs: driftRunRows.filter((r) => r.agent_id === agentId),
    };
  };
  const driftRunDetail = (_init?: RequestInit, url?: string) => {
    const runId = decodeURIComponent(url?.split("/runs/")[1]?.split("?")[0] ?? "");
    const row = driftRunRows.find((r) => r.id === runId);
    if (!row) return {};
    return {
      ...row,
      judgments: row.judgments.map((j) => ({
        ...j,
        detail: j.passed === null ? null : { rows: [{ criterion: "identity", score: "6 (agree)", verdict: j.passed ? "pass" : "fail" }] },
      })),
    };
  };

  // Mirrors the real customer-org shape: an owner, one claimed admin seat,
  // three invited-but-unclaimed seats (no name until first sign-in) covering
  // the invite-email states the Team page renders — one whose email went
  // out, one that never got an email, one resent minutes ago so Resend is
  // refused on the first click — and the auto-join domain set.
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60e3).toISOString();
  type MockMember = {
    membership_id: string | null; email: string; name: string | null; role: string; status: string;
    invited_at: string | null; invite_sent_at: string | null; invite_note: string | null;
  };
  const mockOrg = {
    id: "org-1",
    name: "Example workspace",
    domain: "example.com" as string | null,
    members: [
      { membership_id: "m-1", email: "sam@example.com", name: "Sam Field", role: "admin", status: "active", invited_at: hoursAgo(400), invite_sent_at: hoursAgo(400), invite_note: null },
      { membership_id: "m-2", email: "new-hire@example.com", name: null, role: "member", status: "invited", invited_at: hoursAgo(20), invite_sent_at: hoursAgo(20), invite_note: null },
      { membership_id: "m-3", email: "contractor@example.com", name: null, role: "member", status: "invited", invited_at: hoursAgo(70), invite_sent_at: null, invite_note: null },
      { membership_id: "m-4", email: "priya@example.com", name: "Priya Nair", role: "admin", status: "invited", invited_at: hoursAgo(50), invite_sent_at: minutesAgo(4), invite_note: "Met at the offsite, wants the review queue" },
    ] as MockMember[],
  };
  const orgPage = () => ({
    id: mockOrg.id,
    name: mockOrg.name,
    domain: mockOrg.domain,
    your_role: mockOrgRole,
    members: [
      { membership_id: null, email: "marc@example.com", name: "Marc Andreessen", role: "owner", status: "active", invited_at: null, invite_sent_at: null, invite_note: null },
      ...mockOrg.members,
    ],
  });
  // An address whose local part starts with "noemail" adds the seat but
  // reports that no email went out, the way the backend does when sending
  // is not configured. Everything else sends.
  const addSeat = (body: Record<string, unknown>) => {
    const email = String(body.email ?? "");
    const sent = !email.toLowerCase().startsWith("noemail");
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim() : null;
    const row: MockMember = {
      membership_id: crypto.randomUUID(), email, name,
      role: String(body.role ?? "member"), status: "invited",
      invited_at: new Date().toISOString(), invite_sent_at: sent ? new Date().toISOString() : null,
      invite_note: note,
    };
    mockOrg.members.push(row);
    const receipt = sent ? { email_sent: true } : { email_sent: false, reason: "email sending is not configured" };
    return { row, receipt };
  };
  // Refused inside ten minutes of the last send (429 with a plain message);
  // otherwise the row comes back with a fresh invite_sent_at.
  const resendSeat = (membershipId: string) => {
    const row = mockOrg.members.find((m) => m.membership_id === membershipId);
    if (!row) return new Response(JSON.stringify({ detail: "That seat is no longer on the page." }), { status: 404, headers: { "Content-Type": "application/json" } });
    if (row.status !== "invited") return new Response(JSON.stringify({ detail: "That seat is already claimed." }), { status: 409, headers: { "Content-Type": "application/json" } });
    if (resendWaitMinutes(row.invite_sent_at) !== null) {
      return new Response(JSON.stringify({ detail: resendRefusalMessage(row.invite_sent_at as string) }), { status: 429, headers: { "Content-Type": "application/json" } });
    }
    row.invite_sent_at = new Date().toISOString();
    return row;
  };
  const orgApi = (init?: RequestInit, url?: string) => {
    const method = init?.method ?? "GET";
    const parsed = new URL(url ?? location.href, location.href);
    const path = parsed.pathname;
    if (method === "POST" && path.endsWith("/members")) {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      const { receipt } = addSeat(body);
      return { ...orgPage(), ...receipt };
    }
    if (method === "POST" && path.endsWith("/resend")) {
      const id = decodeURIComponent(path.split("/members/")[1]?.replace(/\/resend$/, "") ?? "");
      return resendSeat(id);
    }
    if (method === "DELETE" && path.includes("/members/")) {
      const id = decodeURIComponent(path.split("/members/")[1] ?? "");
      mockOrg.members = mockOrg.members.filter((m) => m.membership_id !== id);
      return orgPage();
    }
    if (method === "PUT" && path.endsWith("/domain")) {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      mockOrg.domain = typeof body.domain === "string" && body.domain.trim() ? body.domain.trim().toLowerCase() : null;
      return orgPage();
    }
    return orgPage();
  };
  // The workspace send schedule (/dashboard/settings). GET answers the page;
  // PUT /send-schedule saves it and reports a fixed 3 moved sends so the
  // saved note renders. A member gets the backend's 403, and an empty day
  // list or an inverted window its 422.
  const mockSchedule = {
    days: [0, 1, 2, 3, 4],
    start: "09:00",
    end: "18:00",
    tz: "America/Los_Angeles",
    skip_us_holidays: true,
  };
  const settingsPage = (movedSends: number | null) => ({
    send_schedule: { ...mockSchedule, days: [...mockSchedule.days] },
    window_open_now: true,
    next_open_at: "2026-09-11T16:00:00Z",
    upcoming_holidays: [
      { date: "2026-10-12", name: "Columbus Day" },
      { date: "2026-11-11", name: "Veterans Day" },
      { date: "2026-11-26", name: "Thanksgiving" },
    ],
    daily_caps: { email: 20, message: 25, connection_request: 20, x_dm: 5, x_follow: 10 },
    your_role: mockOrgRole,
    moved_sends: movedSends,
  });
  const settingsError = (status: number, code: string, detail: string) =>
    new Response(JSON.stringify({ error: { detail, code } }), { status, headers: { "Content-Type": "application/json" } });
  const settingsApi = (init?: RequestInit) => {
    if ((init?.method ?? "GET") !== "PUT") return settingsPage(null);
    if (mockMode === "member") return settingsError(403, "forbidden", "Only an owner or admin can change the send schedule.");
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    const days: number[] = Array.isArray(body.days) ? body.days.filter((d: unknown) => Number.isInteger(d)) : [];
    if (days.length === 0) return settingsError(422, "invalid_send_schedule", "Pick at least one day.");
    if (typeof body.start !== "string" || typeof body.end !== "string" || body.start >= body.end) {
      return settingsError(422, "invalid_send_schedule", "The window has to close after it opens.");
    }
    mockSchedule.days = days;
    mockSchedule.start = body.start;
    mockSchedule.end = body.end;
    if (typeof body.tz === "string" && body.tz) mockSchedule.tz = body.tz;
    mockSchedule.skip_us_holidays = body.skip_us_holidays === true;
    return settingsPage(3);
  };
  // The admin routes act on the impersonated user's workspace, which in mock
  // mode is this same org. The invite answers with the row plus the receipt.
  const adminInviteApi = (init?: RequestInit, url?: string) => {
    const path = new URL(url ?? location.href, location.href).pathname;
    if ((init?.method ?? "GET") !== "POST" || !path.endsWith("/invite")) return mockBlockedResponse(path);
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
    const { row, receipt } = addSeat(body);
    return { ...row, ...receipt };
  };
  const adminResendApi = (init?: RequestInit, url?: string) => {
    const path = new URL(url ?? location.href, location.href).pathname;
    if ((init?.method ?? "GET") !== "POST" || !path.endsWith("/resend")) return mockBlockedResponse(path);
    const id = decodeURIComponent(path.split("/memberships/")[1]?.replace(/\/resend$/, "") ?? "");
    return resendSeat(id);
  };

  // Triggers (GET/POST /dashboard/triggers, GET/PUT /{id}, POST
  // /{id}/run|pause|resume). Six watches, one per state the pages can
  // show: an active one carrying the line its agent wrote back, one that
  // only adds companies and whose items came from a jobs API pull (so its
  // rows carry the scraper's own keys), a paused one, a web watch that has
  // nothing to do with jobs, one still being built, and one on a source
  // the agent could not read. ?trgempty=1 serves
  // the empty state. Creating a trigger sends one sentence and nothing
  // else; the mock does what the backend does with it — names it, spends
  // twenty seconds working out how to check it, writes the readback and
  // queues the first check. Changing the sentence in Edit puts the trigger
  // back into Building. Writes 403 in ?mock=member, as the backend does.
  const triggersEmpty = params.get("trgempty") === "1";
  type MockRun = {
    id: string; state: string; triggered_by: string;
    // Both spellings ride along while the backend renames postings to items.
    items_seen?: number; items_new?: number; postings_seen?: number; postings_new?: number;
    ids_seen?: number; ids_new?: number;
    error: string | null; created_at: string; started_at: string | null; finished_at: string | null;
  };
  type MockField = { label: string; value: string };
  // Fields arrive either as rows the backend labelled or as the raw object
  // the extraction stored, and the page reads both.
  type MockFields = MockField[] | Record<string, string | number>;
  type MockItem = {
    id: string; source_url: string; entity_name: string; employer_name: string; title: string;
    fields: MockFields; posted_at: string | null; status: string; note: string | null;
    company_id: string | null; lead_id: string | null; demo_url: string | null; created_at: string;
  };
  type MockSchedule = { cadence: string; fire_hour: number; interval_hours: number | null };
  type MockActions = { add_company: boolean; find_contact: boolean; build_demo: boolean; enroll: boolean };
  const defaultActions: MockActions = { add_company: true, find_contact: true, build_demo: true, enroll: false };
  type MockTrigger = {
    id: string; name: string; watch: string | null; summary: string | null;
    cadence: string; fire_hour: number; schedule: MockSchedule;
    pull: { method: string; reason: string | null } | null;
    actions: MockActions;
    campaign_id: string | null; campaign_name: string | null;
    status: string; last_run_at: string | null; last_run_state: string | null;
    created_at: string; updated_at: string | null;
    runs: MockRun[]; items: MockItem[];
  };
  const item = (
    id: string, host: string, entity: string, title: string, fields: MockFields,
    daysAgo: number, status: string, note: string | null, demo: boolean,
  ): MockItem => ({
    id, source_url: `https://${host}/items/${id}`, entity_name: entity, employer_name: entity, title,
    fields, posted_at: hoursAgo(24 * daysAgo + 9), status, note,
    company_id: status === "duplicate" || status === "failed" ? null : `company-${id}`,
    lead_id: ["enrolled", "ready", "demo_pending"].includes(status) ? `lead-${id}` : null,
    demo_url: demo ? `${location.origin}/d/mock-${id}` : null,
    created_at: hoursAgo(24 * daysAgo + 6),
  });
  // What a jobs API pull actually stores on an item: its own bookkeeping
  // first (type, rank, xpath, ids, addresses), then the facts. The page
  // has to skip the first kind and lead with the second. The trigger only
  // adds companies, so no row has a contact or a demo.
  const boardItem = (
    id: string, entity: string, title: string, where: string, salary: string,
    contract: string, ago: string, daysAgo: number, status: string, note: string | null = null,
  ): MockItem => ({
    ...item(id, "www.google.com", entity, title, [], daysAgo, status, note, false),
    lead_id: null,
    fields: {
      type: "google_jobs_item",
      rank_group: 1,
      rank_absolute: Number(id.replace(/\D/g, "")) || 1,
      xpath: "/html[1]/body[1]/div[3]/div[1]/div[13]/div[1]/div[2]/div[1]/div[1]/div[3]",
      employer_name: entity,
      employer_image_url: `https://encrypted-tbn0.gstatic.com/images?q=tbn:${id}`,
      title,
      location: where,
      salary,
      contract_type: contract,
      time_ago: ago,
      source_url: `https://www.google.com/search?ibp=htl;jobs#htivrt=jobs&htidocid=${id}`,
      job_id: `eyJqb2JfdGl0bGUiOiJDYXJlZ2l2ZXIiLCJodGlkb2NpZCI6${id}`,
      timestamp: "2026-09-04 02:07:11 +00:00",
    },
  });
  const mockTriggers: MockTrigger[] = triggersEmpty ? [] : [
    {
      id: "trg-mycnajobs", name: "myCNAjobs",
      watch: "New caregiver and CNA jobs from home care agencies in Atlanta, Phoenix, Dallas, Chicago and Tampa, not hospitals or senior living",
      summary: "Checks mycnajobs.com every night for caregiver and CNA jobs in five metros, skipping hospitals and senior living.",
      cadence: "daily", fire_hour: 2, schedule: { cadence: "daily", fire_hour: 2, interval_hours: null },
      pull: { method: "site", reason: null },
      actions: { add_company: true, find_contact: true, build_demo: true, enroll: true },
      campaign_id: "home-care-intro", campaign_name: "Home care agency intro",
      status: "active", last_run_at: hoursAgo(5), last_run_state: "done",
      created_at: hoursAgo(24 * 13), updated_at: hoursAgo(24 * 13),
      runs: [
        { id: "run-3", state: "done", triggered_by: "schedule", items_seen: 219, items_new: 9, ids_seen: 219, ids_new: 9, error: null, created_at: hoursAgo(5), started_at: hoursAgo(5), finished_at: hoursAgo(4.95) },
        { id: "run-2", state: "done", triggered_by: "schedule", items_seen: 212, items_new: 14, ids_seen: 212, ids_new: 14, error: "The source was slow to respond. We retried once and the check finished.", created_at: hoursAgo(29), started_at: hoursAgo(29), finished_at: hoursAgo(28.9) },
        { id: "run-1", state: "failed", triggered_by: "manual", items_seen: 0, items_new: 0, error: "The source did not load. Nothing was added.", created_at: hoursAgo(53), started_at: hoursAgo(53), finished_at: hoursAgo(52.99) },
        { id: "run-0", state: "done", triggered_by: "setup", items_seen: 203, items_new: 203, ids_seen: 203, ids_new: 203, error: null, created_at: hoursAgo(24 * 13), started_at: hoursAgo(24 * 13), finished_at: hoursAgo(24 * 13 - 0.05) },
      ],
      items: [
        item("p1", "www.mycnajobs.com", "Brightpath Home Care", "Caregiver, part time", [{ label: "Where", value: "Tucson, AZ" }, { label: "Pay", value: "$16 to $19/hr" }], 1, "enrolled", "Dana Whitfield, owner", true),
        item("p2", "www.mycnajobs.com", "Evergreen Senior Home Care", "CNA, weekends", [{ label: "Where", value: "Boise, ID" }, { label: "Pay", value: "$17 to $20/hr" }], 1, "ready", "Marcus Lee, administrator", true),
        item("p3", "www.mycnajobs.com", "Heartland Caregivers of Dayton", "Home health aide", [{ label: "Where", value: "Dayton, OH" }], 1, "duplicate", "In Companies since Aug 22", false),
        item("p4", "www.mycnajobs.com", "Willow Creek In-Home Care", "Live-in caregiver", [{ label: "Where", value: "Fort Collins, CO" }, { label: "Pay", value: "$190 to $220/day" }], 1, "no_lead", null, false),
        // A parse that went wrong: the title came back as a markdown link.
        // The page renders the words and drops the syntax.
        item("p5", "www.mycnajobs.com", "Serenity Home Care Services", "[Skip to main content](https://www.mycnajobs.com/jobs/p5#content)", [{ label: "Where", value: "Chattanooga, TN" }], 2, "demo_pending", null, false),
        item("p6", "www.mycnajobs.com", "Golden Hours Home Care", "Caregiver, full time", [{ label: "Where", value: "Spokane, WA" }], 2, "in_progress", null, false),
        item("p7", "www.mycnajobs.com", "HCA Florida Advanced Cardiothoracic Surgery", "Medical assistant", [{ label: "Where", value: "Belleair Bluffs, FL" }], 2, "dismissed", "Dismissed: this is a hospital surgical practice, not the kind of agency this trigger is watching for, and it hires through its own health system.", false),
        item("p8", "www.mycnajobs.com", "Harbor Light Home Care", "CNA, per diem", [{ label: "Where", value: "Wilmington, NC" }], 3, "new", null, false),
        { ...item("p9", "www.mycnajobs.com", "Riverbend Home Care", "Caregiver, weekends", [], 1, "new", null, false), posted_at: null },
      ],
    },
    {
      id: "trg-boards", name: "Caregiver openings on all job boards",
      watch: "Caregiver and CNA openings from home care agencies on any job board in Texas. Just add the agencies to Companies.",
      summary: "Searches job boards across the web every night for caregiver and CNA openings from home care agencies in Texas, and adds each agency to Companies.",
      cadence: "daily", fire_hour: 2, schedule: { cadence: "daily", fire_hour: 2, interval_hours: null },
      pull: { method: "api", reason: null },
      actions: { add_company: true, find_contact: false, build_demo: false, enroll: false },
      campaign_id: null, campaign_name: null,
      status: "active", last_run_at: hoursAgo(6), last_run_state: "done",
      created_at: hoursAgo(24 * 6), updated_at: hoursAgo(24 * 6),
      runs: [
        // A check scans every listing on the boards and keeps a few: the
        // scan is the Seen column, never the trigger's "found".
        { id: "run-b2", state: "done", triggered_by: "schedule", items_seen: 2095, items_new: 12, ids_seen: 2095, ids_new: 12, error: null, created_at: hoursAgo(6), started_at: hoursAgo(6), finished_at: hoursAgo(5.8) },
        { id: "run-b1", state: "done", triggered_by: "setup", items_seen: 1980, items_new: 58, ids_seen: 1980, ids_new: 58, error: null, created_at: hoursAgo(24 * 6), started_at: hoursAgo(24 * 6), finished_at: hoursAgo(24 * 6 - 0.3) },
      ],
      items: [
        boardItem("b1", "Bluebonnet Home Care", "Caregiver, days", "Plano, TX", "$15 to $17 an hour", "Full-time", "2 days ago", 1, "ready"),
        boardItem("b2", "Lone Star Caregivers", "CNA, overnight", "Fort Worth, TX", "$16 an hour", "Part-time", "2 days ago", 1, "ready"),
        boardItem("b3", "Hill Country In-Home Care", "Personal care aide", "San Antonio, TX", "$14.50 to $16 an hour", "Full-time", "3 days ago", 2, "ready"),
        boardItem("b4", "Prairie Rose Senior Care", "Live-in caregiver", "Lubbock, TX", "$180 a day", "Contract", "3 days ago", 2, "duplicate", "In Companies since Aug 30"),
        boardItem("b5", "Gulf Coast Home Companions", "Companion caregiver, weekends", "Corpus Christi, TX", "$15 an hour", "Part-time", "4 days ago", 3, "ready"),
        boardItem("b6", "Trinity River Home Health", "Home health aide", "Dallas, TX", "$17 to $19 an hour", "Full-time", "4 days ago", 3, "dismissed", "Dismissed: a home health agency that hires nurses, not a caregiver agency."),
        boardItem("b7", "Pecan Valley Caregivers", "Caregiver, evenings", "Waco, TX", "$15.50 an hour", "Part-time", "5 days ago", 4, "ready"),
        boardItem("b8", "Brazos Home Care", "CNA, days", "College Station, TX", "$16 to $18 an hour", "Full-time", "6 hours ago", 0, "new"),
      ],
    },
    {
      id: "trg-funding", name: "Series A raises",
      watch: "Companies that just raised a Series A in climate tech",
      summary: "Searches the web every morning for climate tech companies that announced a Series A in the last week.",
      cadence: "daily", fire_hour: 6, schedule: { cadence: "daily", fire_hour: 6, interval_hours: null },
      pull: { method: "web", reason: null },
      actions: defaultActions,
      campaign_id: null, campaign_name: null,
      status: "paused", last_run_at: hoursAgo(30), last_run_state: "done",
      created_at: hoursAgo(24 * 9), updated_at: hoursAgo(24 * 2),
      runs: [
        { id: "run-f2", state: "done", triggered_by: "schedule", items_seen: 38, items_new: 3, ids_seen: 38, ids_new: 3, error: null, created_at: hoursAgo(30), started_at: hoursAgo(30), finished_at: hoursAgo(29.9) },
        { id: "run-f1", state: "done", triggered_by: "setup", items_seen: 41, items_new: 41, ids_seen: 41, ids_new: 41, error: null, created_at: hoursAgo(24 * 9), started_at: hoursAgo(24 * 9), finished_at: hoursAgo(24 * 9 - 0.1) },
      ],
      items: [
        item("f1", "techcrunch.com", "Verdant Grid", "Raises $18M to put batteries on rural feeders", [{ label: "Round", value: "Series A" }, { label: "Raised", value: "$18M" }], 1, "ready", "Nina Osei, chief executive", true),
        item("f2", "techcrunch.com", "Colddeck Systems", "Series A for warehouse refrigeration retrofits", [{ label: "Round", value: "Series A" }, { label: "Raised", value: "$9.5M" }, { label: "Lead", value: "Fieldstone" }], 2, "enrolled", "Theo Braun, founder", true),
        item("f3", "techcrunch.com", "Marrow Labs", "Seed extension for soil sensing", [{ label: "Round", value: "Seed" }], 3, "dismissed", "Dismissed: a seed extension, and this trigger is watching for Series A rounds only.", false),
      ],
    },
    {
      id: "trg-launches", name: "Competitor launches",
      watch: "New product launches from robotics companies",
      summary: "Searches the web every four hours for product launches from robotics companies.",
      cadence: "every_n_hours", fire_hour: 0, schedule: { cadence: "every_n_hours", fire_hour: 0, interval_hours: 4 },
      pull: { method: "web", reason: null },
      actions: defaultActions,
      campaign_id: null, campaign_name: null,
      status: "active", last_run_at: hoursAgo(3), last_run_state: "done",
      created_at: hoursAgo(24 * 4), updated_at: hoursAgo(24 * 4),
      runs: [
        // The older spelling of the counters, as a row written before the
        // rename would carry it.
        { id: "run-l2", state: "done", triggered_by: "schedule", postings_seen: 63, postings_new: 2, error: null, created_at: hoursAgo(3), started_at: hoursAgo(3), finished_at: hoursAgo(2.9) },
        { id: "run-l1", state: "done", triggered_by: "schedule", postings_seen: 61, postings_new: 0, error: null, created_at: hoursAgo(7), started_at: hoursAgo(7), finished_at: hoursAgo(6.9) },
      ],
      items: [
        item("l1", "robotreport.com", "Kestrel Dynamics", "Launches a warehouse arm with on-board planning", [{ label: "Category", value: "Warehouse" }], 1, "ready", "Priya Natarajan, head of product", true),
        item("l2", "robotreport.com", "Mesa Autonomy", "Ships its outdoor inspection rover", [{ label: "Category", value: "Inspection" }], 1, "in_progress", null, false),
      ],
    },
    {
      id: "trg-building", name: "Small business contracts",
      watch: "New contracts on https://sam.gov for IT services under $500k",
      summary: null,
      cadence: "daily", fire_hour: 2, schedule: { cadence: "daily", fire_hour: 2, interval_hours: null },
      pull: { method: "pending", reason: null },
      actions: defaultActions,
      campaign_id: null, campaign_name: null,
      status: "needs_setup", last_run_at: null, last_run_state: null,
      created_at: hoursAgo(0.4), updated_at: hoursAgo(0.4),
      runs: [], items: [],
    },
    {
      id: "trg-portal", name: "Supplier portal",
      watch: "New tenders on our supplier portal",
      summary: null,
      cadence: "daily", fire_hour: 2, schedule: { cadence: "daily", fire_hour: 2, interval_hours: null },
      pull: { method: "unsupported", reason: "This page asks for a sign-in before it shows anything. Point your agent at a public page instead." },
      actions: defaultActions,
      campaign_id: null, campaign_name: null,
      status: "needs_setup", last_run_at: null, last_run_state: null,
      created_at: hoursAgo(26), updated_at: hoursAgo(26),
      runs: [], items: [],
    },
  ];
  // Created triggers live in sessionStorage so the create -> detail hand-off
  // (a full page load) finds them; fixtures are never stored, so they stay
  // fresh on every load. Per-tab and gone with the tab, like the campaigns.
  const mockTriggerStorageKey = "driftwood.dashboard.mock-triggers";
  const mockFixtureTriggerIds = new Set(mockTriggers.map((trigger) => trigger.id));
  const readStoredMockTriggers = (): MockTrigger[] => {
    try {
      const parsed: unknown = JSON.parse(sessionStorage.getItem(mockTriggerStorageKey) ?? "[]");
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((row): row is MockTrigger =>
        Boolean(row) && typeof row.id === "string" && Array.isArray(row.runs) && Array.isArray(row.items),
      );
    } catch {
      return [];
    }
  };
  const persistMockTriggers = () => {
    try {
      sessionStorage.setItem(
        mockTriggerStorageKey,
        JSON.stringify(mockTriggers.filter((trigger) => !mockFixtureTriggerIds.has(trigger.id))),
      );
    } catch { /* storage blocked (private mode): the preview still works, reload persistence is lost */ }
  };
  mockTriggers.unshift(...readStoredMockTriggers());
  // Both spellings of the counts, as a backend mid-rename carries them.
  const triggerCounts = (trigger: MockTrigger) => {
    const by = (status: string) => trigger.items.filter((row) => row.status === status).length;
    const companies = trigger.items.filter((row) => row.company_id).length;
    return {
      items: trigger.items.length,
      postings: trigger.items.length,
      new: by("new"),
      companies_added: companies,
      agencies_added: companies,
      leads: trigger.items.filter((row) => row.lead_id).length,
      demos: trigger.items.filter((row) => row.demo_url).length,
      enrolled: by("enrolled"),
    };
  };
  // The check the backend starts on its own once a trigger can run: right
  // after the agent has worked out how to check the source.
  const queueSetupRun = (trigger: MockTrigger) => {
    trigger.runs.unshift({
      id: `run-${crypto.randomUUID().slice(0, 8)}`, state: "queued", triggered_by: "setup",
      items_seen: 0, items_new: 0, error: null, created_at: new Date().toISOString(),
      started_at: null, finished_at: null,
    });
    trigger.last_run_state = "queued";
  };
  // A trigger the customer just created (or whose sentence they changed)
  // starts in Building; twenty seconds on, its agent has worked out how to
  // check it and writes the line the customer reads back.
  const settleBuild = (trigger: MockTrigger) => {
    if (trigger.status !== "needs_setup" || trigger.pull?.method !== "pending") return;
    if (mockFixtureTriggerIds.has(trigger.id)) return;
    if (Date.now() - new Date(trigger.updated_at ?? trigger.created_at).getTime() < 20_000) return;
    trigger.status = "active";
    trigger.pull = { method: "site", reason: null };
    const subject = (trigger.watch ?? "new items").replace(/\.+$/, "");
    trigger.summary = `Checks the web every night for ${subject.charAt(0).toLowerCase()}${subject.slice(1)}.`;
    queueSetupRun(trigger);
  };
  const triggerRow = (trigger: MockTrigger) => ({
    id: trigger.id, name: trigger.name, watch: trigger.watch, summary: trigger.summary,
    cadence: trigger.cadence, fire_hour: trigger.fire_hour, schedule: trigger.schedule,
    pull: trigger.pull, actions: trigger.actions,
    campaign_id: trigger.campaign_id, campaign_name: trigger.campaign_name,
    status: trigger.status, last_run_at: trigger.last_run_at, last_run_state: trigger.last_run_state,
    counts: triggerCounts(trigger), created_at: trigger.created_at, updated_at: trigger.updated_at,
  });
  const triggerError = (status: number, code: string, detail: string) =>
    new Response(JSON.stringify({ error: { code, detail } }), { status, headers: { "Content-Type": "application/json" } });
  // Each GET advances an open check one step: queued -> running -> done.
  const advanceRun = (trigger: MockTrigger) => {
    const run = trigger.runs[0];
    if (!run) return;
    const now = new Date().toISOString();
    if (run.state === "queued") {
      run.state = "running";
      run.started_at = now;
      trigger.last_run_state = "running";
    } else if (run.state === "running") {
      run.state = "done";
      run.finished_at = now;
      run.items_seen = 221;
      run.items_new = 1;
      run.ids_seen = 221;
      run.ids_new = 1;
      trigger.last_run_at = now;
      trigger.last_run_state = "done";
      const id = `p-${trigger.runs.length}-${trigger.items.length + 1}`;
      trigger.items.unshift({
        ...item(id, "www.mycnajobs.com", "Cedar Ridge Home Care", "Caregiver, evenings", [{ label: "Where", value: "Reno, NV" }], 0, "new", null, false),
        posted_at: now, created_at: now,
      });
    }
  };
  // The name the backend writes for a new trigger: short, and never the
  // whole sentence.
  const nameTail = new Set(["in", "on", "at", "of", "for", "the", "a", "an", "and", "or", "to", "from", "that", "with", "by"]);
  const mockTriggerName = (watch: string): string => {
    const words = watch.replace(/https?:\/\/\S+/g, "").trim().split(/\s+/).filter(Boolean).slice(0, 4);
    while (words.length > 1 && nameTail.has(words[words.length - 1].toLowerCase().replace(/[.,;:!?]+$/, ""))) words.pop();
    const name = words.join(" ").replace(/[.,;:!?]+$/, "");
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : "New trigger";
  };
  const triggersApi = (init?: RequestInit, url?: string) => {
    const method = init?.method ?? "GET";
    const pathname = new URL(url ?? location.href, location.href).pathname;
    const suffix = pathname.replace("/api/v1/dashboard/triggers", "").replace(/^\//, "");
    const [encodedId, action] = suffix.split("/");
    if (method !== "GET" && mockMode === "member") {
      return triggerError(403, "forbidden", "Only an owner or admin can change triggers.");
    }
    if (!encodedId) {
      if (method === "POST") {
        const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
        const watch = typeof body.watch === "string" ? body.watch.trim() : "";
        if (!watch) return triggerError(422, "invalid", "Say what to watch.");
        const campaign = mockCampaigns.find((row) => row.id === body.campaign_id);
        const now = new Date().toISOString();
        const trigger: MockTrigger = {
          id: `trg-${crypto.randomUUID().slice(0, 8)}`,
          name: mockTriggerName(watch),
          watch,
          summary: null,
          cadence: "daily", fire_hour: 2, schedule: { cadence: "daily", fire_hour: 2, interval_hours: null },
          pull: { method: "pending", reason: null },
          actions: defaultActions,
          campaign_id: campaign?.id ?? null,
          campaign_name: campaign?.name ?? null,
          status: "needs_setup",
          last_run_at: null, last_run_state: null, created_at: now, updated_at: now,
          runs: [], items: [],
        };
        mockTriggers.unshift(trigger);
        persistMockTriggers();
        return new Response(JSON.stringify(triggerRow(trigger)), { status: 201, headers: { "Content-Type": "application/json" } });
      }
      mockTriggers.forEach(settleBuild);
      return { triggers: mockTriggers.map(triggerRow) };
    }
    const trigger = mockTriggers.find((row) => row.id === decodeURIComponent(encodedId));
    if (!trigger) return triggerError(404, "not_found", "Trigger not found");
    settleBuild(trigger);
    if (method === "PUT" && !action) {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}");
      // A new sentence is a new watch: the agent works out how to check it
      // again, so the trigger goes back to Building with no readback.
      const nextWatch = typeof body.watch === "string" ? body.watch.trim() : "";
      if (nextWatch && nextWatch !== trigger.watch) {
        trigger.watch = nextWatch;
        trigger.name = mockTriggerName(nextWatch);
        trigger.summary = null;
        trigger.status = "needs_setup";
        trigger.pull = { method: "pending", reason: null };
        trigger.updated_at = new Date().toISOString();
      }
      if ("campaign_id" in body && body.campaign_id !== trigger.campaign_id) {
        // The fixtures feed a home care campaign the campaign mock does
        // not list; only a real change of campaign is looked up.
        const campaign = mockCampaigns.find((row) => row.id === body.campaign_id);
        trigger.campaign_id = campaign?.id ?? null;
        trigger.campaign_name = campaign?.name ?? null;
      }
      persistMockTriggers();
      return triggerRow(trigger);
    }
    if (method === "POST" && action === "run") {
      if (trigger.status === "needs_setup") {
        return triggerError(409, "needs_setup", "Your agent is still working out how to check this.");
      }
      if (trigger.runs[0] && ["queued", "running"].includes(trigger.runs[0].state)) {
        return triggerError(409, "run_in_progress", "A check is already running for this trigger.");
      }
      const run: MockRun = {
        id: `run-${crypto.randomUUID().slice(0, 8)}`, state: "queued", triggered_by: "manual",
        items_seen: 0, items_new: 0, error: null, created_at: new Date().toISOString(),
        started_at: null, finished_at: null,
      };
      trigger.runs.unshift(run);
      trigger.last_run_state = "queued";
      persistMockTriggers();
      return new Response(JSON.stringify({ run_id: run.id }), { status: 202, headers: { "Content-Type": "application/json" } });
    }
    if (method === "POST" && (action === "pause" || action === "resume")) {
      trigger.status = action === "pause" ? "paused" : "active";
      persistMockTriggers();
      return triggerRow(trigger);
    }
    advanceRun(trigger);
    persistMockTriggers();
    return { trigger: triggerRow(trigger), runs: trigger.runs, items: trigger.items };
  };

  /* The demo library. Staging paints these beside the review items, because a
     hosted demo with no email written for it yet is still the customer's own
     work: it is earlier, not broken.

     demo-northstar is the one both sources hold — a review pair for Priya
     Patel is pending above — and it proves Staging shows that demo once, with
     the email, rather than twice. */
  const demoRows = [
    { demo_id: "demo-northstar", lead_id: "Priya Patel", lead_name: "Priya Patel", company_name: "Northstar", description: "The plan choice the pricing page drops.", artifact_id: "demo-artifact-northstar", name: "northstar-pricing", content_type: "video/mp4", content_url: "/compare.mp4", created_at: hoursAgo(30), updated_at: hoursAgo(29) },
    { demo_id: "demo-lead-1", lead_id: "demo-lead-1", lead_name: "Example lead", company_name: "Sample company", description: "A sample of the personalized walkthrough your leads will receive.", artifact_id: "demo-artifact-1", name: "sample-walkthrough", content_type: "video/mp4", content_url: "/case-autosana.mp4", created_at: hoursAgo(24), updated_at: hoursAgo(2) },
    { demo_id: "demo-lead-2", lead_id: "demo-lead-2", lead_name: "Another example lead", company_name: "Sample account", description: "A still from the demo, ready for your review.", artifact_id: "demo-artifact-2", name: "sample-demo-preview", content_type: "image/webp", content_url: "/demo-still.webp", created_at: hoursAgo(48), updated_at: hoursAgo(24) },
    /* A phone recording, 540x960. Every other fixture is landscape, which is
       why a portrait clip reached a customer painted as a strip between two
       black bars. This row is the one the frame has to reshape. */
    { demo_id: "demo-phone", lead_id: null, lead_name: null, company_name: "Kitebar", description: "Filmed on a phone: the upload that reports done at 90%.", artifact_id: "demo-artifact-phone", name: "kitebar-upload-phone", content_type: "video/mp4", content_url: "/demo-portrait.mp4", created_at: hoursAgo(36), updated_at: hoursAgo(35) },
  ];
  /* ?mock=library-only — the workspace this page was broken for: demos made,
     nothing pending, nothing scheduled. Three empty segments is what sent a
     customer to an empty page.

     111 rows, the size of a real library: 11 named companies and 100 runs
     behind them. The endpoint hands back 50 at a time, so this fixture is
     also the one that proves Staging pages the library instead of stopping
     at the first 50. */
  const libraryNames = [
    "airbnb", "bookaway", "booking-com", "flixbus", "hostelworld", "omio",
    "getyourguide", "klook", "rome2rio", "trainline", "tripadvisor",
  ];
  const libraryOnlyRows = Array.from({ length: 111 }, (_, index) => {
    const named = index < libraryNames.length;
    const slug = named ? libraryNames[index] : `run-${String(index - libraryNames.length + 1).padStart(3, "0")}`;
    return {
      demo_id: `photon-${slug}`,
      lead_id: null,
      lead_name: null,
      company_name: named
        ? libraryNames[index].replace(/-com$/, ".com").replace(/(^|-)([a-z])/g, (_, gap, letter) => (gap ? " " : "") + letter.toUpperCase())
        : `Demo run ${index - libraryNames.length + 1}`,
      description: index % 2 === 0 ? "The checkout step that drops a booking." : null,
      artifact_id: `photon-artifact-${slug}`,
      name: `photon-demo-${slug}`,
      content_type: "video/mp4",
      /* One in four is a phone recording, because a real library of these is
         mostly phone recordings and every one of them used to paint as a
         strip inside a 16:9 frame. */
      content_url: ["/case-autosana.mp4", "/compare.mp4", "/case-oruk.mp4", "/demo-portrait.mp4"][index % 4],
      created_at: hoursAgo(6 + index * 5),
      updated_at: hoursAgo(2 + index * 5),
    };
  });
  const demosApi = (init?: RequestInit, url?: string) => {
    if (init?.method === "POST") {
      if (mockMode === "demos-feedback-error") return new Response(JSON.stringify({ error: { detail: "Your feedback could not be delivered. Please try again." } }), { status: 502 });
      return { delivered: true };
    }
    if (mockMode === "demos-error") return new Response(JSON.stringify({ error: { detail: "Demos could not load." } }), { status: 503 });
    const query = new URL(url ?? location.href, location.href).searchParams;
    const q = (query.get("q") ?? "").toLowerCase();
    const limit = Number(query.get("limit") ?? 12);
    const offset = Number(query.get("offset") ?? 0);
    const library = mockMode === "library-only" ? libraryOnlyRows : demoRows;
    const rows = mockMode === "demos-empty" ? [] : library.filter((demo) => `${demo.company_name} ${demo.lead_name} ${demo.name}`.toLowerCase().includes(q));
    return { demos: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
  };

  // Matching is startsWith with NO method check, so more-specific paths must
  // come first — /sends/cancel and /sends/dismiss (POST) would otherwise be
  // swallowed by the /sends fixture, and /reviews/decide by /reviews.
  const routes: [string, unknown][] = [
    ["/api/v1/dashboard/demos", demosApi],
    ["/api/v1/dashboard/face-cloning", faceMock(params)],
    ["/api/v1/dashboard/triggers", triggersApi],
    // The audiences surface routes through audKnob so ?audlat/?auderr can
    // express slow and failing states (see the knob comment above).
    ["/api/v1/imports/leads", (init?: RequestInit) => audKnob("upload", () => leadImportsApi(init))],
    ["/api/v1/dashboard/org/approval-policy", approvalPolicyApi],
    ["/api/v1/dashboard/org", orgApi],
    ["/api/v1/dashboard/settings", settingsApi],
    ["/api/v1/dashboard/accounts", accountsApi],
    ["/api/v1/dashboard/audiences", (init?: RequestInit, url?: string) => audKnob(audienceOp(init, url), () => audiencesApi(init, url))],
    ["/api/v1/dashboard/leads", dashboardLeadsApi],
    ["/api/v1/dashboard/companies", dashboardCompaniesApi],
    ["/api/v1/dashboard/channel-metrics", channelMetricsApi],
    ["/api/v1/dashboard/assets", assetsApi],
    ["/api/v1/dashboard/campaigns", campaignsApi],
    ["/api/v1/admin/agents/dashboard", agentDashboard],
    ["/api/v1/admin/agents/fleet", fleetPage],
    ["/api/v1/admin/agents/", mutateAgent],
    ["/api/v1/admin/drift/overview", driftOverview],
    ["/api/v1/admin/drift/agents/", driftAgentRuns],
    ["/api/v1/admin/drift/runs/", driftRunDetail],
    ["/api/v1/admin/probes/dashboard", probesNotFound],
    // Trailing slash on purpose: the Impersonate dialog's /admin/users?q=
    // search stays unmatched (and blocked), as before.
    ["/api/v1/admin/users/", adminInviteApi],
    ["/api/v1/admin/memberships/", adminResendApi],
    ["/api/v1/dashboard/sends/cancel", cancelSends],
    ["/api/v1/dashboard/sends/dismiss", dismissSends],
    ["/api/v1/dashboard/sends/hold-all", holdAllApi],
    ["/api/v1/dashboard/sends/resume-all", resumeAllApi],
    // Trailing slash: the per-send controls only, never GET /sends?limit=.
    ["/api/v1/dashboard/sends/", sendOpApi],
    ["/api/v1/dashboard/sends", sendsApi],
    ["/api/v1/dashboard/reviews/decide", decideReviews],
    // Same trailing-slash trick for POST /reviews/{id}/pin.
    ["/api/v1/dashboard/reviews/", pinReviewApi],
    ["/api/v1/dashboard/reviews", pendingReviewsApi],
    ["/auth/me", me],
    ["/api/v1/dashboard/summary", summary],
    ["/api/v1/dashboard/activity", activity],
    ["/mailboxes/availability", mailboxAvailability],
    ["/mailboxes/purchase", mailboxPurchase],
    ["/mailboxes/overview", managedInboxes],
  ];
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    for (const [path, body] of routes) {
      if (url.startsWith(path)) {
        const payload = typeof body === "function" ? (body as (i?: RequestInit, u?: string) => unknown)(init, url) : body;
        // A fixture may hand back a full Response (e.g. a synthetic 404), or
        // a Promise of either (the latency/error knobs above).
        const toResponse = (value: unknown) =>
          value instanceof Response
            ? value
            : new Response(JSON.stringify(value), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
        if (payload instanceof Promise) return payload.then(toResponse);
        return Promise.resolve(toResponse(payload));
      }
    }
    const parsed = new URL(url, location.origin);
    if (parsed.origin === location.origin && (parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/auth/"))) {
      return Promise.resolve(mockBlockedResponse(parsed.pathname));
    }
    return realFetch(input, init);
  };
}
export {};
