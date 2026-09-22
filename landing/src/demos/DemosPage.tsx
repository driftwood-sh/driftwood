import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { EmailPreview } from "../EmailPreview";
import { fetchInWaves, useToast } from "../dashboard-shared";
import { analyticsWindow } from "../analytics/model";
import { withMockMode } from "../mock-mode";
import { announceDemosCountChanged } from "./nav-count";
import { sendFeedback } from "./api";
import { clipFrame, RESERVED_CLIP_FRAME, type ClipFrame } from "./clip-frame";
import {
  LIBRARY_CHUNK,
  PAGE_GUARD,
  REVIEW_CHUNK,
  SEND_CHUNK,
  approvalPolicy,
  approveDemo,
  approveDemos,
  decide,
  fetchLibraryPage,
  fetchQueuePage,
  fetchReviewsPage,
  fetchRepliedLeads,
  fetchSentPage,
  firstLibraryPage,
  firstQueuePage,
  firstReviewsPage,
  firstSentPage,
  holdAllSends,
  landingDayFor,
  moveToTop,
  pinDemo,
  queueAction,
  unpinDemo,
  resumeAllSends,
  workspaceSettings,
  EMPTY_SENDERS,
} from "./staging-api";
import {
  ADD_A_NAME,
  ADD_A_NAME_LABEL,
  APPROVED_GROUP,
  EMPTY_QUEUE,
  EMPTY_SENT,
  EMPTY_STAGING,
  NOT_AVAILABLE,
  NO_LIMITS,
  approvableDemos,
  approveKeyOf,
  approvedLabel,
  approvedNotScheduled,
  dayChannelTitle,
  daySentence,
  decisionsFor,
  groupQueueByDay,
  groupSentByDay,
  groupStagedDemos,
  groupEmailReviews,
  isApprovable,
  laterSummary,
  plannedClock,
  readApprovalStatus,
  queueHeadline,
  readyForYou,
  queueRows,
  runsThrough,
  splitQueueDays,
  stagedWithLibrary,
  threadHref,
  timestampLabel,
  videoSeconds,
  type ApprovedRow,
  type DailyLimits,
  type DemoApproval,
  type QueueDay,
  type QueueRow,
  type LibraryDemo,
  type QueueStat,
  type ReviewItem,
  type SendRow,
  type StagedDemo,
} from "./staging-model";
import "./demos-page.css";

/* Demo approval authorizes contact discovery and drafting. Email approval is
   separate: the customer sees each recipient and exact copy before a send is
   queued. Staging holds demos and discovery; Review emails holds drafts;
   Queue holds only scheduled sends. */

const SEGMENTS = [
  ["staging", "Staging"],
  ["review", "Review emails"],
  ["queue", "Queue"],
  ["sent", "Sent"],
] as const;

type Segment = (typeof SEGMENTS)[number][0];

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

type StagingData = {
  items: ReviewItem[];
  stats: QueueStat[];
  /* False while later pages are still arriving: a count and a whole-list
     action must never quietly mean "the part that had loaded". */
  complete: boolean;
  loadingMore: boolean;
  totalPending: number;
};

type QueueData = { sends: SendRow[]; complete: boolean; loadingMore: boolean };
/* The library, which Staging paints beside the review items. */
type LibraryData = { rows: LibraryDemo[]; total: number; complete: boolean };
type SentData = { sends: SendRow[]; total: number };

/* Every control on the page that arms before it runs. One at a time, so
   arming any of them disarms the rest (ux-principles rule 9). */
type Armed =
  | { kind: "approve-all" }
  | { kind: "approve-group"; key: string }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "skip"; key: string }
  | { kind: "unstage"; key: string }
  | { kind: "bulk-unstage" };

function sameArmed(a: Armed, b: Armed): boolean {
  if (a.kind !== b.kind) return false;
  return "key" in a && "key" in b ? a.key === b.key : true;
}

/* The clock lives out here: a component body may not read one, because a
   render has to give the same answer twice. */
function armStamp(): number {
  return Date.now();
}

function armedTooRecently(at: number): boolean {
  return armStamp() - at < ARM_GUARD_MS;
}

const ARM_MS = 5000;
/* A press inside this window of arming is a double-click, not a decision.
   Without it, two fast clicks walk straight through a two-press guard. */
const ARM_GUARD_MS = 400;
/* Days that stand open in the queue; everything past them collapses into one
   line, because a customer can have two months of sends queued. */
const OPEN_DAYS = 7;
const LATER_PAGE = 7;
const REPLY_WINDOW_DAYS = 90;
const LOAD_FAILED = "That did not load.";

/* What a queue row puts in the From cell: the sender it actually names. A
   pool placeholder ("picked when it sends") and a workspace's one obvious
   mailbox are not row values, so both leave the cell empty. */
function rowSender(row: QueueRow): string | null {
  return row.send.sending_account ?? null;
}

/* Which days the reader has folded, kept for the session so a reload does not
   undo the work. A day with no entry follows the default: the first day open,
   the rest folded. */
const DAY_STATE_KEY = "driftwood.demos.queue-days";

function readDayState(): Record<string, boolean> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(DAY_STATE_KEY) ?? "{}") as unknown;
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    const out: Record<string, boolean> = {};
    for (const [day, open] of Object.entries(saved as Record<string, unknown>))
      if (typeof open === "boolean") out[day] = open;
    return out;
  } catch {
    return {};
  }
}

function writeDayState(state: Record<string, boolean>) {
  try {
    sessionStorage.setItem(DAY_STATE_KEY, JSON.stringify(state));
  } catch {
    /* A browser with storage off keeps the folds for this render only. */
  }
}

/* The segment the reader asked for, or null when they have not asked. Null
   opens the first segment that has anything in it, so a workspace whose work
   is all in one segment never lands on an empty page. */
function segmentFromUrl(): Segment | null {
  const value = new URLSearchParams(window.location.search).get("seg");
  return value === "queue" || value === "sent" || value === "staging" || value === "review" ? value : null;
}

/* The segment a page with no explicit choice opens on: the first one that
   has rows. Staging when every list is empty, because that is where a
   workspace's first demo shows up. */
function firstWithRows(staging: number, review: number, queue: number, sent: number): Segment {
  if (review > 0) return "review";
  if (staging > 0) return "staging";
  if (queue > 0) return "queue";
  if (sent > 0) return "sent";
  return "staging";
}

/* Rows the list already holds stay put. Two loads of the same list can
   overlap: a refresh racing the first read, or a remount. Without this the
   later pages land twice and every count over them is double. */
function mergeById<T>(prev: T[], rows: T[], idOf: (row: T) => string): T[] {
  const seen = new Set(prev.map(idOf));
  return [...prev, ...rows.filter((row) => !seen.has(idOf(row)))];
}

/* Pages of a list, first page painted before the rest arrives. */
async function loadPaged<T>(
  first: () => Promise<{ rows: T[]; total: number }>,
  chunk: number,
  page: (offset: number) => Promise<{ rows: T[]; total: number }>,
  idOf: (row: T) => string,
  paint: (rows: T[], total: number, complete: boolean) => void,
  append: (rows: T[], complete: boolean) => void,
) {
  const head = await first();
  const pageCount =
    head.rows.length === 0
      ? 1
      : Math.min(Math.ceil(head.total / chunk), PAGE_GUARD);
  const done = pageCount <= 1 || head.rows.length >= head.total;
  paint(head.rows, head.total, done);
  if (done) return;
  const offsets: number[] = [];
  for (let i = 1; i < pageCount; i += 1) offsets.push(i * chunk);
  const pages = await fetchInWaves(offsets, page);
  const complete = pages.every((value) => value !== null);
  const seen = new Set(head.rows.map(idOf));
  const rest: T[] = [];
  for (const value of pages)
    if (value)
      for (const row of value.rows) {
        const id = idOf(row);
        if (seen.has(id)) continue;
        seen.add(id);
        rest.push(row);
      }
  append(rest, complete);
}

/* Kicks the first reads off at chunk eval, beside /auth/me. The sidebar's
   Demos count shares these promises, so opening the page adds no request. */
void firstReviewsPage();
void firstLibraryPage();
void firstQueuePage();
void firstSentPage();
void approvalPolicy();
void workspaceSettings();

export default function DemosPage() {
  const toast = useToast();
  const [segment, setSegment] = useState<Segment | null>(segmentFromUrl);
  const [staging, setStaging] = useState<Load<StagingData>>({ status: "loading" });
  const [library, setLibrary] = useState<Load<LibraryData>>({ status: "loading" });
  const [queue, setQueue] = useState<Load<QueueData>>({ status: "loading" });
  const [sent, setSent] = useState<Load<SentData>>({ status: "loading" });
  const [autoApproved, setAutoApproved] = useState(false);
  const [replied, setReplied] = useState<ReadonlySet<string>>(new Set());

  /* Per-card and per-row work in flight, keyed the way the press was. */
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [cardError, setCardError] = useState<{ key: string; message: string } | null>(null);
  /* The open change box, and the drafts behind it. A draft outlives closing
     the box: a mis-press must not throw away what the customer typed. */
  const [changeOpen, setChangeOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  /* The open name field on an approved demo nobody was found for, and what is
     typed in it. Same rule as the change box: a mis-press keeps the text. */
  const [hintOpen, setHintOpen] = useState<string | null>(null);
  const [hints, setHints] = useState<Record<string, string>>({});
  const [armed, setArmed] = useState<{ at: number; what: Armed } | null>(null);
  const [pinnable, setPinnable] = useState(true);
  const [pinned, setPinned] = useState<ReadonlySet<string>>(new Set());
  const [heldIds, setHeldIds] = useState<ReadonlySet<string>>(new Set());
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [bulkQueueError, setBulkQueueError] = useState<string | null>(null);
  const [dayState, setDayState] = useState<Record<string, boolean>>(readDayState);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [laterOpen, setLaterOpen] = useState(false);
  const [laterShown, setLaterShown] = useState(LATER_PAGE);
  /* The org's own daily sending limits, which is what makes a day "full".
     Null until settings land, and null per channel on a backend that does
     not report one, in which case a day header shows bare counts. */
  const [limits, setLimits] = useState<DailyLimits>(NO_LIMITS);

  const loadStaging = useCallback(async (fresh: boolean) => {
    try {
      let stats: QueueStat[] = [];
      await loadPaged<ReviewItem>(
        async () => {
          const page = await (fresh ? fetchReviewsPage(0) : firstReviewsPage());
          stats = page.queue_stats ?? [];
          return { rows: page.pending, total: page.total_pending };
        },
        REVIEW_CHUNK,
        async (offset) => {
          const page = await fetchReviewsPage(offset);
          return { rows: page.pending, total: page.total_pending };
        },
        (item) => item.id,
        (rows, total, complete) =>
          setStaging({
            status: "ready",
            data: { items: rows, stats, complete, loadingMore: !complete, totalPending: total },
          }),
        (rows, complete) =>
          setStaging((prev) =>
            prev.status === "ready"
              ? {
                  status: "ready",
                  data: {
                    ...prev.data,
                    items: mergeById(prev.data.items, rows, (item) => item.id),
                    complete,
                    loadingMore: false,
                  },
                }
              : prev,
          ),
      );
    } catch {
      setStaging((prev) =>
        prev.status === "ready" ? prev : { status: "error", message: LOAD_FAILED },
      );
    }
  }, []);

  const loadLibrary = useCallback(async (fresh: boolean) => {
    try {
      await loadPaged<LibraryDemo>(
        async () => {
          const page = await (fresh ? fetchLibraryPage(0) : firstLibraryPage());
          return { rows: page.demos, total: page.total };
        },
        LIBRARY_CHUNK,
        async (offset) => {
          const page = await fetchLibraryPage(offset);
          return { rows: page.demos, total: page.total };
        },
        (row) => row.demo_id,
        (rows, total, complete) =>
          setLibrary({ status: "ready", data: { rows, total, complete } }),
        (rows, complete) =>
          setLibrary((prev) =>
            prev.status === "ready"
              ? {
                  status: "ready",
                  data: {
                    ...prev.data,
                    rows: mergeById(prev.data.rows, rows, (row) => row.demo_id),
                    complete,
                  },
                }
              : prev,
          ),
      );
    } catch {
      /* Staging still paints the review items. A count over half a list would
         be a wrong number, so the segment carries none until this lands. */
      setLibrary((prev) =>
        prev.status === "ready" ? prev : { status: "error", message: LOAD_FAILED },
      );
    }
  }, []);

  const loadQueue = useCallback(async (fresh: boolean) => {
    try {
      await loadPaged<SendRow>(
        async () => {
          const page = await (fresh ? fetchQueuePage(0) : firstQueuePage());
          return { rows: page.sends, total: page.total };
        },
        SEND_CHUNK,
        async (offset) => {
          const page = await fetchQueuePage(offset);
          return { rows: page.sends, total: page.total };
        },
        (send) => send.id,
        (rows, _total, complete) =>
          setQueue({ status: "ready", data: { sends: rows, complete, loadingMore: !complete } }),
        (rows, complete) =>
          setQueue((prev) =>
            prev.status === "ready"
              ? {
                  status: "ready",
                  data: {
                    sends: mergeById(prev.data.sends, rows, (send) => send.id),
                    complete,
                    loadingMore: false,
                  },
                }
              : prev,
          ),
      );
    } catch {
      setQueue((prev) =>
        prev.status === "ready" ? prev : { status: "error", message: LOAD_FAILED },
      );
    }
  }, []);

  const loadSent = useCallback(async (fresh: boolean) => {
    try {
      const page = await (fresh ? fetchSentPage() : firstSentPage());
      setSent({ status: "ready", data: { sends: page.sends, total: page.total } });
    } catch {
      setSent({ status: "error", message: LOAD_FAILED });
    }
  }, []);

  useEffect(() => {
    void (async () => {
      await Promise.all([
        loadStaging(false),
        loadLibrary(false),
        loadQueue(false),
        loadSent(false),
      ]);
      /* Now that the lists have landed, open the first segment that has rows,
         so nobody lands on an empty page. A segment the reader picked wins,
         and once this choice is made it stands: a list the reader empties by
         their own work must not move the page under them.

         These are the same memoized first pages the loads above read, so the
         choice costs no request. */
      const [reviewsPage, libraryPage, queuePage, sentPage] = await Promise.all([
        firstReviewsPage().catch(() => null),
        firstLibraryPage().catch(() => null),
        firstQueuePage().catch(() => null),
        firstSentPage().catch(() => null),
      ]);
      const staged = stagedWithLibrary(
        reviewsPage ? readyForYou(groupStagedDemos(reviewsPage.pending)) : [],
        libraryPage?.demos ?? [],
        queuePage?.sends ?? [],
      );
      const queued = queueRows(queuePage?.sends ?? [], new Set(), EMPTY_SENDERS);
      const sentRows = groupSentByDay(sentPage?.sends ?? []);
      /* Pending discovery stays in Staging. Ready email reviews take priority
         when the customer has not chosen a tab. */
      const waiting = approvedNotScheduled(libraryPage?.demos ?? []);
      setSegment(
        (picked) =>
          picked ??
          firstWithRows(staged.filter((demo) => demo.library !== null).length + waiting.length, staged.filter((demo) => demo.canDecide).length, queued.length, sentRows.length),
      );
    })();
  }, [loadStaging, loadLibrary, loadQueue, loadSent]);

  useEffect(() => {
    let live = true;
    approvalPolicy().then((policy) => { if (live) setAutoApproved(policy.mode === "auto"); }, () => {});
    workspaceSettings().then(
      (page) => {
        if (!live) return;
        setLimits({
          email: page.daily_caps?.email ?? null,
          message: page.daily_caps?.message ?? null,
        });
      },
      () => {},
    );
    fetchRepliedLeads(analyticsWindow(REPLY_WINDOW_DAYS)).then(
      (ids) => {
        if (live) setReplied(ids);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    // Keep progress and new drafts current without making the user reload.
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void loadStaging(true);
      void loadLibrary(true);
      void loadQueue(true);
    };
    const interval = window.setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [loadStaging, loadLibrary, loadQueue]);

  /* An armed button disarms itself after a beat, so no stale confirm waits to
     be fat-fingered minutes later, and Escape disarms it on purpose: waiting
     out a timer is not an exit anyone should have to take. */
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), ARM_MS);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setArmed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [armed]);

  function switchSegment(next: Segment) {
    setSegment(next);
    setPicked(new Set());
    setBulkError(null);
    const params = new URLSearchParams(window.location.search);
    if (next === "staging") params.delete("seg");
    else params.set("seg", next);
    const query = params.toString();
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (query ? `?${query}` : "") + window.location.hash,
    );
  }

  function isArmed(what: Armed): boolean {
    return armed !== null && sameArmed(armed.what, what);
  }

  /* First press arms, second runs. Arming anything disarms whatever else was
     armed, and a press inside the guard window is swallowed as a double
     click. */
  function armOrRun(what: Armed, run: () => void) {
    const current = armed;
    if (!current || !sameArmed(current.what, what)) {
      setArmed({ at: armStamp(), what });
      return;
    }
    if (armedTooRecently(current.at)) return;
    setArmed(null);
    run();
  }

  function markBusy(key: string, on: boolean) {
    setBusy((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  /* Cards are built from every pending item of a demo, then narrowed to the
     demos that are actually waiting on this viewer. The bug_validation item
     always belongs to Driftwood, so a demo with no customer-decidable item is
     still in our own gate and never reaches their page. */
  const reviewDemos: StagedDemo[] =
    staging.status === "ready" ? readyForYou(groupStagedDemos(staging.data.items)) : [];
  /* Staging, from both sources, newest first. A demo the library holds and a
     review item covers is one card, and the review item keeps it: that copy
     carries the email. */
  const stagedDemos: StagedDemo[] = stagedWithLibrary(
    reviewDemos,
    library.status === "ready" ? library.data.rows : [],
    queue.status === "ready" ? queue.data.sends : [],
  );
  /* The cards a decision can act on: the ones with an email, whose review
     item the decide endpoint names. */
  const decidable = stagedDemos.filter((demo) => demo.canDecide);
  /* Only demo approval participates in the bulk action. Email approval stays
     on the individual card next to the exact recipient and copy. */
  const approvable = approvableDemos(stagedDemos);
  /* Approved demos still preparing recipients belong in Staging. */
  const approvedRows = approvedNotScheduled(
    library.status === "ready" ? library.data.rows : [],
  );
  /* What one press of Approve all covers, and the number it confirms with. */
  const approveAllCount = approvable.length;
  const libraryCards = stagedDemos.filter((demo) => demo.library !== null);
  const emailGroups = groupEmailReviews(decidable);

  const rows =
    /* The account pools are no longer read here: the From cell comes from the
       row, so the page does not ask the accounts endpoint at all. */
    queue.status === "ready" ? queueRows(queue.data.sends, heldIds, EMPTY_SENDERS) : [];
  const allHeld = rows.length > 0 && rows.every((row) => row.held);
  const queueDays = groupQueueByDay(rows, limits);
  const { shown: openDays, later: laterDays } = splitQueueDays(queueDays, OPEN_DAYS);
  /* The row that already sends first. Moving it to the top does nothing, so
     its control says so instead of pretending (ux-principles rule 8). */
  const firstQueuedId = queueDays[0]?.rows[0]?.send.id ?? null;
  /* Today stands open, the rest fold, until the reader says otherwise. */
  const dayIsOpen = (day: QueueDay) => dayState[day.day] ?? day.day === queueDays[0]?.day;
  /* Selected rows in the order the table shows them, which is the order a
     bulk action runs in. */
  const pickedRows = queueDays.flatMap((day) =>
    day.rows.filter((row) => picked.has(row.send.id)),
  );
  /* The days actually on screen: the open ones, plus the later ones only
     while they are expanded and paged in. */
  const visibleDays = laterOpen
    ? [...openDays, ...laterDays.slice(0, laterShown)]
    : openDays;
  /* The From column exists only if a row in view would fill it. Read from the
     rows, not from the account list: a workspace with three mailboxes whose
     rows name none of them still has nothing to put in the column, and a
     header over empty cells is worse than no column. */
  const showAccount = visibleDays.some((day) => day.rows.some((row) => rowSender(row) !== null));
  const sentDays = sent.status === "ready" ? groupSentByDay(sent.data.sends) : [];

  /* Staging until the lists land and say otherwise: it is where a new
     workspace's first demo shows up. */
  const shown: Segment = segment ?? "staging";

  /* One decide POST carries only the email copy the customer just reviewed. */
  async function submitDecision(
    demo: StagedDemo,
    decision: "approve" | "deny",
    reason: string | undefined,
    done: string,
  ) {
    markBusy(demo.key, true);
    setCardError(null);
    try {
      const result = await decide(decisionsFor(demo, decision, reason), demo.policyVersion);
      if (result.skipped.length) {
        void loadStaging(true);
        void loadQueue(true);
        throw new Error("Some items changed or were already reviewed. Refreshing reviews and Queue; check which emails were approved before trying again.");
      }
      setStaging((prev) =>
        prev.status === "ready"
          ? {
              status: "ready",
              data: {
                ...prev.data,
                items: prev.data.items.filter((item) => !demo.itemIds.includes(item.id)),
              },
            }
          : prev,
      );
      setChangeOpen((prev) => (prev === demo.key ? null : prev));
      setDrafts((prev) => {
        if (!(demo.key in prev)) return prev;
        const next = { ...prev };
        delete next[demo.key];
        return next;
      });
      setArmed((prev) =>
        prev && "key" in prev.what && prev.what.key === demo.key ? null : prev,
      );
      announceDemosCountChanged();
      if (decision !== "approve") {
        toast(done, "success");
      } else {
        /* An approved demo joins the END of the queue, so the customer is
           told which day that is rather than left to go and count. */
        const leadId = demo.lead?.lead_id ?? null;
        void (async () => {
          const day = leadId ? await landingDayFor(leadId).catch(() => null) : null;
          toast(day ? `Queued for ${daySentence(day)}.` : done, "success");
        })();
        void loadQueue(true);
      }
    } catch (error) {
      setCardError({
        key: demo.key,
        message: error instanceof Error ? error.message : LOAD_FAILED,
      });
    } finally {
      markBusy(demo.key, false);
    }
  }

  async function approveEmailGroup(group: ReturnType<typeof groupEmailReviews>[number]) {
    const emails = group.emails;
    if (!emails.length || emails.some((email) => !email.canDecide || !email.lead?.email || email.policyVersion !== emails[0].policyVersion)) return;
    const key = `email-group:${group.key}`;
    emails.forEach((email) => markBusy(email.key, true));
    await submitDecision({
      ...emails[0], key, lead: null,
      itemIds: [...new Set(emails.flatMap((email) => email.itemIds))],
      decidableIds: [...new Set(emails.flatMap((email) => email.decidableIds))],
    }, "approve", undefined, `${emails.length} emails approved. Check Queue for their sending times.`);
    emails.forEach((email) => markBusy(email.key, false));
  }

  /* A demo with no email yet has no review item, so a change to it cannot be
     a decision. It goes out the way the library's own note always did. */
  async function sendLibraryChange(demo: StagedDemo, text: string) {
    const row = demo.library;
    if (!row) return;
    markBusy(demo.key, true);
    setCardError(null);
    try {
      await sendFeedback(row, text, "needs_changes");
      setChangeOpen((prev) => (prev === demo.key ? null : prev));
      setDrafts((prev) => {
        if (!(demo.key in prev)) return prev;
        const next = { ...prev };
        delete next[demo.key];
        return next;
      });
      toast("Change sent.", "success");
    } catch (error) {
      setCardError({
        key: demo.key,
        message: error instanceof Error ? error.message : LOAD_FAILED,
      });
    } finally {
      markBusy(demo.key, false);
    }
  }

  /* An approval the customer just made, written onto the rows the page is
     already holding. Without it an approved demo would sit in Staging until
     the next read of the library. */
  function patchApprovals(demoKeys: readonly string[], approval: DemoApproval) {
    const keys = new Set(demoKeys);
    setLibrary((prev) =>
      prev.status === "ready"
        ? {
            status: "ready",
            data: {
              ...prev.data,
              rows: prev.data.rows.map((row) =>
                keys.has(row.demo_id) ? { ...row, approval } : row,
              ),
            },
          }
        : prev,
    );
  }

  /* One approve press: a demo, and the name the customer typed when they
     typed one. Answers whether it went through, so the caller says the right
     thing, and reports a 404 as "not available yet" through its own `fail`,
     because the two callers put that line in different places. */
  async function runApprove(
    demoKey: string,
    busyKey: string,
    hint: string | undefined,
    fail: (message: string) => void,
  ): Promise<boolean> {
    markBusy(busyKey, true);
    const result = await approveDemo(demoKey, hint);
    markBusy(busyKey, false);
    if (!result.ok) {
      fail(result.missing ? NOT_AVAILABLE : result.message);
      return false;
    }
    patchApprovals([demoKey], {
      status: readApprovalStatus(result.result?.status),
      approved_at: result.result?.approved_at ?? new Date().toISOString(),
      note: null,
    });
    announceDemosCountChanged();
    return true;
  }

  /* Approve, on a demo with no email of its own. */
  async function approveCard(demo: StagedDemo) {
    const demoKey = approveKeyOf(demo);
    if (!demoKey) return;
    setCardError(null);
    const ok = await runApprove(demoKey, demo.key, undefined, (message) =>
      setCardError({ key: demo.key, message }),
    );
    if (ok) toast(autoApproved ? "Demo approved. Recipients and emails will be prepared for Driftwood review." : "Demo approved. Recipients and emails will be prepared for your review.", "success");
  }

  /* The name the customer added to a demo nobody was found for. It rides the
     same endpoint, so the row answers with the state it moves to. */
  async function addName(row: ApprovedRow) {
    const name = (hints[row.demoKey] ?? "").trim();
    if (!name) return;
    setRowError(null);
    const ok = await runApprove(row.demoKey, row.demoKey, name, (message) =>
      setRowError({ id: row.demoKey, message }),
    );
    if (!ok) return;
    setHintOpen((prev) => (prev === row.demoKey ? null : prev));
    setHints((prev) => {
      if (!(row.demoKey in prev)) return prev;
      const next = { ...prev };
      delete next[row.demoKey];
      return next;
    });
    toast(`${name} added.`, "success");
  }

  /* Bulk approval is only for demos. It must never also approve email copy. */
  async function runApproveAll() {
    const keys = approvable.map(approveKeyOf).filter((key): key is string => key !== null);
    if (keys.length === 0) return;
    markBusy("all", true);
    setCardError(null);
    const result = await approveDemos(keys);
    markBusy("all", false);
    if (!result.ok) {
      setCardError({ key: "all", message: result.missing ? NOT_AVAILABLE : result.message });
      return;
    }
    const accepted = result.result?.accepted_keys ?? keys;
    patchApprovals(accepted, { status: "queued", approved_at: new Date().toISOString(), note: null });
    if (accepted.length) {
      toast(`${accepted.length.toLocaleString()} demos approved. ${autoApproved ? "Driftwood will review recipients and emails." : "Review recipients and emails when they are ready."}`, "success");
      announceDemosCountChanged();
    }
    const rejected = result.result?.rejected ?? [];
    if (rejected.length) setCardError({ key: "all", message: rejected[0].reason });
  }

  /* Pin and its inverse. Pinning keeps a demo past the 3-day expiry, and
     unpinning lets it expire again: a state the customer can enter and not
     leave is the bug this pair exists to close. */
  async function togglePin(demo: StagedDemo) {
    const isPinned = pinned.has(demo.key);
    markBusy(demo.key, true);
    setCardError(null);
    const result = isPinned ? await unpinDemo(demo.pinId) : await pinDemo(demo.pinId);
    markBusy(demo.key, false);
    if (result.ok) {
      setPinned((prev) => {
        const next = new Set(prev);
        if (isPinned) next.delete(demo.key);
        else next.add(demo.key);
        return next;
      });
      toast(isPinned ? "Unpinned." : "Pinned.", "success");
      return;
    }
    /* Nothing serves pinning yet. Hide the control rather than offer a dead
       one, but never while a demo is pinned: that would strip the only way
       back out of the state. */
    if (result.missing && !isPinned) setPinnable(false);
    else setCardError({ key: demo.key, message: result.missing ? NOT_AVAILABLE : result.message });
  }

  /* Move to top puts the demo in the first slot of today. Today is bounded by
     the day's sending limit, so the last row of today moves to tomorrow, and
     the backend cascades that forward when tomorrow is full too. The toast
     names what moved, because a send that changed day without being mentioned
     is a change made behind the customer's back. */
  async function moveRowToTop(send: SendRow) {
    markBusy(send.id, true);
    setRowError(null);
    const result = await moveToTop(send.id);
    markBusy(send.id, false);
    if (!result.ok) {
      setRowError({ id: send.id, message: result.missing ? NOT_AVAILABLE : result.message });
      return;
    }
    const moved = result.result?.displaced?.[0];
    const who = moved?.company || moved?.name;
    toast(
      who && moved?.projected_date
        ? `${who} moved to ${daySentence(moved.projected_date)} to make room.`
        : "Moved to the top of today.",
      "success",
    );
    void loadQueue(true);
  }

  /* Unstage takes the demo out of the queue and back to Staging as a card,
     un-approved, which is the only way back once something is approved. It
     un-approves work the customer already decided, so it arms first. */
  async function unstageRow(send: SendRow) {
    markBusy(send.id, true);
    setRowError(null);
    const result = await queueAction(send.id, "unstage");
    markBusy(send.id, false);
    if (!result.ok) {
      setRowError({ id: send.id, message: result.missing ? NOT_AVAILABLE : result.message });
      return;
    }
    setQueue((prev) =>
      prev.status === "ready"
        ? {
            status: "ready",
            data: { ...prev.data, sends: prev.data.sends.filter((row) => row.id !== send.id) },
          }
        : prev,
    );
    toast("Back in Staging.", "success");
    announceDemosCountChanged();
    void loadStaging(true);
  }

  function toggleDayOpen(day: QueueDay) {
    setDayState((prev) => {
      const next = { ...prev, [day.day]: !dayIsOpen(day) };
      writeDayState(next);
      return next;
    });
  }

  function toggleRowPicked(sendId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(sendId)) next.delete(sendId);
      else next.add(sendId);
      return next;
    });
  }

  function toggleDayPicked(day: QueueDay, on: boolean) {
    setPicked((prev) => {
      const next = new Set(prev);
      for (const row of day.rows) {
        if (on) next.add(row.send.id);
        else next.delete(row.send.id);
      }
      return next;
    });
  }

  /* Several rows against a one-row endpoint: run them in the order the table
     shows, top row first, so the result is the order the reader saw. */
  async function bulkMoveToTop() {
    const rowsToMove = pickedRows;
    if (rowsToMove.length === 0) return;
    markBusy("bulk", true);
    setBulkError(null);
    let moved = 0;
    for (const row of rowsToMove) {
      const result = await moveToTop(row.send.id);
      if (!result.ok) {
        setBulkError(result.missing ? NOT_AVAILABLE : result.message);
        break;
      }
      moved += 1;
    }
    markBusy("bulk", false);
    if (moved > 0) {
      toast(`${moved.toLocaleString()} moved to the top of today.`, "success");
      setPicked(new Set());
      void loadQueue(true);
    }
  }

  async function bulkUnstage() {
    const rowsToPull = pickedRows;
    if (rowsToPull.length === 0) return;
    markBusy("bulk", true);
    setBulkError(null);
    const done = new Set<string>();
    for (const row of rowsToPull) {
      const result = await queueAction(row.send.id, "unstage");
      if (!result.ok) {
        setBulkError(result.missing ? NOT_AVAILABLE : result.message);
        break;
      }
      done.add(row.send.id);
    }
    markBusy("bulk", false);
    if (done.size === 0) return;
    setQueue((prev) =>
      prev.status === "ready"
        ? {
            status: "ready",
            data: { ...prev.data, sends: prev.data.sends.filter((row) => !done.has(row.id)) },
          }
        : prev,
    );
    setPicked(new Set());
    toast(`${done.size.toLocaleString()} back in Staging.`, "success");
    announceDemosCountChanged();
    void loadStaging(true);
  }

  async function runPauseOrResumeAll() {
    markBusy("sends", true);
    setBulkQueueError(null);
    const result = allHeld ? await resumeAllSends() : await holdAllSends();
    markBusy("sends", false);
    if (!result.ok) {
      setBulkQueueError(result.missing ? NOT_AVAILABLE : result.message);
      return;
    }
    setHeldIds(allHeld ? new Set() : new Set(rows.map((row) => row.send.id)));
    toast(allHeld ? "Sends resumed." : "Sends paused.", "success");
  }

  /* Both of Staging's sources have to be whole before it can carry a number:
     half a list is a wrong number, not a smaller one. */
  const stagingLoaded =
    staging.status === "ready" &&
    staging.data.complete &&
    library.status === "ready" &&
    library.data.complete;
  /* What the library says it holds, against what actually arrived. They
     differ when a page failed, or when a library is bigger than the page
     guard fetches. Either way the list is short, and a short list carries a
     line rather than a count that understates the work. */
  const libraryTotal = library.status === "ready" ? library.data.total : 0;
  const libraryLoaded = library.status === "ready" ? library.data.rows.length : 0;
  const libraryShort =
    library.status === "ready" && library.data.complete && libraryLoaded < libraryTotal;
  const stagingCount = stagingLoaded && !libraryShort ? stagedDemos.length : null;
  /* One source still paging in. The list already paints; a whole-list action
     waits for the rest. */
  const stagingMore =
    (staging.status === "ready" && !staging.data.complete) ||
    (library.status === "ready" && !library.data.complete);
  const stagingFailed = staging.status === "error" || library.status === "error";
  const retryStaging = () => {
    setStaging({ status: "loading" });
    setLibrary({ status: "loading" });
    void loadStaging(true);
    void loadLibrary(true);
  };
  /* Queue counts actual sends only, after all pages arrive. */
  const queueCount =
    queue.status === "ready" && queue.data.complete
      ? rows.length
      : null;
  /* The count is what the segment lists, not what the ledger holds: the
     ledger also carries connection requests, which are not demos and are not
     on this page, so `total` would name rows the reader cannot find. */
  const sentCount = sent.status === "ready" ? sentDays.reduce((n, day) => n + day.rows.length, 0) : null;
  const stagingListed = stagingCount === null ? null : libraryCards.length + approvedRows.length;
  const counts: Record<Segment, number | null> = {
    /* Nothing waits on a customer whose demos Driftwood approves, so an empty
       Staging carries no number rather than a zero that reads as "empty". The
       demos with no email yet still count: they are the customer's own work,
       whoever approves. */
    staging: stagingListed === 0 ? null : stagingListed,
    review: staging.status === "ready" && staging.data.complete ? decidable.length : null,
    queue: queueCount,
    sent: sentCount,
  };

  function emailGroupDisabledReason(group: ReturnType<typeof groupEmailReviews>[number]): string | undefined {
    if (staging.status !== "ready" || !staging.data.complete) return "Available once every email has loaded";
    if (group.emails.some((email) => busy.has(email.key))) return "An email decision is in progress";
    if (group.emails.some((email) => !email.lead?.email)) return "Every recipient needs an email address";
    if (group.emails.some((email) => email.policyVersion !== group.emails[0].policyVersion)) return "Review settings changed. Refresh the emails first";
    return undefined;
  }

  const renderCard = (demo: StagedDemo) => (
    <DemoCard
      key={demo.key}
      demo={demo}
      busy={busy.has(demo.key)}
      pinnable={pinnable || pinned.has(demo.key)}
      pinned={pinned.has(demo.key)}
      armedSkip={isArmed({ kind: "skip", key: demo.key })}
      change={changeOpen === demo.key ? (drafts[demo.key] ?? "") : null}
      error={cardError?.key === demo.key ? cardError.message : null}
      approvable={isApprovable(demo)}
      onApprove={() =>
        demo.library
          ? void approveCard(demo)
          : void submitDecision(demo, "approve", undefined, "Email approved. Check Queue for its sending time.")
      }
      onSkip={() =>
        armOrRun({ kind: "skip", key: demo.key }, () =>
          void submitDecision(demo, "deny", "Recipient skipped during email review", "Skipped."),
        )
      }
      onOpenChange={() =>
        setChangeOpen((prev) => (prev === demo.key ? null : demo.key))
      }
      onChangeText={(text) =>
        setDrafts((prev) => ({ ...prev, [demo.key]: text }))
      }
      onSendChange={() => {
        const text = (drafts[demo.key] ?? "").trim();
        if (!text) return;
        if (demo.library) void sendLibraryChange(demo, text);
        else void submitDecision(demo, "deny", text, "Change sent.");
      }}
      onPin={() => void togglePin(demo)}
    />
  );

  return (
    <section className="demos-page" aria-labelledby="demos-heading">
      <div className="dp-head">
        <h1 id="demos-heading">Demos</h1>
      </div>

      <div className="dp-segments">
        {SEGMENTS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={shown === id}
            onClick={() => switchSegment(id)}
          >
            {label}
            {counts[id] !== null && (
              <span className="dp-count">{counts[id]!.toLocaleString()}</span>
            )}
          </button>
        ))}
      </div>

      {(shown === "staging" || shown === "review") && (
        <>
          <p className="dp-note">
            {shown === "staging"
              ? autoApproved
                ? "Approve a demo to prepare recipients and draft emails. Driftwood reviews outreach under your workspace review settings."
                : "Approve a demo to prepare recipients and draft emails. You review each email before it is queued."
              : "Check each recipient and the complete email. Approving an email adds it to Queue for the next available sending slot."}
          </p>
          <div className="dp-bar is-bare">
            <div>
              {stagingMore ? (
                <p className="dp-quiet" role="status">
                  Loading the rest.
                  {library.status === "ready" && !library.data.complete &&
                    ` ${libraryLoaded.toLocaleString()} of ${libraryTotal.toLocaleString()} demos so far.`}
                </p>
              ) : (
                libraryShort && (
                  /* The whole library did not fit, so the page says what it
                     is showing instead of counting it wrong. */
                  <p className="dp-quiet" role="status">
                    Showing {libraryLoaded.toLocaleString()} of{" "}
                    {libraryTotal.toLocaleString()} demos.
                  </p>
                )
              )}
            </div>
            {shown === "staging" && approveAllCount > 1 && (
              <div className="dp-bar-actions">
                <button
                  type="button"
                  className={`dp-btn ${isArmed({ kind: "approve-all" }) ? "is-armed" : "is-primary"}`}
                  onClick={() => armOrRun({ kind: "approve-all" }, () => void runApproveAll())}
                  disabled={busy.has("all") || !stagingLoaded}
                  title={
                    busy.has("all")
                      ? "Approving these demos now"
                      : !stagingLoaded
                        ? "Available once the whole list loads"
                        : undefined
                  }
                >
                  {busy.has("all")
                    ? "Approving"
                    : isArmed({ kind: "approve-all" })
                      ? `Approve ${approveAllCount.toLocaleString()} demos? Confirm`
                      : "Approve all demos"}
                </button>
              </div>
            )}
          </div>
          {cardError?.key === "all" && (
            <p className="dp-error" role="alert">
              {cardError.message}
            </p>
          )}
          {staging.status === "loading" && library.status === "loading" ? (
            <CardSkeletons />
          ) : (shown === "review" ? decidable.length : libraryCards.length + approvedRows.length) === 0 && stagingFailed ? (
            /* One source failing with the other empty leaves nothing to
               paint, and "nothing waiting for you" would be a lie about a
               read that did not land. */
            <ErrorState message={LOAD_FAILED} onRetry={retryStaging} />
          ) : (shown === "review" ? decidable.length : libraryCards.length + approvedRows.length) === 0 ? (
            <div className="dp-empty">
              <p>{shown === "review" ? "No emails waiting for your review. Approved demos appear here once recipients and drafts are ready." : EMPTY_STAGING}</p>
              <button type="button" className="dp-btn" onClick={() => switchSegment("queue")}>
                See Queue
              </button>
            </div>
          ) : (
            <div className="dp-cards">
              {shown === "review" ? emailGroups.map((group) => (
                <section className="dp-email-group" key={group.key} aria-label={`${group.company} email review`}>
                  <h2 className="dp-group-heading">{group.company} <span>{group.emails.length} {group.emails.length === 1 ? "email" : "emails"} to review</span></h2>
                  {group.emails.map(renderCard)}
                  {group.emails.length > 1 && (
                    <div className="dp-group-approve">
                      <button
                        type="button"
                        className={`dp-btn ${isArmed({ kind: "approve-group", key: group.key }) ? "is-armed" : "is-primary"}`}
                        disabled={Boolean(emailGroupDisabledReason(group))}
                        title={emailGroupDisabledReason(group) ?? "Queues only the complete emails shown above for this company"}
                        onClick={() => armOrRun({ kind: "approve-group", key: group.key }, () => void approveEmailGroup(group))}
                      >
                        {busy.has(`email-group:${group.key}`) ? "Queuing emails" : isArmed({ kind: "approve-group", key: group.key }) ? `Queue ${group.emails.length} emails? Confirm` : `Approve ${group.emails.length} emails & queue`}
                      </button>
                      {cardError?.key === `email-group:${group.key}` && <p className="dp-error" role="alert">{cardError.message}</p>}
                    </div>
                  )}
                </section>
              )) : libraryCards.map(renderCard)}
            </div>
          )}
          {shown === "staging" && approvedRows.length > 0 && (
            <ApprovedGroup
              rows={approvedRows}
              customerReviews={!autoApproved}
              busy={busy}
              rowError={rowError}
              openName={hintOpen}
              names={hints}
              onOpenName={(key) => setHintOpen((prev) => (prev === key ? null : key))}
              onNameText={(key, text) => setHints((prev) => ({ ...prev, [key]: text }))}
              onAddName={(row) => void addName(row)}
            />
          )}
        </>
      )}

      {shown === "queue" && (
        <>
          <div className="dp-bar">
            {queue.status === "ready" ? (
              <p className="dp-note is-flush">
                {queueHeadline(runsThrough(staging.status === "ready" ? staging.data.stats : []))}
              </p>
            ) : (
              /* A line of nothing reads as "there is nothing to say"; this
                 reads as "it is coming", and holds the same height. */
              <p className="dp-note is-flush" role="status" aria-label="Loading the queue">
                <span className="dp-skel dp-skel-headline dp-skel-pulse" />
              </p>
            )}
            {rows.length > 0 && (
              <div className="dp-bar-actions">
                <button
                  type="button"
                  className={`dp-btn ${
                    isArmed({ kind: allHeld ? "resume" : "pause" }) ? "is-armed" : ""
                  }`}
                  onClick={() =>
                    armOrRun({ kind: allHeld ? "resume" : "pause" }, () =>
                      void runPauseOrResumeAll(),
                    )
                  }
                  disabled={busy.has("sends")}
                  title={busy.has("sends") ? "Working on your sends now" : undefined}
                >
                  {busy.has("sends")
                    ? "Working"
                    : allHeld
                      ? isArmed({ kind: "resume" })
                        ? "Resume all sends? Confirm"
                        : "Resume all"
                      : isArmed({ kind: "pause" })
                        ? "Pause all sends? Confirm"
                        : "Pause all sends"}
                </button>
              </div>
            )}
          </div>
          {bulkQueueError && (
            <p className="dp-error" role="alert">
              {bulkQueueError}
            </p>
          )}
          {picked.size > 0 && (
            /* Sticky, so a selection made forty rows down is still actionable
               without scrolling back. */
            <div className="dp-selbar" role="region" aria-label="Selected demos">
              <strong>{picked.size.toLocaleString()} selected</strong>
              <button
                type="button"
                className="dp-btn is-small"
                disabled={busy.has("bulk")}
                onClick={() => void bulkMoveToTop()}
                title={busy.has("bulk") ? "Working on your selection now" : undefined}
              >
                {busy.has("bulk") ? "Working" : "Move to top"}
              </button>
              <button
                type="button"
                className={`dp-btn is-small ${isArmed({ kind: "bulk-unstage" }) ? "is-armed" : ""}`}
                disabled={busy.has("bulk")}
                onClick={() =>
                  armOrRun({ kind: "bulk-unstage" }, () => void bulkUnstage())
                }
                title={busy.has("bulk") ? "Working on your selection now" : undefined}
              >
                {busy.has("bulk")
                  ? "Working"
                  : isArmed({ kind: "bulk-unstage" })
                    ? `Unstage ${picked.size.toLocaleString()}? Confirm`
                    : "Unstage"}
              </button>
              <button
                type="button"
                className="dp-btn is-small"
                onClick={() => {
                  setPicked(new Set());
                  setBulkError(null);
                }}
              >
                Clear
              </button>
              {bulkError && (
                <span className="dp-rowerr" role="alert">
                  {bulkError}
                </span>
              )}
            </div>
          )}
          {queue.status === "loading" ? (
            <RowSkeletons />
          ) : queue.status === "error" ? (
            <ErrorState
              message={queue.message}
              onRetry={() => {
                setQueue({ status: "loading" });
                void loadQueue(true);
              }}
            />
          ) : rows.length === 0 ? (
            (
              <div className="dp-empty">
                <p>{EMPTY_QUEUE}</p>
                <button type="button" className="dp-btn" onClick={() => switchSegment("staging")}>
                  See Staging
                </button>
              </div>
            )
          ) : (
            <>
              {openDays.map((day) => (
                <QueueDayBlock
                  key={day.day}
                  day={day}
                  busy={busy}
                  rowError={rowError}
                  open={dayIsOpen(day)}
                  armedUnstage={(id) => isArmed({ kind: "unstage", key: id })}
                  selected={picked}
                  onToggleOpen={() => toggleDayOpen(day)}
                  onToggleDay={toggleDayPicked}
                  onToggleRow={toggleRowPicked}
                  showAccount={showAccount}
                  firstInQueue={firstQueuedId}
                  onMoveToTop={(send) => void moveRowToTop(send)}
                  onUnstage={(send) =>
                    armOrRun({ kind: "unstage", key: send.id }, () => void unstageRow(send))
                  }
                />
              ))}
              {laterDays.length > 0 && (
                <div className="dp-later">
                  <button
                    type="button"
                    className="dp-later-toggle"
                    aria-expanded={laterOpen}
                    onClick={() => setLaterOpen((open) => !open)}
                  >
                    <span className="dp-caret" aria-hidden="true">
                      {laterOpen ? "\u2013" : "+"}
                    </span>
                    {laterSummary(laterDays)}
                  </button>
                  {laterOpen && (
                    <>
                      {laterDays.slice(0, laterShown).map((day) => (
                        <QueueDayBlock
                          key={day.day}
                          day={day}
                          busy={busy}
                          rowError={rowError}
                          open={dayIsOpen(day)}
                          armedUnstage={(id) => isArmed({ kind: "unstage", key: id })}
                          selected={picked}
                          onToggleOpen={() => toggleDayOpen(day)}
                          onToggleDay={toggleDayPicked}
                          onToggleRow={toggleRowPicked}
                          showAccount={showAccount}
                          firstInQueue={firstQueuedId}
                  onMoveToTop={(send) => void moveRowToTop(send)}
                          onUnstage={(send) =>
                            armOrRun({ kind: "unstage", key: send.id }, () => void unstageRow(send))
                          }
                        />
                      ))}
                      {laterShown < laterDays.length && (
                        <button
                          type="button"
                          className="dp-btn"
                          onClick={() => setLaterShown((shown) => shown + LATER_PAGE)}
                        >
                          Show {Math.min(LATER_PAGE, laterDays.length - laterShown).toLocaleString()} more
                          days
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
              {queue.status === "ready" && !queue.data.complete && (
                <p className="dp-quiet" role="status">
                  Loading the rest.
                </p>
              )}
            </>
          )}
        </>
      )}
      {shown === "sent" && (
        <>
          {sent.status === "loading" ? (
            <RowSkeletons />
          ) : sent.status === "error" ? (
            <ErrorState
              message={sent.message}
              onRetry={() => {
                setSent({ status: "loading" });
                void loadSent(true);
              }}
            />
          ) : sentDays.length === 0 ? (
            <div className="dp-empty">
              <p>{EMPTY_SENT}</p>
              <button type="button" className="dp-btn" onClick={() => switchSegment("queue")}>
                See Queue
              </button>
            </div>
          ) : (
            <div className="dp-tablewrap dp-rows">
              <table className="dp-table">
                <thead>
                  <tr>
                    <th scope="col">Contact</th>
                    <th scope="col">Company</th>
                    <th scope="col">Channel</th>
                    <th scope="col">
                      <span className="sr-only">Reply</span>
                    </th>
                    <th scope="col">
                      <span className="sr-only">Thread</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sentDays.map((day) => (
                    <SentDayRows key={day.day} label={day.label} rows={day.rows} replied={replied} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ---------- one demo ---------- */

function DemoCard({
  demo,
  busy,
  pinnable,
  pinned,
  armedSkip,
  change,
  error,
  approvable,
  onApprove,
  onSkip,
  onOpenChange,
  onChangeText,
  onSendChange,
  onPin,
}: {
  demo: StagedDemo;
  busy: boolean;
  pinnable: boolean;
  pinned: boolean;
  armedSkip: boolean;
  change: string | null;
  error: string | null;
  /* True on a demo with no email of its own that nobody has approved yet:
     Approve names the demo, not a review item. */
  approvable: boolean;
  onApprove: () => void;
  onSkip: () => void;
  onOpenChange: () => void;
  onChangeText: (text: string) => void;
  onSendChange: () => void;
  onPin: () => void;
}) {
  const lead = demo.lead;
  const videoRef = useRef<HTMLVideoElement>(null);
  /* Review items name a demo by slug, hosted at /d/<slug>. A library row
     carries its own url. */
  const clipHref = demo.videoUrl ?? (demo.videoSlug ? `/d/${demo.videoSlug}` : null);
  /* A still or a page cannot play in a video element, so it opens in a tab
     instead of rendering as a clip that failed. */
  const playsInPlace = demo.library === null || demo.library.content_type.startsWith("video/");
  /* A clip that will not play has no moment to jump to, so the timestamp
     link goes with it rather than becoming a dead click. */
  const [failedVideoUrl, setFailedVideoUrl] = useState<string | null>(null);
  const videoFailed = failedVideoUrl === clipHref;

  /* The timestamp link drives the clip on this card: jump there, play, and
     bring the player into view, since it sits under the email. */
  function seekVideo(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = seconds;
    video.scrollIntoView({ block: "center", behavior: "smooth" });
    void video.play().catch(() => {
      /* Autoplay can be refused; the frame is already at the right moment. */
    });
  }

  return (
    <article className="dp-card" aria-label={demo.heading}>
      {/* Name, company and title on one line: three lines of the same person
          was three lines of chrome. */}
      <div className="dp-card-top">
        <h3>
          {lead?.linkedin_url ? (
            <a href={lead.linkedin_url} target="_blank" rel="noopener noreferrer">
              {demo.heading}
            </a>
          ) : (
            demo.heading
          )}
          {lead?.title && <span className="dp-role"> &middot; {lead.title}</span>}
        </h3>
        <span className="dp-age">{ageLabel(demo.createdAt)}</span>
      </div>

      {/* Two columns: the clip holds a narrow left rail, the email takes the
          rest. Stacked in one column the card ran past a screen while half
          the width sat empty. */}
      <div className="dp-card-body">
        <div className="dp-col-clip">
          {clipHref && (
            <DemoVideo
              key={`${playsInPlace}:${clipHref}`}
              ref={videoRef}
              href={clipHref}
              label={demo.heading}
              playable={playsInPlace}
              onFailed={() => setFailedVideoUrl(clipHref)}
            />
          )}
          {/* A demo made for a review item says which bug it shows. A demo
              from the library says what it is, in the words it was made
              with. Either way it is one line under the clip. */}
          {demo.library ? (
            demo.note && <p className="dp-idea">{demo.note}</p>
          ) : (
            <BugLine
              demo={demo}
              playable={Boolean(clipHref) && playsInPlace && !videoFailed}
              onSeek={seekVideo}
            />
          )}
        </div>
        {demo.body && (
          <div className="dp-col-email">
            {/* The whole email, always. It is the content; everything else on
                this card is chrome. The subject is bold text, not a labelled
                row, and the body carries no box of its own. */}
            <p className="dp-recipient"><span>To</span> {lead?.name || "Recipient"}{lead?.email ? ` <${lead.email}>` : " · Email address unavailable"}</p>
            {demo.subject && <p className="dp-subject">{demo.subject}</p>}
            <div className="dp-email">
              <EmailPreview
                subject={null}
                body={demo.body}
              />
            </div>
          </div>
        )}
      </div>

      {(demo.canDecide || demo.library !== null) && (
        <>
          <div className="dp-actions">
            {/* A demo approval prepares outreach; an email approval queues
                only the exact recipient and copy on this card. */}
            {(demo.canDecide || approvable) && (
              <button
                type="button"
                className="dp-btn is-primary"
                onClick={onApprove}
                disabled={busy || (!demo.library && !lead?.email)}
                title={busy ? "Working on this demo now" : !demo.library && !lead?.email ? "A recipient email address is required before queuing" : undefined}
              >
                {busy ? "Working" : demo.library ? "Approve demo" : "Approve email & queue"}
              </button>
            )}
            <button
              type="button"
              className={`dp-btn ${change !== null ? "is-on" : ""}`}
              onClick={onOpenChange}
              aria-expanded={change !== null}
              disabled={busy}
              title={busy ? "Working on this demo now" : undefined}
            >
              Ask for a change
            </button>
            {demo.canDecide && (
              <button
                type="button"
                className={`dp-btn ${armedSkip ? "is-armed" : ""}`}
                onClick={onSkip}
                disabled={busy}
                title={busy ? "Working on this demo now" : undefined}
              >
                {busy ? "Working" : armedSkip ? "Skip? Confirm" : "Skip"}
              </button>
            )}
            {demo.canDecide && pinnable && (
              <button
                type="button"
                className={`dp-btn ${pinned ? "is-on" : ""}`}
                onClick={onPin}
                aria-pressed={pinned}
                disabled={busy}
                title={busy ? "Working on this demo now" : undefined}
              >
                {busy ? "Working" : pinned ? "Unpin" : "Pin"}
              </button>
            )}
          </div>
          {change !== null && (
            <div className="dp-change">
              <label className="dp-label" htmlFor={`change-${demo.key}`}>
                What should change?
              </label>
              <textarea
                id={`change-${demo.key}`}
                value={change}
                onChange={(event) => onChangeText(event.target.value)}
              />
              <div className="dp-change-row">
                <button
                  type="button"
                  className="dp-btn is-primary"
                  onClick={onSendChange}
                  disabled={busy || change.trim().length === 0}
                  title={
                    busy
                      ? "Sending your note now"
                      : change.trim().length === 0
                        ? "Say what should change first"
                        : undefined
                  }
                >
                  {busy ? "Sending" : "Send"}
                </button>
                <button
                  type="button"
                  className="dp-btn"
                  onClick={onOpenChange}
                  disabled={busy}
                  title={busy ? "Sending your note now" : undefined}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {error && (
        <p className="dp-error" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}

/* One line for where the bug shows, and the steps behind a disclosure. The
   device is gone from the card: it does not help anyone decide whether to
   send this demo, and it cost a whole row above the clip. */
function BugLine({
  demo,
  playable,
  onSeek,
}: {
  demo: StagedDemo;
  playable: boolean;
  onSeek: (seconds: number) => void;
}) {
  const [stepsOpen, setStepsOpen] = useState(false);
  const evidence = demo.evidence;
  const steps = Array.isArray(evidence?.repro_steps) ? evidence.repro_steps : [];
  const seconds = videoSeconds(evidence?.video_timestamp);
  const href = evidence?.url
    ? /^https?:\/\//i.test(evidence.url)
      ? evidence.url
      : `https://${evidence.url}`
    : null;
  const hasSteps = steps.length > 0 || Boolean(href);
  const canSeek = seconds !== null && playable;
  if (!canSeek && !hasSteps) return null;
  return (
    <div className="dp-bugline">
      <p>
        {canSeek && (
          <button type="button" className="dp-seek" onClick={() => onSeek(seconds)}>
            Bug visible at {timestampLabel(seconds)}
          </button>
        )}
        {hasSteps && (
          <button
            type="button"
            className="dp-seek is-quiet"
            aria-expanded={stepsOpen}
            onClick={() => setStepsOpen((open) => !open)}
          >
            {stepsOpen ? "Hide steps" : "Show steps"}
          </button>
        )}
      </p>
      {stepsOpen && hasSteps && (
        <div className="dp-steps">
          {steps.length > 0 && (
            <ol>
              {steps.map((step, index) => (
                <li key={index}>{step}</li>
              ))}
            </ol>
          )}
          {href && (
            <p>
              <a href={href} target="_blank" rel="noopener noreferrer">
                {evidence?.url}
              </a>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* The clip: a real thumbnail with its length in the corner, which is the
   first frame the file itself reports. A clip that genuinely will not render
   keeps the same frame, a play mark and a way out to a tab, rather than
   turning the card's biggest element into an error message.

   The frame takes the shape of the file. loadedmetadata is the one moment the
   element knows both its length and its pixel size, so the badge and the
   ratio are set together, in one render: the space was already reserved at
   16:9, and it is replaced in a single step rather than in stages. */
function DemoVideo({
  ref,
  href,
  label,
  playable,
  onFailed,
}: {
  ref: RefObject<HTMLVideoElement | null>;
  href: string;
  label: string;
  /* False for a demo that is a still or a page: it opens in a tab, which is
     the same frame a clip that will not play already falls back to. */
  playable: boolean;
  onFailed: () => void;
}) {
  const [duration, setDuration] = useState<string | null>(null);
  const [failed, setFailed] = useState(!playable);
  const shell = useRef<HTMLDivElement>(null);
  const [loadMedia, setLoadMedia] = useState(false);
  useEffect(() => {
    const node = shell.current;
    if (!node || !playable) return;
    // A large library can contain hundreds of authenticated video endpoints.
    // Omitting src until the clip is nearby prevents opening all of them at
    // once. Once loaded, scrolling away preserves its playhead and controls.
    if (typeof IntersectionObserver === "undefined") {
      const check = () => {
        const rect = node.getBoundingClientRect();
        if (rect.top < window.innerHeight + 200 && rect.bottom > -200) {
          setLoadMedia(true);
          window.removeEventListener("scroll", check, true);
          window.removeEventListener("resize", check);
        }
      };
      window.addEventListener("scroll", check, { capture: true, passive: true });
      window.addEventListener("resize", check, { passive: true });
      check();
      return () => {
        window.removeEventListener("scroll", check, true);
        window.removeEventListener("resize", check);
      };
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setLoadMedia(true);
      observer.disconnect();
    }, { rootMargin: "200px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [playable]);
  const [frame, setFrame] = useState<ClipFrame>(RESERVED_CLIP_FRAME);
  return (
    /* The shell is the frame, so the duration badge sits in the corner of the
       clip rather than the corner of the rail around it. */
    <div
      ref={shell}
      className={`dp-video-shell${frame.portrait ? " is-portrait" : ""}`}
      style={{ aspectRatio: frame.aspectRatio, width: frame.width }}
    >
      {failed ? (
        <a
          className="dp-video dp-video-dead"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open the demo for ${label} in a new tab`}
        >
          <span className="dp-play" aria-hidden="true" />
          <span className="dp-video-out">Opens in a new tab</span>
        </a>
      ) : (
        <video
          ref={ref}
          className="dp-video"
          controls
          playsInline
          preload={loadMedia ? "metadata" : "none"}
          src={loadMedia ? href : undefined}
          onFocus={() => setLoadMedia(true)}
          aria-label={`Demo for ${label}`}
          onError={() => {
            setFailed(true);
            onFailed();
          }}
          onLoadedMetadata={() => {
            const video = ref.current;
            if (!video) return;
            const seconds = video.duration;
            if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0)
              setDuration(timestampLabel(seconds));
            setFrame(clipFrame(video.videoWidth, video.videoHeight));
          }}
        />
      )}
      {duration && <span className="dp-duration">{duration}</span>}
    </div>
  );
}

/* ---------- approved, and nobody to send it to yet ---------- */

/* The progress group in Staging. Every row is a demo the customer
   approved, with the company it was made for and the day they approved it.
   A row nobody was found for carries one line and one thing to do about it:
   a name, which goes back through the same approve call. */
function ApprovedGroup({
  rows,
  customerReviews,
  busy,
  rowError,
  openName,
  names,
  onOpenName,
  onNameText,
  onAddName,
}: {
  rows: ApprovedRow[];
  customerReviews: boolean;
  busy: ReadonlySet<string>;
  rowError: { id: string; message: string } | null;
  openName: string | null;
  names: Record<string, string>;
  onOpenName: (demoKey: string) => void;
  onNameText: (demoKey: string, text: string) => void;
  onAddName: (row: ApprovedRow) => void;
}) {
  return (
    <section className="dp-day dp-approved" aria-label={APPROVED_GROUP}>
      <div className="dp-day-head">
        <h2 className="dp-day-name">{APPROVED_GROUP}</h2>
        <span className="dp-day-load">{rows.length.toLocaleString()}</span>
      </div>
      <p className="dp-note">{customerReviews ? "Emails will appear in Review emails. Nothing is queued until you approve the copy." : "Driftwood reviews recipients and emails under your workspace review settings before they are queued."}</p>
      <div className="dp-tablewrap">
        <table className="dp-table">
          <colgroup>
            <col />
            <col className="dp-w-planned" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Approved</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const working = busy.has(row.demoKey);
              const open = openName === row.demoKey;
              const typed = names[row.demoKey] ?? "";
              return (
                <tr key={row.demoKey}>
                  <td>
                    <strong className="dp-progress-company">{row.company}</strong>
                    {row.nobodyLine ? (
                      <>
                        <span className="dp-nobody">{row.nobodyLine}</span>{" "}
                        <button
                          type="button"
                          className="dp-seek"
                          aria-expanded={open}
                          disabled={working}
                          title={working ? "Working on this demo now" : undefined}
                          onClick={() => onOpenName(row.demoKey)}
                        >
                          {ADD_A_NAME}
                        </button>
                      </>
                    ) : (
                      <span className="dp-muted">Preparing recipients and draft emails</span>
                    )}
                    {open && (
                      <div className="dp-name">
                        <label className="dp-label" htmlFor={`name-${row.demoKey}`}>
                          {ADD_A_NAME_LABEL}
                        </label>
                        <input
                          id={`name-${row.demoKey}`}
                          type="text"
                          value={typed}
                          onChange={(event) => onNameText(row.demoKey, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" && typed.trim()) onAddName(row);
                          }}
                        />
                        <div className="dp-name-row">
                          <button
                            type="button"
                            className="dp-btn is-small is-primary"
                            disabled={working || typed.trim().length === 0}
                            title={
                              working
                                ? "Working on this demo now"
                                : typed.trim().length === 0
                                  ? "Type a name first"
                                  : undefined
                            }
                            onClick={() => onAddName(row)}
                          >
                            {working ? "Working" : "Add"}
                          </button>
                          <button
                            type="button"
                            className="dp-btn is-small"
                            disabled={working}
                            onClick={() => onOpenName(row.demoKey)}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {rowError?.id === row.demoKey && (
                      <p className="dp-rowerr" role="alert">
                        {rowError.message}
                      </p>
                    )}
                  </td>
                  <td className="dp-num dp-muted">{approvedLabel(row.approvedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ---------- one day of the queue ---------- */

function QueueDayBlock({
  day,
  open,
  busy,
  rowError,
  showAccount,
  firstInQueue,
  armedUnstage,
  selected,
  onToggleOpen,
  onToggleDay,
  onToggleRow,
  onMoveToTop,
  onUnstage,
}: {
  day: QueueDay;
  open: boolean;
  busy: ReadonlySet<string>;
  rowError: { id: string; message: string } | null;
  showAccount: boolean;
  firstInQueue: string | null;
  armedUnstage: (sendId: string) => boolean;
  selected: ReadonlySet<string>;
  onToggleOpen: () => void;
  onToggleDay: (day: QueueDay, on: boolean) => void;
  onToggleRow: (sendId: string) => void;
  onMoveToTop: (send: SendRow) => void;
  onUnstage: (send: SendRow) => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  const chosen = day.rows.filter((row) => selected.has(row.send.id)).length;
  const all = chosen > 0 && chosen === day.rows.length;

  /* Part of a day selected is neither checked nor clear, and only the DOM
     property can say so. */
  useEffect(() => {
    if (box.current) box.current.indeterminate = chosen > 0 && !all;
  }, [chosen, all]);

  return (
    <section className="dp-day" aria-label={day.label}>
      <div className="dp-day-head">
        <input
          ref={box}
          type="checkbox"
          className="dp-check"
          checked={all}
          onChange={() => onToggleDay(day, !all)}
          aria-label={`Select every demo on ${day.label}`}
        />
        {/* A folded day still shows its name, its count and its chip: folded,
            not hidden. */}
        <button
          type="button"
          className="dp-day-toggle"
          aria-expanded={open}
          onClick={onToggleOpen}
        >
          <svg
            className={`dp-chevron ${open ? "is-open" : ""}`}
            viewBox="0 0 12 12"
            width="11"
            height="11"
            aria-hidden="true"
          >
            <path
              d="M4.5 2.5 8 6l-3.5 3.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="dp-day-name">{day.label}</span>
          <span className="dp-day-load" title={dayChannelTitle(day)}>
            {day.rows.length.toLocaleString()}
          </span>
          {day.full && <span className="dp-chip">Full</span>}
        </button>
      </div>
      {open && (
        <div className="dp-tablewrap">
          <table className="dp-table">
            <colgroup>
              <col className="dp-w-pick" />
              <col />
              <col className="dp-w-channel" />
              <col className="dp-w-planned" />
              {showAccount && <col className="dp-w-from" />}
              <col className="dp-w-menu" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Select</span>
                </th>
                <th scope="col">Who</th>
                <th scope="col">
                  <span className="sr-only">Channel</span>
                </th>
                <th scope="col">Planned</th>
                {showAccount && <th scope="col">From</th>}
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {day.rows.map((row) => (
                <tr key={row.send.id} className={selected.has(row.send.id) ? "is-picked" : ""}>
                  <td>
                    <input
                      type="checkbox"
                      className="dp-check"
                      checked={selected.has(row.send.id)}
                      onChange={() => onToggleRow(row.send.id)}
                      aria-label={`Select the demo for ${row.send.lead?.name ?? "this contact"}`}
                    />
                  </td>
                  <td>
                    {row.send.lead?.name ?? "Not named yet"}
                    {row.send.lead?.company && (
                      <span className="dp-muted">, {row.send.lead.company}</span>
                    )}
                  </td>
                  <td>
                    <ChannelGlyph channel={row.channel} />
                  </td>
                  <td className="dp-num">
                    {row.held ? (
                      <span className="dp-chip">Paused</span>
                    ) : (
                      plannedClock(row.send, row.held)
                    )}
                  </td>
                  {showAccount && <td className="dp-muted">{rowSender(row) ?? ""}</td>}
                  <td>
                    <RowMenu
                      row={row}
                      busy={busy.has(row.send.id)}
                      isFirst={row.send.id === firstInQueue}
                      armedUnstage={armedUnstage(row.send.id)}
                      onMoveToTop={() => onMoveToTop(row.send)}
                      onUnstage={() => onUnstage(row.send)}
                    />
                    {rowError?.id === row.send.id && (
                      <p className="dp-rowerr" role="alert">
                        {rowError.message}
                      </p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* One row's actions, behind one mark. The two verbs written out on every row
   were the same eight words two hundred and forty-five times; as words they
   live in the selection bar, where they are said once. */
function RowMenu({
  row,
  busy,
  isFirst,
  armedUnstage,
  onMoveToTop,
  onUnstage,
}: {
  row: QueueRow;
  busy: boolean;
  isFirst: boolean;
  armedUnstage: boolean;
  onMoveToTop: () => void;
  onUnstage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  function shut(returnFocus: boolean) {
    setOpen(false);
    /* After the commit: focusing the trigger while the menu item is still
       mounted loses the focus to the body when React removes it. */
    if (returnFocus) requestAnimationFrame(() => trigger.current?.focus());
  }

  /* Open means: focus lands inside, Escape leaves the way it came, Tab cycles
     within, and a press anywhere else closes it. */
  useEffect(() => {
    if (!open) return;
    const items = () =>
      [...(wrap.current?.querySelectorAll<HTMLButtonElement>(".dp-menu-pop button") ?? [])];
    items()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        shut(true);
        return;
      }
      if (event.key !== "Tab") return;
      const list = items();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onDown = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const who = row.send.lead?.name ?? "this demo";
  return (
    <div className="dp-menu" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="dp-btn is-quiet dp-menu-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${who}`}
        disabled={busy}
        title={busy ? "Working on this demo now" : undefined}
        onClick={() => setOpen((was) => !was)}
      >
        {busy ? "\u2026" : "\u22ef"}
      </button>
      {open && (
        <div className="dp-menu-pop" role="menu" aria-label={`Actions for ${who}`}>
          <button
            type="button"
            role="menuitem"
            disabled={isFirst}
            title={isFirst ? "This one already sends first" : undefined}
            onClick={() => {
              shut(false);
              onMoveToTop();
            }}
          >
            Move to top
          </button>
          {/* Stays open through the first press: an armed control the reader
              cannot see is not a confirmation. */}
          <button
            type="button"
            role="menuitem"
            className={armedUnstage ? "is-armed" : ""}
            onClick={onUnstage}
          >
            {armedUnstage ? "Unstage? Confirm" : "Unstage"}
          </button>
        </div>
      )}
    </div>
  );
}

/* The channel, as a mark rather than a word: the column repeats itself down
   forty days, and "Email" written out nine hundred times is not information.
   The label rides on aria-label, so a reader still hears it. */
function ChannelGlyph({ channel }: { channel: string }) {
  const email = channel === "Email";
  return (
    <span className="dp-glyph" role="img" aria-label={channel}>
      {email ? (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <rect x="1.5" y="3.5" width="13" height="9" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
          <path d="M2.5 5 8 8.8 13.5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <rect x="1.2" y="1.2" width="13.6" height="13.6" rx="2.6" fill="currentColor" opacity=".14" />
          <path
            d="M4.6 6.4v5m0-7.1v.02M7.4 11.4v-5m0 1.6c.5-1 1.4-1.6 2.4-1.6 1.2 0 1.9.8 1.9 2.2v2.8"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
            fill="none"
          />
        </svg>
      )}
    </span>
  );
}

/* ---------- Sent ---------- */

function SentDayRows({
  label,
  rows,
  replied,
}: {
  label: string;
  rows: SendRow[];
  replied: ReadonlySet<string>;
}) {
  return (
    <>
      <tr>
        <th className="dp-dayhead" colSpan={5} scope="rowgroup">
          {label}
        </th>
      </tr>
      {rows.map((send) => {
        const href = threadHref(send);
        const answered = Boolean(send.lead && replied.has(send.lead.lead_id));
        return (
          <tr key={send.id}>
            <td>{send.lead?.name ?? "Not named yet"}</td>
            <td className="dp-muted">{send.lead?.company ?? ""}</td>
            <td className="dp-muted">{send.kind === "email" ? "Email" : "LinkedIn"}</td>
            <td>{answered && <span className="dp-badge">Replied</span>}</td>
            <td>{href && <a href={withMockMode(href)}>See the thread</a>}</td>
          </tr>
        );
      })}
    </>
  );
}

/* ---------- loading, error ---------- */

function CardSkeletons() {
  return (
    <div className="dp-cards" role="status" aria-label="Loading demos">
      {[0, 1].map((index) => (
        <div key={index} className="dp-skel-card dp-skel-pulse">
          <div className="dp-skel dp-skel-title" />
          <div className="dp-skel dp-skel-sub" />
          <div className="dp-skel dp-skel-email" />
          <div className="dp-skel dp-skel-video" />
          <div className="dp-skel dp-skel-pill" />
        </div>
      ))}
    </div>
  );
}

function RowSkeletons() {
  return (
    <div className="dp-tablewrap dp-rows dp-skel-pulse" role="status" aria-label="Loading rows">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="dp-skel-row">
          <div className="dp-skel dp-skel-cell is-wide" />
          <div className="dp-skel dp-skel-cell" />
          <div className="dp-skel dp-skel-cell is-narrow" />
          <div className="dp-skel dp-skel-cell" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const [tried, setTried] = useState(false);
  return (
    <div className="dp-empty">
      <p role="alert">{message}</p>
      <button
        type="button"
        className="dp-btn"
        disabled={tried}
        title={tried ? "Loading it again now" : undefined}
        onClick={() => {
          setTried(true);
          onRetry();
        }}
      >
        {tried ? "Loading" : "Try again"}
      </button>
    </div>
  );
}

/* "3h" / "2d" — how long this demo has been waiting, which is also how close
   it is to expiring. */
function ageLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}
