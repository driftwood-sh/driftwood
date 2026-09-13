import assert from "node:assert/strict";
import test from "node:test";
import {
  ACCOUNT_UNKNOWN,
  approvableDemos,
  approvalState,
  approveKeyOf,
  approvedLabel,
  approvedNotScheduled,
  awaitsPeople,
  channelLabel,
  decisionsFor,
  demoHeading,
  isApprovable,
  nobodyFoundLine,
  readApprovalStatus,
  groupSentByDay,
  groupStagedDemos,
  isHeld,
  parseDateOnly,
  plannedTime,
  queueHeadline,
  queueSends,
  readyForYou,
  runsThrough,
  NO_LIMITS,
  dayLabel,
  dayChannelTitle,
  emailCollapsed,
  dayRemaining,
  daySentence,
  groupQueueByDay,
  laterSummary,
  splitQueueDays,
  stagedWithLibrary,
  timestampLabel,
  videoSeconds,
  sendingAccount,
  threadHref,
  type ApprovalStatus,
  type LeadContext,
  type LibraryDemo,
  type ReviewItem,
  type SendRow,
} from "./staging-model.ts";

const lead = (id: string, name: string, company: string): LeadContext => ({
  lead_id: id,
  name,
  title: "Head of Growth",
  company,
  linkedin_url: null,
  stage: "new",
  prior_sends: 0,
  last_sent_at: null,
});

const item = (over: Partial<ReviewItem>): ReviewItem => ({
  id: "i1",
  kind: "send_email",
  title: "Meridian",
  body: "Hey Dana",
  subject: "A working demo",
  lead: lead("l1", "Dana Whitfield", "Meridian"),
  attachment_slug: null,
  evidence: null,
  status: "pending",
  created_at: "2026-09-10T10:00:00Z",
  can_decide: true,
  approval_policy_version: 3,
  ...over,
});

const send = (over: Partial<SendRow>): SendRow => ({
  id: "s1",
  kind: "email",
  note: "Hey Dana",
  subject: "A working demo",
  attachment_slug: null,
  lead: lead("l1", "Dana Whitfield", "Meridian"),
  status: "pending",
  error: null,
  due_at: "2026-09-16T16:00:00Z",
  projected_date: "2026-09-16",
  created_at: "2026-09-14T10:00:00Z",
  sent_at: null,
  ...over,
});

test("one card per lead: the bug item brings the video, the email brings the copy", () => {
  const demos = groupStagedDemos([
    item({
      id: "bug-1",
      kind: "bug_validation",
      body: "Same-day booking drops the reservation.",
      subject: null,
      attachment_slug: "meridian-booking",
      evidence: { device: "Pixel 9", video_timestamp: "0:12" },
      created_at: "2026-09-10T09:00:00Z",
    }),
    item({ id: "email-1", created_at: "2026-09-10T10:00:00Z" }),
  ]);
  assert.equal(demos.length, 1);
  assert.deepEqual(demos[0].itemIds, ["bug-1", "email-1"]);
  assert.equal(demos[0].videoSlug, "meridian-booking");
  assert.equal(demos[0].subject, "A working demo");
  assert.equal(demos[0].claim, "Same-day booking drops the reservation.");
  assert.equal(demos[0].heading, "Dana Whitfield, Meridian");
  assert.equal(demos[0].createdAt, "2026-09-10T09:00:00Z");
  assert.equal(demos[0].pinId, "bug-1");
  assert.equal(demos[0].canDecide, true);
  assert.equal(demos[0].policyVersion, 3);
});

test("connection requests and messages never reach the page", () => {
  const demos = groupStagedDemos([
    item({ id: "c1", kind: "send_connection" }),
    item({ id: "m1", kind: "send_message" }),
  ]);
  assert.deepEqual(demos, []);
});

test("decided items are gone; items with no lead stand alone", () => {
  const demos = groupStagedDemos([
    item({ id: "done", status: "approved" }),
    item({ id: "a", kind: "bug_validation", lead: null, created_at: "2026-09-11T09:00:00Z" }),
    item({ id: "b", kind: "bug_validation", lead: null, created_at: "2026-09-12T09:00:00Z" }),
  ]);
  assert.deepEqual(
    demos.map((demo) => demo.itemIds),
    [["a"], ["b"]],
  );
});

test("cards run oldest first, because the oldest is the one about to expire", () => {
  const demos = groupStagedDemos([
    item({ id: "new", lead: lead("l2", "Sam Okafor", "Ledgerline"), created_at: "2026-09-12T09:00:00Z" }),
    item({ id: "old", created_at: "2026-09-09T09:00:00Z" }),
  ]);
  assert.deepEqual(
    demos.map((demo) => demo.itemIds[0]),
    ["old", "new"],
  );
});

test("the bug item belongs to us: the decision lands on the email item only", () => {
  const demos = groupStagedDemos([
    item({ id: "bug-1", kind: "bug_validation", can_decide: false, approval_policy_version: 3 }),
    item({ id: "email-1", can_decide: true, approval_policy_version: 3 }),
  ]);
  assert.deepEqual(demos[0].itemIds, ["bug-1", "email-1"]);
  assert.deepEqual(demos[0].decidableIds, ["email-1"]);
  assert.equal(demos[0].canDecide, true);
  assert.equal(demos[0].policyVersion, 3);
  assert.deepEqual(decisionsFor(demos[0], "approve"), [
    { item_id: "email-1", decision: "approve" },
  ]);
});

test("a demo still in our own gate never reaches the customer's list", () => {
  const demos = groupStagedDemos([
    item({ id: "bug-only", kind: "bug_validation", can_decide: false }),
    item({
      id: "ready",
      lead: lead("l2", "Sam Okafor", "Ledgerline"),
      can_decide: true,
    }),
  ]);
  assert.equal(demos.length, 2);
  assert.deepEqual(
    readyForYou(demos).map((demo) => demo.itemIds),
    [["ready"]],
  );
});

test("the video slug is salvaged from evidence text when the column is empty", () => {
  const demos = groupStagedDemos([
    item({
      kind: "bug_validation",
      attachment_slug: null,
      body: "Clip: https://driftwood.sh/d/meridian-booking-4f2a",
    }),
  ]);
  assert.equal(demos[0].videoSlug, "meridian-booking-4f2a");
});

test("a heading falls back to the company, then to the item title", () => {
  assert.equal(demoHeading({ ...lead("l1", "", "Meridian"), name: null }, "x"), "Meridian");
  assert.equal(demoHeading(null, "Meridian bug"), "Meridian bug");
});

test("one decide call carries every item of the demo, with the reason when there is one", () => {
  const demo = groupStagedDemos([
    item({ id: "bug-1", kind: "bug_validation" }),
    item({ id: "email-1" }),
  ])[0];
  assert.deepEqual(decisionsFor(demo, "approve"), [
    { item_id: "bug-1", decision: "approve" },
    { item_id: "email-1", decision: "approve" },
  ]);
  assert.deepEqual(decisionsFor(demo, "deny", "Shorter"), [
    { item_id: "bug-1", decision: "deny", reason: "Shorter" },
    { item_id: "email-1", decision: "deny", reason: "Shorter" },
  ]);
  assert.deepEqual(demo.decidableIds, demo.itemIds);
});

test("the queue holds email and message rows that are still going out", () => {
  const rows = queueSends([
    send({ id: "a" }),
    send({ id: "b", kind: "message" }),
    send({ id: "c", kind: "connection_request" }),
    send({ id: "d", status: "failed" }),
    send({ id: "e", status: "sending" }),
    send({ id: "f", status: "held" }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.id),
    ["a", "b", "e", "f"],
  );
});

test("channels read as the customer's own accounts", () => {
  assert.equal(channelLabel("email"), "Email");
  assert.equal(channelLabel("message"), "LinkedIn");
  assert.equal(channelLabel("x_dm"), "X");
});

test("a date-only string parses at local midnight, not UTC", () => {
  const date = parseDateOnly("2026-09-16");
  assert.equal(date?.getFullYear(), 2026);
  assert.equal(date?.getMonth(), 8);
  assert.equal(date?.getDate(), 16);
  assert.equal(parseDateOnly("nonsense"), null);
});

test("planned time takes the projected day, and the time only when the due stamp agrees", () => {
  const day = new Date(2026, 8, 16, 9, 0, 0);
  const onDay = plannedTime(
    send({ due_at: day.toISOString(), projected_date: "2026-09-16" }),
    false,
  );
  assert.match(onDay, /Sep 16/);
  assert.match(onDay, /9:00/);
  const deferred = plannedTime(
    send({ due_at: day.toISOString(), projected_date: "2026-09-18" }),
    false,
  );
  assert.match(deferred, /Sep 18/);
  assert.doesNotMatch(deferred, /9:00/);
  assert.equal(plannedTime(send({}), true), "Paused");
});

test("the newer projected_send_date field wins over projected_date", () => {
  const planned = plannedTime(
    send({ projected_date: "2026-09-16", projected_send_date: "2026-09-21" }),
    false,
  );
  assert.match(planned, /Sep 21/);
});

test("held reads from the row, from a held status, or from a local hold", () => {
  assert.equal(isHeld(send({}), new Set()), false);
  assert.equal(isHeld(send({ held: true }), new Set()), true);
  assert.equal(isHeld(send({ status: "held" }), new Set()), true);
  assert.equal(isHeld(send({ id: "s9" }), new Set(["s9"])), true);
});

test("one connected account is named; a pool stays honest", () => {
  const one = { email: ["dana@meridian.com"], linkedin: [] as string[] };
  assert.equal(sendingAccount(send({}), one), "dana@meridian.com");
  assert.equal(
    sendingAccount(send({}), { email: ["a@x.com", "b@x.com"], linkedin: [] }),
    ACCOUNT_UNKNOWN,
  );
  assert.equal(
    sendingAccount(send({ sending_account: "sam@meridian.com" }), one),
    "sam@meridian.com",
  );
});

test("runs-through takes the last day across the kinds this page shows", () => {
  assert.equal(
    runsThrough([
      { kind: "email", queued: 2, sent_24h: 1, cap: 20, runs_through: "2026-09-16" },
      { kind: "message", queued: 4, sent_24h: 2, cap: 25, runs_through: "2026-09-17" },
      { kind: "connection_request", queued: 9, sent_24h: 3, cap: 20, runs_through: "2026-09-30" },
    ]),
    "2026-09-17",
  );
  assert.equal(runsThrough([]), null);
});

test("the queue headline is the date and nothing else", () => {
  assert.match(queueHeadline("2026-09-17"), /^Runs through .*Sep 17\.$/);
  assert.equal(queueHeadline(null), "");
});

test("sent rows group by the day they went out, newest first", () => {
  const days = groupSentByDay([
    send({ id: "a", status: "sent", sent_at: new Date(2026, 8, 9, 11, 0).toISOString() }),
    send({ id: "b", status: "sent", sent_at: new Date(2026, 8, 11, 9, 0).toISOString() }),
    send({ id: "c", status: "sent", sent_at: new Date(2026, 8, 11, 17, 0).toISOString() }),
    send({ id: "d", status: "sent", sent_at: null }),
    send({ id: "e", kind: "connection_request", status: "sent", sent_at: new Date(2026, 8, 12, 9, 0).toISOString() }),
  ]);
  assert.deepEqual(
    days.map((day) => [day.day, day.rows.map((row) => row.id)]),
    [
      ["2026-09-11", ["c", "b"]],
      ["2026-09-09", ["a"]],
    ],
  );
  assert.match(days[0].label, /Sep 11/);
});

test("the thread link carries the lead, and is absent without one", () => {
  assert.equal(threadHref(send({})), "/dashboard/inbox?lead=l1");
  assert.equal(threadHref(send({ lead: null })), null);
});

/* ---------- the queue, by day ---------- */

const TODAY = new Date(2026, 8, 12);

const qrow = (id: string, kind: string, day: string) => ({
  send: send({ id, kind, projected_date: day }),
  channel: channelLabel(kind),
  planned: day,
  held: false,
  account: "dana@meridian.com",
});

test("days are named Today, Tomorrow, then weekday and date", () => {
  assert.equal(dayLabel("2026-09-12", TODAY), "Today");
  assert.equal(dayLabel("2026-09-13", TODAY), "Tomorrow");
  assert.match(dayLabel("2026-09-17", TODAY), /Sep 17/);
});

test("a toast names a day the way a sentence would", () => {
  assert.equal(daySentence("2026-09-12", TODAY), "today");
  assert.equal(daySentence("2026-09-13", TODAY), "tomorrow");
  assert.equal(daySentence("2026-09-15", TODAY), "Tuesday");
  assert.match(daySentence("2026-10-01", TODAY), /Oct 1/);
});

test("rows group into days, in order, with per-channel load against the limits", () => {
  const days = groupQueueByDay(
    [
      qrow("a", "email", "2026-09-13"),
      qrow("b", "email", "2026-09-12"),
      qrow("c", "message", "2026-09-12"),
      qrow("d", "email", "2026-09-12"),
    ],
    { email: 2, message: 5 },
    TODAY,
  );
  assert.deepEqual(days.map((day) => day.label), ["Today", "Tomorrow"]);
  assert.deepEqual(days[0].rows.map((row) => row.send.id), ["b", "c", "d"]);
  assert.equal(dayChannelTitle(days[0]), "2 of 2 emails · 1 of 5 LinkedIn");
  assert.equal(dayRemaining(days[0]), 4);
  // Email is at its limit but LinkedIn is not, so the day still takes work.
  assert.equal(days[0].full, false);
});

test("a day whose every channel is at its limit reads as full", () => {
  const days = groupQueueByDay(
    [qrow("a", "email", "2026-09-12"), qrow("b", "email", "2026-09-12")],
    { email: 2, message: 5 },
    TODAY,
  );
  assert.equal(days[0].full, true);
});

test("with no limits exposed, a day shows its counts and is never full", () => {
  const days = groupQueueByDay([qrow("a", "email", "2026-09-12")], NO_LIMITS, TODAY);
  assert.equal(dayChannelTitle(days[0]), "1 email");
  assert.equal(dayRemaining(days[0]), null);
  assert.equal(days[0].full, false);
});

test("a row with no projected date falls back to the day its due stamp lands on", () => {
  const due = new Date(2026, 8, 14, 10, 0).toISOString();
  const days = groupQueueByDay(
    [{ send: send({ id: "x", projected_date: null, due_at: due }), channel: "Email", planned: "", held: false, account: "" }],
    NO_LIMITS,
    TODAY,
  );
  assert.equal(days[0].day, "2026-09-14");
});

test("the first seven days stand open and the rest collapse into one line", () => {
  const days = groupQueueByDay(
    Array.from({ length: 10 }, (_, i) => qrow(`r${i}`, "email", `2026-09-${String(12 + i).padStart(2, "0")}`)),
    NO_LIMITS,
    TODAY,
  );
  const { shown, later } = splitQueueDays(days, 7);
  assert.equal(shown.length, 7);
  assert.equal(later.length, 3);
  assert.match(laterSummary(later), /^Later, 3 demos through .*Sep 21$/);
  assert.equal(laterSummary([]), "Later, 0 demos");
});

test("a video timestamp is read out of the agent's free text", () => {
  assert.equal(videoSeconds("bug visible at 0:19"), 19);
  assert.equal(videoSeconds("1:07"), 67);
  assert.equal(videoSeconds("no timestamp here"), null);
  assert.equal(videoSeconds(null), null);
  assert.equal(timestampLabel(67), "1:07");
});

test("a collapsed email keeps the greeting and the line that differs per demo", () => {
  const body = [
    "Hey Priya,",
    "",
    "Picking Growth on your pricing page and pressing back opens checkout on Starter.",
    "",
    "Worth a look?",
    "",
    "Best,\nAayush",
  ].join("\n");
  assert.deepEqual(emailCollapsed(body), {
    first: "Hey Priya,",
    personal: "Picking Growth on your pricing page and pressing back opens checkout on Starter.",
  });
});

test("an inline image is media, not a line to quote, and a bare body still collapses", () => {
  const body = "Hey Yuvan,\n\n[![Shot](https://driftwood.sh/a.webp)](https://driftwood.sh/b)\n\nI pulled the two workflow changes into one short walkthrough for you.";
  assert.equal(emailCollapsed(body).first, "Hey Yuvan,");
  assert.match(emailCollapsed(body).personal ?? "", /^I pulled the two workflow/);
  assert.deepEqual(emailCollapsed(null), { first: null, personal: null });
  assert.deepEqual(emailCollapsed("Hi."), { first: "Hi.", personal: null });
});

/* ---------- Staging's second source: the demo library ---------- */

const libraryRow = (over: Partial<LibraryDemo>): LibraryDemo => ({
  demo_id: "d1",
  lead_id: null,
  lead_name: null,
  company_name: "Airbnb",
  description: "The checkout step that drops a booking.",
  artifact_id: "a1",
  name: "photon-demo-airbnb",
  content_type: "video/mp4",
  content_url: "/d/photon-demo-airbnb",
  created_at: "2026-09-12T09:00:00Z",
  updated_at: "2026-09-12T09:00:00Z",
  ...over,
});

test("a demo with no email yet is staged, with its clip, its idea and no decision", () => {
  const demos = stagedWithLibrary([], [libraryRow({})], []);
  assert.equal(demos.length, 1);
  assert.equal(demos[0].key, "library:d1");
  assert.equal(demos[0].heading, "Airbnb");
  assert.equal(demos[0].videoUrl, "/d/photon-demo-airbnb");
  assert.equal(demos[0].note, "The checkout step that drops a booking.");
  assert.equal(demos[0].body, null);
  assert.equal(demos[0].canDecide, false);
  assert.deepEqual(demos[0].decidableIds, []);
  assert.equal(demos[0].createdAt, "2026-09-12T09:00:00Z");
});

test("the contact leads the heading when the library row names one", () => {
  const demos = stagedWithLibrary(
    [],
    [libraryRow({ lead_name: "Priya Patel", company_name: "Northstar" })],
    [],
  );
  assert.equal(demos[0].heading, "Priya Patel, Northstar");
});

test("a demo both sources hold is one card, and the review item keeps it", () => {
  const staged = groupStagedDemos([item({ id: "email-1" })]);
  const demos = stagedWithLibrary(
    staged,
    [libraryRow({ demo_id: "same-lead", lead_id: "l1", lead_name: "Dana Whitfield", company_name: "Meridian" })],
    [],
  );
  assert.deepEqual(
    demos.map((demo) => demo.key),
    ["lead:l1"],
  );
  assert.equal(demos[0].body, "Hey Dana");
});

test("the demo's own slug recognises the pair when the library row names no lead", () => {
  const staged = groupStagedDemos([
    item({ id: "bug-1", kind: "bug_validation", attachment_slug: "photon-demo-airbnb" }),
  ]);
  const demos = stagedWithLibrary(staged, [libraryRow({})], []);
  assert.equal(demos.length, 1);
  assert.equal(demos[0].videoSlug, "photon-demo-airbnb");
});

test("a demo already queued is not staged again", () => {
  const demos = stagedWithLibrary(
    [],
    [libraryRow({ lead_id: "l1" }), libraryRow({ demo_id: "d2", name: "photon-demo-omio" })],
    [send({ lead: lead("l1", "Dana Whitfield", "Meridian") })],
  );
  assert.deepEqual(
    demos.map((demo) => demo.key),
    ["library:d2"],
  );
});

test("both sources run newest first, because today's work is what a customer opens for", () => {
  const staged = groupStagedDemos([
    item({ id: "old-email", created_at: "2026-09-08T09:00:00Z" }),
  ]);
  const demos = stagedWithLibrary(
    staged,
    [
      libraryRow({ demo_id: "newest", created_at: "2026-09-12T09:00:00Z" }),
      libraryRow({ demo_id: "middle", created_at: "2026-09-10T09:00:00Z" }),
    ],
    [],
  );
  assert.deepEqual(
    demos.map((demo) => demo.key),
    ["library:newest", "library:middle", "lead:l1"],
  );
});

/* ---------- approve, before anyone has been found ---------- */

test("a demo with no approval field at all still offers Approve", () => {
  /* The field is being added to the list response, so a client that ships
     first reads nothing. Nothing must never read as "already approved". */
  const row = libraryRow({});
  assert.equal("approval" in row, false);
  assert.equal(approvalState(row), "none");
  assert.equal(awaitsPeople(row), false);
  const demos = stagedWithLibrary([], [row], []);
  assert.equal(demos.length, 1);
  assert.equal(isApprovable(demos[0]), true);
});

test("an explicit null approval reads the same as an absent one", () => {
  assert.equal(approvalState(libraryRow({ approval: null })), "none");
  assert.equal(approvalState(null), "none");
});

test("the five statuses read as four states, because two pairs are one state", () => {
  const state = (status: ApprovalStatus) =>
    approvalState(libraryRow({ approval: { status, approved_at: "2026-09-12T09:00:00Z", note: null } }));
  assert.equal(state("queued"), "waiting");
  assert.equal(state("handed_to_agent"), "waiting");
  assert.equal(state("no_contacts_found"), "nobody");
  assert.equal(state("blocked"), "nobody");
  assert.equal(state("contacts_found"), "filed");
});

test("a status this build has never heard of still means approved", () => {
  assert.equal(readApprovalStatus("something_new"), "queued");
  assert.equal(readApprovalStatus(undefined), "queued");
  assert.equal(readApprovalStatus("handed_to_agent"), "handed_to_agent");
});

test("an approved demo leaves Staging, and one whose sends are filed does not", () => {
  const approved = (status: ApprovalStatus, id: string) =>
    libraryRow({
      demo_id: id,
      name: `photon-demo-${id}`,
      approval: { status, approved_at: "2026-09-12T09:00:00Z", note: null },
    });
  const demos = stagedWithLibrary(
    [],
    [
      libraryRow({ demo_id: "fresh", name: "photon-demo-fresh" }),
      approved("queued", "waiting"),
      approved("handed_to_agent", "handed"),
      approved("no_contacts_found", "nobody"),
      approved("blocked", "blocked"),
      approved("contacts_found", "filed"),
    ],
    [],
  );
  assert.deepEqual(
    demos.map((demo) => demo.key).sort(),
    ["library:filed", "library:fresh"],
  );
});

test("Approve all covers the demos with no email, and never one already approved", () => {
  const demos = stagedWithLibrary(
    groupStagedDemos([item({ id: "email-1" })]),
    [
      libraryRow({ demo_id: "a", name: "photon-demo-a" }),
      libraryRow({ demo_id: "b", name: "photon-demo-b" }),
      libraryRow({
        demo_id: "done",
        name: "photon-demo-done",
        approval: { status: "contacts_found", approved_at: "2026-09-12T09:00:00Z", note: null },
      }),
    ],
    [],
  );
  assert.deepEqual(
    approvableDemos(demos).map((demo) => approveKeyOf(demo)),
    ["a", "b"],
  );
  /* The card with an email is a decision, not an approve: the two lists never
     overlap, so a press over the whole segment counts each demo once. */
  assert.equal(
    demos.filter((demo) => demo.canDecide).every((demo) => !isApprovable(demo)),
    true,
  );
  assert.equal(approveKeyOf(demos.find((demo) => demo.canDecide)!), null);
});

test("the demo key an approve names survives a colon in the id", () => {
  const demos = stagedWithLibrary([], [libraryRow({ demo_id: "html:a1b2c3" })], []);
  assert.equal(approveKeyOf(demos[0]), "html:a1b2c3");
  assert.equal(encodeURIComponent(approveKeyOf(demos[0])!), "html%3Aa1b2c3");
});

/* ---------- approved, and nobody to send it to yet ---------- */

test("the group holds the approved demos with no people, newest approval first", () => {
  const rows = approvedNotScheduled([
    libraryRow({ demo_id: "fresh", name: "photon-demo-fresh" }),
    libraryRow({
      demo_id: "older",
      company_name: "Ledgerline",
      approval: { status: "handed_to_agent", approved_at: "2026-09-10T09:00:00Z", note: null },
    }),
    libraryRow({
      demo_id: "newer",
      company_name: "Meridian",
      approval: { status: "queued", approved_at: "2026-09-12T09:00:00Z", note: null },
    }),
    libraryRow({
      demo_id: "filed",
      company_name: "Northstar",
      approval: { status: "contacts_found", approved_at: "2026-09-13T09:00:00Z", note: null },
    }),
  ]);
  assert.deepEqual(
    rows.map((row) => [row.demoKey, row.company, row.approvedAt]),
    [
      ["newer", "Meridian", "2026-09-12T09:00:00Z"],
      ["older", "Ledgerline", "2026-09-10T09:00:00Z"],
    ],
  );
  /* Still people to come, so no row carries the line. */
  assert.deepEqual(rows.map((row) => row.nobodyLine), [null, null]);
});

test("a demo nobody was found for carries one line, and the note writes it", () => {
  const rows = approvedNotScheduled([
    libraryRow({
      demo_id: "bloom",
      company_name: "Bloom",
      approval: { status: "no_contacts_found", approved_at: "2026-09-12T09:00:00Z", note: null },
    }),
    libraryRow({
      demo_id: "kestrel",
      company_name: "Kestrel",
      approval: { status: "blocked", approved_at: "2026-09-11T09:00:00Z", note: "Kestrel is on your blocklist." },
    }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.nobodyLine),
    ["No one found at Bloom.", "Kestrel is on your blocklist."],
  );
});

test("a note of blank space is not a line, so the company one stands", () => {
  assert.equal(
    nobodyFoundLine(
      libraryRow({
        company_name: "Bloom",
        approval: { status: "no_contacts_found", approved_at: "2026-09-12T09:00:00Z", note: "   " },
      }),
    ),
    "No one found at Bloom.",
  );
});

test("a row with no approved_at falls back to the day the demo was made", () => {
  const rows = approvedNotScheduled([
    libraryRow({ created_at: "2026-09-01T09:00:00Z", approval: { status: "queued", approved_at: "", note: null } }),
  ]);
  assert.equal(rows[0].approvedAt, "2026-09-01T09:00:00Z");
});

test("when they approved it: today, yesterday, then the date", () => {
  const today = new Date(2026, 8, 13, 14, 0, 0);
  const at = (y: number, m: number, d: number) => new Date(y, m, d, 9, 0, 0).toISOString();
  assert.equal(approvedLabel(at(2026, 8, 13), today), "Today");
  assert.equal(approvedLabel(at(2026, 8, 12), today), "Yesterday");
  assert.equal(approvedLabel(at(2026, 8, 4), today), "Sep 4");
  assert.equal(approvedLabel("not a date", today), "");
});
