/* Pure logic behind /dashboard/flow: the workspace's one daily flow, from
   the audience to the send queue. Nothing here touches the DOM or the
   network, so node --test pins the grouping and the copy (the
   overview/staging-model convention). */

import type { SendRow } from "../demos/staging-model.ts";
import { parseEmailBody } from "../email-preview.ts";

/* A send still waiting to go out. Failed rows sit in the open view too, but
   they are not going anywhere tomorrow, so they are not the flow's queue. */
export function isUpcoming(send: SendRow): boolean {
  return send.status === "pending" || send.status === "sending" || send.status === "held";
}

export function isPaused(send: SendRow & { held_at?: string | null }): boolean {
  return send.held === true || send.status === "held" || Boolean(send.held_at);
}

/* "YYYY-MM-DD" for an instant in the workspace's own time zone. The day a
   send goes out is its due stamp read in that zone: projected_date is
   deliberately pessimistic and names the day after for a window that is
   still open, so it is not the day to group by. */
export function dayKey(at: Date, tz: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz ?? undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(at);
    const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    /* An unknown zone name reads in the browser's own zone. */
    return dayKey(at, null);
  }
}

function addDays(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

/* "Today", "Tomorrow", then "Mon Sep 28". */
export function dayName(key: string, todayKey: string): string {
  if (key === todayKey) return "Today";
  if (key === addDays(todayKey, 1)) return "Tomorrow";
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export type FlowDay = { key: string; label: string; sends: SendRow[] };

/* Upcoming sends by the day they go out, soonest first, in due order inside
   each day. Rows with no readable due stamp have no day and are left out. */
export function groupByDay(sends: SendRow[], tz: string | null, now: Date = new Date()): FlowDay[] {
  const todayKey = dayKey(now, tz);
  const days = new Map<string, SendRow[]>();
  for (const send of sends) {
    if (!isUpcoming(send)) continue;
    const due = new Date(send.due_at);
    if (Number.isNaN(due.getTime())) continue;
    const key = dayKey(due, tz);
    const list = days.get(key);
    if (list) list.push(send);
    else days.set(key, [send]);
  }
  return [...days.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, rows]) => ({
      key,
      label: dayName(key, todayKey),
      sends: [...rows].sort((a, b) => a.due_at.localeCompare(b.due_at)),
    }));
}

/* The day the page opens on: the next day that has sends, which is what
   "what happens tomorrow" means on a Friday with nothing going out at the
   weekend. Today only when nothing is queued past it. */
export function nextDay(days: FlowDay[], tz: string | null, now: Date = new Date()): FlowDay | null {
  const todayKey = dayKey(now, tz);
  return days.find((day) => day.key > todayKey) ?? days[0] ?? null;
}

/* "9:22 AM" in the workspace's zone. */
export function sendTime(send: SendRow, tz: string | null): string {
  const due = new Date(send.due_at);
  if (Number.isNaN(due.getTime())) return "";
  try {
    return due.toLocaleTimeString("en-US", { timeZone: tz ?? undefined, hour: "numeric", minute: "2-digit" });
  } catch {
    return due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
}

/* The demo a send carries: an attached slug, or the video the email's GIF
   links to (demo emails link the MP4 rather than attach it). */
export function sendDemoSlug(send: Pick<SendRow, "attachment_slug" | "note">): string | null {
  if (send.attachment_slug) return send.attachment_slug;
  for (const paragraph of parseEmailBody(send.note ?? "")) {
    for (const line of paragraph.lines) {
      if (line.kind !== "image") continue;
      const video = /^https:\/\/driftwood\.sh\/d\/([a-z0-9][a-z0-9_-]*)(?:[?#].*)?$/i.exec(line.linkUrl);
      if (video) return video[1];
    }
  }
  return null;
}

export function channelName(kind: string): string {
  if (kind === "email") return "Email";
  if (kind === "x_dm" || kind === "x_follow") return "X";
  if (kind === "connection_request") return "LinkedIn invite";
  return "LinkedIn";
}

/* "1 person" / "40 people". */
export function people(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "person" : "people"}`;
}

/* What the page says after a remove press, from what the server reports.
   Skipped rows already went out or were changed elsewhere; the customer is
   told, not left to count. */
export function removedMessage(removed: number, skipped: number, dayLabel: string): string {
  const where = dayLabel === "Today" || dayLabel === "Tomorrow" ? dayLabel.toLowerCase() : dayLabel;
  const head = removed === 0
    ? "Nothing was removed."
    : `${people(removed)} removed from ${where}.`;
  return skipped > 0
    ? `${head} ${skipped.toLocaleString()} had already gone out or changed.`
    : head;
}
