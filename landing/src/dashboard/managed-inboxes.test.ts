import assert from "node:assert/strict";
import test from "node:test";

import {
  boughtInboxLine,
  domainVariations,
  hasMoreDomains,
  ownMailboxRow,
  type ManagedMailbox,
} from "./managed-inboxes.ts";

// noon UTC, so the short dates read the same in any time zone the tests run in
const NOW = Date.parse("2026-09-24T12:00:00Z");

function box(overrides: Partial<ManagedMailbox>): ManagedMailbox {
  return {
    address: "yuvan@example-mail.com",
    domain: "example-mail.com",
    status: "warming",
    warming_day: 14,
    warming_days_total: 14,
    todays_cap: 0,
    full_cap: 20,
    ready_at: "2026-09-25T12:00:00Z",
    full_cap_at: null,
    sent_today: 0,
    health: "unknown",
    paused_reason: null,
    ...overrides,
  };
}

test("boughtInboxLine: a warming inbox names its day of the warm-up and its ready date", () => {
  assert.deepEqual(boughtInboxLine(box({}), NOW), {
    sub: "Bought inbox · warming up, day 14 of 14 · ready Sep 25",
    chip: null,
  });
  assert.equal(
    boughtInboxLine(box({ warming_day: 3, ready_at: "2026-10-06T12:00:00Z" }), NOW).sub,
    "Bought inbox · warming up, day 3 of 14 · ready Oct 6",
  );
});

test("boughtInboxLine: a warming day past the total holds at the total, a past ready date drops", () => {
  assert.equal(
    boughtInboxLine(box({ warming_day: 15, ready_at: "2026-09-24T11:58:00Z" }), NOW).sub,
    "Bought inbox · warming up, day 14 of 14",
  );
});

test("boughtInboxLine: warming without a day or a ready date says only warming up", () => {
  assert.equal(boughtInboxLine(box({ warming_day: null, ready_at: null }), NOW).sub, "Bought inbox · warming up");
  // a backend that predates ready_at
  assert.equal(
    boughtInboxLine(box({ warming_day: 5, ready_at: undefined }), NOW).sub,
    "Bought inbox · warming up, day 5 of 14",
  );
});

test("boughtInboxLine: a ramping inbox counts against today's cap and names when it reaches full", () => {
  assert.deepEqual(
    boughtInboxLine(
      box({ status: "ready", warming_day: null, ready_at: null, todays_cap: 6, sent_today: 2, full_cap_at: "2026-11-09T12:00:00Z" }),
      NOW,
    ),
    { sub: "Bought inbox · 2 of 6 sent today · rises to 20 a day by Nov 9", chip: null },
  );
});

test("boughtInboxLine: a fully ramped inbox shows only today's count", () => {
  assert.equal(
    boughtInboxLine(
      box({ status: "active", warming_day: null, ready_at: null, todays_cap: 20, sent_today: 14, full_cap_at: "2026-09-01T12:00:00Z" }),
      NOW,
    ).sub,
    "Bought inbox · 14 of 20 sent today",
  );
  // a backend that predates full_cap_at
  assert.equal(
    boughtInboxLine(
      box({ status: "ready", warming_day: null, todays_cap: 6, full_cap: undefined, full_cap_at: undefined }),
      NOW,
    ).sub,
    "Bought inbox · 0 of 6 sent today",
  );
});

test("boughtInboxLine: provisioning and paused inboxes carry their state as a chip", () => {
  assert.deepEqual(boughtInboxLine(box({ status: "provisioning", warming_day: null }), NOW), {
    sub: "Bought inbox",
    chip: "Provisioning",
  });
  assert.deepEqual(boughtInboxLine(box({ status: "paused", warming_day: null }), NOW), {
    sub: "Bought inbox",
    chip: "Paused",
  });
});

test("ownMailboxRow: a connected grant with an address leads with it", () => {
  assert.deepEqual(
    ownMailboxRow({ connected: true, address: "yuvan@autosana.ai" }),
    { label: "yuvan@autosana.ai" },
  );
});

test("ownMailboxRow: a null address falls back to the generic label", () => {
  // the backend can't learn the address from Composio today — the row
  // still renders, never with the login email
  assert.deepEqual(ownMailboxRow({ connected: true, address: null }), {
    label: "Your connected mailbox",
  });
});

test("ownMailboxRow: disconnected or pre-field payloads render no row", () => {
  assert.equal(ownMailboxRow({ connected: false, address: null }), null);
  // own_mailbox absent from the response (older backend): today's overlay
  assert.equal(ownMailboxRow(undefined), null);
  assert.equal(ownMailboxRow(null), null);
});

test("domainVariations: the proven five lead, 17 .com then 12 .co, seed cleaned", () => {
  const names = domainVariations("Acme Corp");
  assert.deepEqual(names.slice(0, 5), [
    "acmecorp-ai.com",
    "acmecorphq.com",
    "useacmecorp.com",
    "joinacmecorp.com",
    "withacmecorp.com",
  ]);
  assert.equal(names.length, 29);
  // .com leads: it is the safest choice for cold email
  assert.ok(names.slice(0, 17).every((name) => name.endsWith(".com")));
  // .co follows as the fallback when every .com name is taken
  assert.ok(names.slice(17).every((name) => name.endsWith(".co")));
  // the bare brand on .co leads the .co block
  assert.equal(names[17], "acmecorp.co");
  assert.equal(new Set(names).size, names.length);
});

test("domainVariations: an empty or symbol-only seed yields nothing", () => {
  assert.deepEqual(domainVariations(""), []);
  assert.deepEqual(domainVariations("  !!"), []);
});

test("hasMoreDomains: picking every visible name never hides the path to more", () => {
  // the founder-hit state: all visible picked, unchecked candidates remain
  assert.equal(
    hasMoreDomains({
      unselectedVerified: 0,
      visibleTarget: 8,
      exhausted: false,
      checkingEmpty: false,
    }),
    true,
  );
});

test("hasMoreDomains: verified extras beyond the slice still offer more", () => {
  assert.equal(
    hasMoreDomains({
      unselectedVerified: 10,
      visibleTarget: 8,
      exhausted: true,
      checkingEmpty: false,
    }),
    true,
  );
});

test("hasMoreDomains: everything verified and showing means no control", () => {
  assert.equal(
    hasMoreDomains({
      unselectedVerified: 5,
      visibleTarget: 8,
      exhausted: true,
      checkingEmpty: false,
    }),
    false,
  );
});

test("hasMoreDomains: the checking hint owns the empty-and-sweeping state", () => {
  assert.equal(
    hasMoreDomains({
      unselectedVerified: 0,
      visibleTarget: 8,
      exhausted: false,
      checkingEmpty: true,
    }),
    false,
  );
});
