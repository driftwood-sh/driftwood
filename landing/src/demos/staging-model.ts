/* Pure logic behind /dashboard/demos — the customer's Staging, Queue and
   Sent segments. Nothing here touches the DOM or the network, so node --test
   pins the grouping and the copy (the sends-model.ts / overview-model.ts
   convention).

   The one idea this file encodes: a demo is not a review item. Today the
   agent files two pending items per demo (the bug_validation that carries
   the video and its evidence, the send_email that carries the subject and
   body) and the customer must see one card. Grouping happens here. */

/* ---------- API shapes (the fields these segments read) ---------- */

export type LeadContext = {
  lead_id: string;
  name: string | null;
  title: string | null;
  company: string | null;
  linkedin_url: string | null;
  stage: string;
  prior_sends: number;
  last_sent_at: string | null;
};

export type BugEvidence = {
  repro_steps?: string[];
  url?: string;
  device?: string;
  video_timestamp?: string;
};

export type ReviewItem = {
  id: string;
  kind: string;
  title: string;
  body: string;
  subject: string | null;
  lead: LeadContext | null;
  attachment_slug: string | null;
  evidence: BugEvidence | null;
  status: string;
  created_at: string;
  can_decide: boolean;
  approval_policy_version: number;
};

export type SendRow = {
  id: string;
  kind: string;
  note: string;
  subject: string | null;
  attachment_slug: string | null;
  lead: LeadContext | null;
  status: string;
  error: string | null;
  due_at: string;
  /* "YYYY-MM-DD". The backend field is projected_date; projected_send_date
     is the newer name, so both are read and the newer one wins. */
  projected_date: string | null;
  projected_send_date?: string | null;
  created_at: string;
  sent_at: string | null;
  /* Neither field exists on the API yet: "held" arrives with the hold
     endpoint, sending_account with the sender read model. Both are read
     defensively so the page needs no change when they land. */
  held?: boolean;
  sending_account?: string | null;
};

export type QueueStat = {
  kind: string;
  queued: number;
  sent_24h: number;
  cap: number;
  runs_through: string | null;
};

/* ---------- what belongs on this page ---------- */

/* The two item kinds that make up one demo. Connection requests and plain
   messages are not demos, so they never reach this page. */
export const DEMO_ITEM_KINDS = ["bug_validation", "send_email"];

/* The send kinds a demo goes out as. */
export const QUEUE_SEND_KINDS = ["email", "message"];

export function isDemoItem(item: ReviewItem): boolean {
  return item.status === "pending" && DEMO_ITEM_KINDS.includes(item.kind);
}

/* ---------- Staging ---------- */

export type StagedDemo = {
  /* Stable across reloads: the lead the demo is for, or the lone item. */
  key: string;
  lead: LeadContext | null;
  /* Every pending item of this demo, oldest first. */
  itemIds: string[];
  /* The items this viewer may decide. The bug_validation item is always
     assigned to Driftwood (our own gate on whether the bug is real), so the
     customer's decision lands on the send_email item. */
  decidableIds: string[];
  /* True when the demo is waiting on this viewer at all. */
  canDecide: boolean;
  /* The version every decide POST must send as If-Match. */
  policyVersion: number;
  /* The oldest item's stamp: the demo's own age, and what expires it. */
  createdAt: string;
  heading: string;
  subject: string | null;
  /* The email as the prospect reads it. */
  body: string | null;
  videoSlug: string | null;
  evidence: BugEvidence | null;
  /* The bug the demo shows, in the agent's words on the bug item. */
  claim: string | null;
  /* What Pin acts on: the demo's leading item. */
  pinId: string;
  /* Where the clip plays from when the demo has no review item behind it: the
     library row's own url. Null on a demo grouped from review items, whose
     clip is /d/<slug>. */
  videoUrl: string | null;
  /* What the demo is, in the library row's words. It sits where the bug line
     sits, because a demo with no email has no bug line. */
  note: string | null;
  /* The library row this card came from, or null when review items made it.
     A card with a row here has no review item, so Approve, Skip and Pin have
     nothing to act on: every one of those writes names an item id. */
  library: LibraryDemo | null;
};

/* ---------- the library ---------- */

/* One hosted demo, as GET /dashboard/demos lists it. The fields this page
   reads; the endpoint returns more. */
export type LibraryDemo = {
  demo_id: string;
  lead_id: string | null;
  lead_name: string | null;
  company_name: string;
  description: string | null;
  artifact_id: string;
  /* The demo's own slug, which is what a review item names in
     attachment_slug. It is how the two sources recognise one demo. */
  name: string;
  content_type: string;
  content_url: string;
  created_at: string;
  updated_at: string;
};

/* "Dana Whitfield, Meridian" from a library row, which carries the two names
   as plain text rather than as a lead. */
export function libraryHeading(row: LibraryDemo): string {
  const name = row.lead_name?.trim();
  const company = row.company_name?.trim();
  if (name && company) return `${name}, ${company}`;
  return name || company || row.name;
}

/* A library demo as a Staging card. It has a clip, whoever it was made for,
   its age, and the idea behind it. It has no email yet, and no review item,
   so nothing on it can be approved. */
export function stagedFromLibrary(row: LibraryDemo): StagedDemo {
  return {
    key: `library:${row.demo_id}`,
    lead: null,
    itemIds: [],
    decidableIds: [],
    canDecide: false,
    policyVersion: 0,
    createdAt: row.created_at,
    heading: libraryHeading(row),
    subject: null,
    body: null,
    videoSlug: null,
    evidence: null,
    claim: null,
    pinId: "",
    videoUrl: row.content_url,
    note: row.description,
    library: row,
  };
}

/* ---------- one card per company ---------- */

/* Whatever made a demo names its company its own way. A private run writes
   the domain into the name — "Airbnb (airbnb.com)" — and a lead-linked video
   writes the bare "Airbnb". Two names, one company, and the customer is owed
   one card for it.

   These three functions are the same reduction the endpoint makes in
   app/db/demos.py (_domain, _company_identity, company_key), on the one field
   the endpoint hands over: the company name. Keeping them in step matters,
   because either side alone can hand the page two rows for one company. */

const DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/* The domain a string names, or null when it names none. "Airbnb" is a name;
   "airbnb.com" is a domain, and so is "https://www.airbnb.com/". */
function demoDomain(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/$/, "");
  return DOMAIN.test(normalized) ? normalized : null;
}

/* A company name as a key, plus the domain it carries when it carries one. A
   trailing "(airbnb.com)" is domain evidence and comes off the name; a
   trailing "(WhatsApp)" is part of the name and stays. */
export function companyIdentity(name: string): { key: string; domain: string | null } {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  const hint = demoDomain(/\(([^()]+)\)$/.exec(normalized)?.[1] ?? "");
  return {
    key: hint ? normalized.replace(/\s*\([^()]+\)$/, "").trim() : normalized,
    domain: hint ?? demoDomain(normalized),
  };
}

/* What each row counts as, in the order the rows came in.

   A bare name resolves to a domain another row proves, and only when every
   row that names a domain for that name names the SAME one: namesakes on
   different sites are different companies and stay apart.

   A demo made for a named person is that person's demo, not the company's.
   The endpoint keeps one of those per lead on purpose, so they keep their own
   identity here too — merging them would hide work. */
export function companyKeys(rows: LibraryDemo[]): string[] {
  const identities = rows.map((row) => companyIdentity(row.company_name));
  const domains = new Map<string, Set<string>>();
  for (const { key, domain } of identities) {
    if (!domain) continue;
    const seen = domains.get(key) ?? new Set<string>();
    seen.add(domain);
    domains.set(key, seen);
  }
  return identities.map(({ key, domain }, index) => {
    const person = rows[index].lead_name?.trim();
    if (person) return `lead:${rows[index].lead_id ?? rows[index].demo_id}`;
    const seen = domains.get(key);
    const resolved = domain ?? (seen?.size === 1 ? [...seen][0] : null);
    return resolved ? `domain:${resolved}` : `name:${key}`;
  });
}

/* A timestamp as a number. Two sources write the same instant two ways, so
   the strings are parsed rather than compared. */
function stamp(value: string): number {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

/* One row per company, and the most recent one. A tie falls to the demo id,
   so the same library never paints two ways. */
export function latestPerCompany(rows: LibraryDemo[]): LibraryDemo[] {
  const keys = companyKeys(rows);
  const latest = new Map<string, number>();
  rows.forEach((row, index) => {
    const held = latest.get(keys[index]);
    if (held === undefined) {
      latest.set(keys[index], index);
      return;
    }
    const order = stamp(row.created_at) - stamp(rows[held].created_at);
    if (order > 0 || (order === 0 && row.demo_id.localeCompare(rows[held].demo_id) > 0))
      latest.set(keys[index], index);
  });
  const kept = new Set(latest.values());
  return rows.filter((_, index) => kept.has(index));
}

/* Staging, from both of its sources, as one list.

   A demo that exists and is neither queued nor sent is staged, whether or not
   an email is written for it yet. Review items carry the ones with an email;
   the library carries the rest. A demo in both sources is one demo, and the
   review item wins it, because that copy has the email on it. The pair is
   recognised by the lead it is for, or by the demo's own slug.

   The library can also hold one company twice on its own — the same company
   registered by a run and by a lead-linked video, under two spellings of its
   name — and a customer reading the page counts companies, not
   registrations. One company, one card, the newest kept.

   Newest first, across both sources: the work done today is the work a
   customer opens the page to see. */
export function stagedWithLibrary(
  staged: StagedDemo[],
  library: LibraryDemo[],
  queued: SendRow[],
): StagedDemo[] {
  const leads = new Set<string>();
  const slugs = new Set<string>();
  for (const demo of staged) {
    if (demo.lead) leads.add(demo.lead.lead_id);
    if (demo.videoSlug) slugs.add(demo.videoSlug);
  }
  /* A demo already on its way out is not waiting on anyone. */
  for (const send of queued) {
    if (send.lead) leads.add(send.lead.lead_id);
    if (send.attachment_slug) slugs.add(send.attachment_slug);
  }
  const rest = latestPerCompany(
    library.filter(
      (row) => !(row.lead_id !== null && leads.has(row.lead_id)) && !slugs.has(row.name),
    ),
  ).map(stagedFromLibrary);
  return [...staged, ...rest].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* Demos are hosted at /d/<slug>. Items should carry attachment_slug, but
   early bug_validation rows named their demo only inside the evidence text,
   so the slug is salvaged from there rather than losing the video. */
export function demoSlug(item: ReviewItem): string | null {
  if (item.attachment_slug) return item.attachment_slug;
  const text = `${item.evidence?.video_timestamp ?? ""} ${item.body}`;
  const match = /\/d\/([a-z0-9][a-z0-9_-]*)/i.exec(text);
  return match ? match[1] : null;
}

/* "Dana Whitfield, Meridian" — the customer's own words for who a demo is
   for. Falls back to the company, then to the item's title. */
export function demoHeading(lead: LeadContext | null, fallback: string): string {
  if (!lead) return fallback;
  const name = lead.name?.trim();
  const company = lead.company?.trim();
  if (name && company) return `${name}, ${company}`;
  return name || company || fallback;
}

/* One card per demo, oldest first: the oldest demo is the one about to
   expire, so it is the one to decide. Items for the same lead join; items
   with no lead stand alone rather than silently merging. */
export function groupStagedDemos(items: ReviewItem[]): StagedDemo[] {
  const groups = new Map<string, ReviewItem[]>();
  for (const item of items) {
    if (!isDemoItem(item)) continue;
    const key = item.lead ? `lead:${item.lead.lead_id}` : `item:${item.id}`;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  const demos: StagedDemo[] = [];
  for (const [key, group] of groups) {
    const sorted = [...group].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    );
    const bug = sorted.find((item) => item.kind === "bug_validation") ?? null;
    const email = sorted.find((item) => item.kind === "send_email") ?? null;
    const lead = sorted.find((item) => item.lead)?.lead ?? null;
    const decidable = sorted.filter((item) => item.can_decide);
    demos.push({
      key,
      lead,
      itemIds: sorted.map((item) => item.id),
      decidableIds: decidable.map((item) => item.id),
      canDecide: decidable.length > 0,
      policyVersion: (decidable[0] ?? sorted[0]).approval_policy_version,
      createdAt: sorted[0].created_at,
      heading: demoHeading(lead, sorted[0].title),
      subject: email?.subject ?? null,
      body: email?.body ?? null,
      videoSlug:
        (bug ? demoSlug(bug) : null) ?? (email ? demoSlug(email) : null),
      evidence: bug?.evidence ?? null,
      claim: bug?.body ?? null,
      pinId: (bug ?? sorted[0]).id,
      videoUrl: null,
      note: null,
      library: null,
    });
  }
  return demos.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/* One demo's decision, as one decide POST. Only the items this viewer may
   decide go in it: the endpoint answers 403 for anything else. */
export function decisionsFor(
  demo: StagedDemo,
  decision: "approve" | "deny",
  reason?: string,
): { item_id: string; decision: "approve" | "deny"; reason?: string }[] {
  return demo.decidableIds.map((id) =>
    reason
      ? { item_id: id, decision, reason }
      : { item_id: id, decision },
  );
}

/* The cards that belong under "Ready for you". A demo whose items are all
   assigned to Driftwood is waiting on us, not on the customer, so it stays
   off their page: the quality gate is ours and stays internal. */
export function readyForYou(demos: StagedDemo[]): StagedDemo[] {
  return demos.filter((demo) => demo.canDecide);
}

/* ---------- Queue ---------- */

export type QueueRow = {
  send: SendRow;
  channel: string;
  /* "Tue Sep 16, 9:00 AM", or "Paused". */
  planned: string;
  held: boolean;
  account: string;
};

/* The customer's word for the lane a demo goes out on. */
export function channelLabel(kind: string): string {
  if (kind === "email") return "Email";
  if (kind === "x_dm" || kind === "x_follow") return "X";
  return "LinkedIn";
}

/* A local-midnight Date for a "YYYY-MM-DD" string. new Date(dateOnly)
   parses as UTC, which reads as the day before in every western zone. */
export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/* "Tue Sep 16". */
export function dayShort(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/* "Thursday, Sep 11" — the Sent segment's day heading. */
export function dayLong(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

/* "9:00 AM". */
export function timeShort(date: Date): string {
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function projectedDateOf(send: SendRow): string | null {
  return send.projected_send_date ?? send.projected_date ?? null;
}

/* When the send is planned, in the customer's words. The projected date is
   the day the dispatcher expects; the time of day only shows when the due
   stamp falls on that same day, so a deferred send never claims a time it
   is not going to keep. */
export function plannedTime(send: SendRow, held: boolean): string {
  /* "Paused", never "held": the control that puts a row here reads "Pause
     all sends", and one concept gets one word. */
  if (held) return "Paused";
  const projected = projectedDateOf(send);
  const day = projected ? parseDateOnly(projected) : null;
  const due = new Date(send.due_at);
  const dueValid = !Number.isNaN(due.getTime());
  if (!day) return dueValid ? `${dayShort(due)}, ${timeShort(due)}` : "Next open slot";
  const sameDay = dueValid && due.toDateString() === day.toDateString();
  return sameDay ? `${dayShort(day)}, ${timeShort(due)}` : dayShort(day);
}

/* Whichever pool the send draws from picks the sender when it goes out, so
   a single connected account is named and anything else stays honest. */
export const ACCOUNT_UNKNOWN = "Picked when it sends";

export function sendingAccount(
  send: SendRow,
  accounts: { email: string[]; linkedin: string[] },
): string {
  if (send.sending_account) return send.sending_account;
  const pool = send.kind === "email" ? accounts.email : accounts.linkedin;
  return pool.length === 1 ? pool[0] : ACCOUNT_UNKNOWN;
}

export function isHeld(send: SendRow, heldIds: ReadonlySet<string>): boolean {
  return send.held === true || send.status === "held" || heldIds.has(send.id);
}

/* The queue holds demos that are going out: approved, still waiting, in due
   order (the API's own order). Failed rows are not scheduled, so they are
   not the queue; they stay on the internal surfaces that can act on them. */
export function queueSends(sends: SendRow[]): SendRow[] {
  return sends.filter(
    (send) =>
      QUEUE_SEND_KINDS.includes(send.kind) &&
      (send.status === "pending" || send.status === "sending" || send.status === "held"),
  );
}

export function queueRows(
  sends: SendRow[],
  heldIds: ReadonlySet<string>,
  accounts: { email: string[]; linkedin: string[] },
): QueueRow[] {
  return queueSends(sends).map((send) => {
    const held = isHeld(send, heldIds);
    return {
      send,
      channel: channelLabel(send.kind),
      planned: plannedTime(send, held),
      held,
      account: sendingAccount(send, accounts),
    };
  });
}

/* The last day the queue reaches, across the kinds this page shows. */
export function runsThrough(stats: QueueStat[]): string | null {
  const dates = stats
    .filter((stat) => QUEUE_SEND_KINDS.includes(stat.kind))
    .map((stat) => stat.runs_through)
    .filter((date): date is string => Boolean(date))
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/* "Runs through Thu Sep 17." The sending window used to ride along here and
   was cut: it is a setting, and it lives in settings. */
export function queueHeadline(runsThroughDate: string | null): string {
  const day = runsThroughDate ? parseDateOnly(runsThroughDate) : null;
  return day ? `Runs through ${dayShort(day)}.` : "";
}

/* ---------- Sent ---------- */

export type SentDay = { day: string; label: string; rows: SendRow[] };

/* Sent demos grouped by the day they went out, newest day first and newest
   row first inside each day. */
export function groupSentByDay(sends: SendRow[]): SentDay[] {
  const days = new Map<string, SendRow[]>();
  for (const send of sends) {
    if (!QUEUE_SEND_KINDS.includes(send.kind)) continue;
    const stamp = send.sent_at;
    if (!stamp) continue;
    const at = new Date(stamp);
    if (Number.isNaN(at.getTime())) continue;
    const day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
    const rows = days.get(day);
    if (rows) rows.push(send);
    else days.set(day, [send]);
  }
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, rows]) => {
      const date = parseDateOnly(day);
      return {
        day,
        label: date ? dayLong(date) : day,
        rows: [...rows].sort((a, b) =>
          (b.sent_at ?? "").localeCompare(a.sent_at ?? ""),
        ),
      };
    });
}

/* The thread for one sent demo lives in the Inbox, keyed by the lead. */
export function threadHref(send: SendRow): string | null {
  const id = send.lead?.lead_id;
  return id ? `/dashboard/inbox?lead=${encodeURIComponent(id)}` : null;
}

/* ---------- the email, collapsed ---------- */

/* What a demo card shows before the email is opened: the greeting line, and
   the paragraph that carries the personal line. Everything after it is the
   same template on every demo, so it stays behind "Show email". The threshold
   picks the paragraph that says something over "Worth a look?". */
const PERSONAL_MIN = 40;

export function emailCollapsed(body: string | null): {
  first: string | null;
  personal: string | null;
} {
  if (!body) return { first: null, personal: null };
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    /* An inline image is media, not a line to quote. */
    .filter((block) => !/^\[!\[/.test(block));
  if (paragraphs.length === 0) return { first: null, personal: null };
  const first = paragraphs[0].split("\n")[0].trim();
  const personal =
    paragraphs.slice(1).find((block) => block.length > PERSONAL_MIN) ?? null;
  return { first, personal: personal ? personal.replace(/\s+/g, " ") : null };
}

/* ---------- copy ---------- */

/* The staging bound and the "Driftwood approves" line used to sit here. Both
   described our mechanism rather than the customer's next move, and the
   expiry they named is not switched on for any workspace. When a workspace
   really carries an expiry flag, one short line comes back then. */
export const EMPTY_STAGING = "Nothing waiting for you.";
/* One term per concept: the segment is the Queue, so nothing here is
   "scheduled" or "pending". */
export const EMPTY_QUEUE = "Nothing queued yet.";
export const EMPTY_SENT = "Nothing sent yet.";
export const NOT_AVAILABLE = "Not available yet.";

/* ---------- the queue, by day ---------- */

/* The queue is read as days, not as one ordered list: a customer can have two
   months of sends in it, and a flat list of twelve hundred rows answers no
   question anyone has. Each day carries how full it is against the org's own
   daily sending limits. */

export type ChannelLoad = { channel: string; label: string; one: string; used: number; cap: number | null };

export type QueueDay = {
  /* "YYYY-MM-DD", the projected send day. */
  day: string;
  /* "Today", "Tomorrow", then "Wed Sep 17". */
  label: string;
  rows: QueueRow[];
  channels: ChannelLoad[];
  /* Every channel with rows is at or over its limit. */
  full: boolean;
};

export type DailyLimits = { email: number | null; message: number | null };

export const NO_LIMITS: DailyLimits = { email: null, message: null };

export function localDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/* The day a queued send is expected to go out on: the projected date, or the
   day its due stamp falls on when nothing is projected yet. */
export function sendDay(send: SendRow): string {
  const projected = projectedDateOf(send);
  if (projected) return projected;
  const due = new Date(send.due_at);
  return Number.isNaN(due.getTime()) ? "" : localDay(due);
}

/* "Today" / "Tomorrow" / "Wed Sep 17". */
export function dayLabel(day: string, today: Date = new Date()): string {
  const date = parseDateOnly(day);
  if (!date) return day;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((date.getTime() - start.getTime()) / 86400e3);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return dayShort(date);
}

/* How a toast names a day: "today", "tomorrow", the weekday inside a week,
   then the date. Lower case, because it sits inside a sentence. */
export function daySentence(day: string, today: Date = new Date()): string {
  const date = parseDateOnly(day);
  if (!date) return day;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((date.getTime() - start.getTime()) / 86400e3);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1 && days < 7)
    return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const CHANNEL_UNIT: Record<string, string> = { email: "emails", message: "LinkedIn" };
const CHANNEL_ONE: Record<string, string> = { email: "email", message: "LinkedIn" };

export function groupQueueByDay(
  rows: QueueRow[],
  limits: DailyLimits = NO_LIMITS,
  today: Date = new Date(),
): QueueDay[] {
  const byDay = new Map<string, QueueRow[]>();
  for (const row of rows) {
    const day = sendDay(row.send);
    if (!day) continue;
    const list = byDay.get(day);
    if (list) list.push(row);
    else byDay.set(day, [row]);
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, dayRows]) => {
      /* A channel appears on a day header when it has rows there: a "0 of 20
         emails" on every one of forty days is noise, not status. */
      const channels: ChannelLoad[] = (["email", "message"] as const)
        .map((kind) => ({
          channel: kind,
          label: CHANNEL_UNIT[kind],
          one: CHANNEL_ONE[kind],
          used: dayRows.filter((row) => row.send.kind === kind).length,
          cap: limits[kind],
        }))
        .filter((load) => load.used > 0);
      const capped = channels.filter((load) => load.cap !== null);
      return {
        day,
        label: dayLabel(day, today),
        rows: dayRows,
        channels,
        full: capped.length > 0 && capped.every((load) => load.used >= (load.cap ?? 0)),
      };
    });
}

/* How many more demos the day can take. Null when the workspace exposes no
   limit, and the header then carries the day alone. */
export function dayRemaining(day: QueueDay): number | null {
  const capped = day.channels.filter((load) => load.cap !== null);
  if (capped.length === 0) return null;
  return capped.reduce((left, load) => left + Math.max(0, (load.cap ?? 0) - load.used), 0);
}

/* The per-channel arithmetic, for the one place it belongs: a title on the
   number, for the reader who wants the split. Never on screen. */
export function dayChannelTitle(day: QueueDay): string {
  return day.channels
    .map((load) =>
      load.cap === null
        ? `${load.used.toLocaleString()} ${load.used === 1 ? load.one : load.label}`
        : `${load.used.toLocaleString()} of ${load.cap.toLocaleString()} ${load.label}`,
    )
    .join(" · ");
}

/* The first `open` days stand open; everything past them collapses into one
   row, so sixty days of queue is still one screen. */
export function splitQueueDays(
  days: QueueDay[],
  open: number,
): { shown: QueueDay[]; later: QueueDay[] } {
  return { shown: days.slice(0, open), later: days.slice(open) };
}

/* "Later, 1,180 demos through Nov 14". */
export function laterSummary(later: QueueDay[]): string {
  const count = later.reduce((total, day) => total + day.rows.length, 0);
  const last = later[later.length - 1];
  const end = last ? parseDateOnly(last.day) : null;
  const through = end
    ? ` through ${end.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
    : "";
  return `Later, ${count.toLocaleString()} ${count === 1 ? "demo" : "demos"}${through}`;
}

/* Inside a day group the day is already in the header, so the row carries
   only the time. A send whose due stamp lands on another day has no time of
   its own yet: it goes when the window next opens. */
export function plannedClock(send: SendRow, held: boolean): string {
  if (held) return "Paused";
  const due = new Date(send.due_at);
  if (Number.isNaN(due.getTime())) return "Sending hours";
  return localDay(due) === sendDay(send) ? timeShort(due) : "Sending hours";
}

/* ---------- the bug, on the card ---------- */

/* "bug visible at 0:19" -> 19. The column is free text written by the agent,
   so the timestamp is read out of it rather than demanded of it. */
export function videoSeconds(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = /(\d{1,2}):([0-5]\d)/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function timestampLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}
