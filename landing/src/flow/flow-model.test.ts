import assert from "node:assert/strict";
import test from "node:test";

import type { SendRow } from "../demos/staging-model.ts";
import {
  dayKey,
  dayName,
  groupByDay,
  isPaused,
  nextDay,
  removedMessage,
  sendDemoSlug,
  sendTime,
} from "./flow-model.ts";

function send(id: string, dueAt: string, patch: Partial<SendRow> = {}): SendRow {
  return {
    id,
    kind: "email",
    note: "Hi",
    subject: "Hello",
    attachment_slug: null,
    lead: null,
    status: "pending",
    error: null,
    due_at: dueAt,
    projected_date: null,
    created_at: dueAt,
    sent_at: null,
    ...patch,
  };
}

const TZ = "America/Los_Angeles";
// Thu Sep 24 2026, 10:00 in Los Angeles.
const NOW = new Date("2026-09-24T17:00:00Z");

test("a send's day is its due stamp read in the workspace zone", () => {
  // 02:30 UTC on the 25th is still the evening of the 24th in Los Angeles.
  assert.equal(dayKey(new Date("2026-09-25T02:30:00Z"), TZ), "2026-09-24");
  assert.equal(dayKey(new Date("2026-09-25T02:30:00Z"), "UTC"), "2026-09-25");
  assert.equal(dayKey(new Date("2026-09-25T02:30:00Z"), "Not/AZone").length, 10);
});

test("days read Today, Tomorrow, then a short date", () => {
  assert.equal(dayName("2026-09-24", "2026-09-24"), "Today");
  assert.equal(dayName("2026-09-25", "2026-09-24"), "Tomorrow");
  assert.equal(dayName("2026-09-28", "2026-09-24"), "Mon, Sep 28");
  assert.equal(dayName("2026-10-01", "2026-09-30"), "Tomorrow");
});

test("upcoming sends group by day in due order and leave failed rows out", () => {
  const days = groupByDay(
    [
      send("b", "2026-09-25T17:30:00Z"),
      send("a", "2026-09-25T16:05:00Z"),
      send("today", "2026-09-24T20:00:00Z"),
      send("failed", "2026-09-25T16:00:00Z", { status: "failed" }),
      send("sent", "2026-09-25T16:00:00Z", { status: "sent" }),
      send("monday", "2026-09-28T16:00:00Z"),
      send("undated", "not a date"),
    ],
    TZ,
    NOW,
  );
  assert.deepEqual(
    days.map((day) => [day.label, day.sends.map((row) => row.id)]),
    [
      ["Today", ["today"]],
      ["Tomorrow", ["a", "b"]],
      ["Mon, Sep 28", ["monday"]],
    ],
  );
});

test("the page opens on the next day with sends, and today only as a last resort", () => {
  const withTomorrow = groupByDay([send("t", "2026-09-24T20:00:00Z"), send("n", "2026-09-28T16:00:00Z")], TZ, NOW);
  assert.equal(nextDay(withTomorrow, TZ, NOW)?.label, "Mon, Sep 28");
  const todayOnly = groupByDay([send("t", "2026-09-24T20:00:00Z")], TZ, NOW);
  assert.equal(nextDay(todayOnly, TZ, NOW)?.label, "Today");
  assert.equal(nextDay([], TZ, NOW), null);
});

test("send time is the clock in the workspace zone", () => {
  assert.equal(sendTime(send("a", "2026-09-25T16:05:00Z"), TZ), "9:05 AM");
  assert.equal(sendTime(send("a", "garbage"), TZ), "");
});

test("the demo a send carries comes from its slug or the GIF's link", () => {
  assert.equal(sendDemoSlug({ attachment_slug: "meridian-booking", note: "" }), "meridian-booking");
  assert.equal(
    sendDemoSlug({
      attachment_slug: null,
      note: "Hey Dana,\n\n[![Meridian demo](https://driftwood.sh/d/meridian-v2-gif)](https://driftwood.sh/d/meridian-v2)\n\nBest",
    }),
    "meridian-v2",
  );
  assert.equal(sendDemoSlug({ attachment_slug: null, note: "No demo here." }), null);
});

test("a paused row is recognised by any of the backend's markers", () => {
  assert.equal(isPaused(send("a", "2026-09-25T16:05:00Z")), false);
  assert.equal(isPaused({ ...send("a", "2026-09-25T16:05:00Z"), held_at: "2026-09-24T00:00:00Z" }), true);
  assert.equal(isPaused(send("a", "2026-09-25T16:05:00Z", { held: true })), true);
});

test("the remove message says what happened, including rows that were skipped", () => {
  assert.equal(removedMessage(1, 0, "Tomorrow"), "1 person removed from tomorrow.");
  assert.equal(removedMessage(3, 1, "Mon, Sep 28"), "3 people removed from Mon, Sep 28. 1 had already gone out or changed.");
  assert.equal(removedMessage(0, 2, "Today"), "Nothing was removed. 2 had already gone out or changed.");
});
