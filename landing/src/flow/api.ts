/* The fetch layer behind /dashboard/flow. Same-origin relative paths and
   cookie auth, like the other dashboard fetchers. Every read already has a
   home elsewhere (audiences, demos, sends, settings, approvals); the one
   write this page adds is taking people out of the queue. */

import { fetchQueuePage, SEND_CHUNK } from "../demos/staging-api";
import type { SendRow } from "../demos/staging-model";
import { isUpcoming } from "./flow-model";

export type UpcomingSends = {
  sends: SendRow[];
  /* Every row still going out, loaded or not: what "N more after" counts. */
  upcoming: number;
};

type SendsPage = {
  sends: SendRow[];
  total: number;
  counts?: { pending?: number; sending?: number };
};

/* The open queue arrives soonest first, so the first few days are whole once
   a page reaches past them. Pages keep coming until one does, or the queue
   ends; the guard stops a runaway read on a months-deep queue. */
const DAYS_SHOWN = 3;
const PAGE_GUARD = 10;

export async function loadUpcoming(dayOf: (send: SendRow) => string): Promise<UpcomingSends> {
  const sends: SendRow[] = [];
  let counted: number | null = null;
  for (let page = 0; page < PAGE_GUARD; page += 1) {
    const body = (await fetchQueuePage(page * SEND_CHUNK)) as SendsPage;
    const total = body.total;
    if (body.counts && typeof body.counts.pending === "number")
      counted = body.counts.pending + (body.counts.sending ?? 0);
    sends.push(...body.sends);
    const days = new Set(sends.filter(isUpcoming).map(dayOf));
    if (body.sends.length === 0 || sends.length >= total || days.size > DAYS_SHOWN) break;
  }
  return { sends, upcoming: counted ?? sends.filter(isUpcoming).length };
}

export type CancelResult = { canceled: number; skipped: string[] };

/* Takes queued sends out for good: the agent is told the founder removed
   them, so it does not queue the same people again without a new reason.
   A row already going out is reported in `skipped`, never pulled back. */
export async function removeFromQueue(sendIds: string[]): Promise<CancelResult> {
  const response = await fetch("/api/v1/dashboard/sends/cancel", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ send_ids: sendIds }),
  });
  if (!response.ok) {
    let message = "Couldn't remove them. Try again.";
    try {
      const body = (await response.json()) as { error?: { detail?: unknown }; detail?: unknown };
      const detail = body.error?.detail ?? body.detail;
      if (typeof detail === "string" && detail) message = detail;
    } catch {
      /* A proxy can answer HTML; keep the fallback. */
    }
    throw new Error(message);
  }
  const result = (await response.json()) as Partial<CancelResult>;
  return {
    canceled: typeof result.canceled === "number" ? result.canceled : sendIds.length,
    skipped: Array.isArray(result.skipped) ? result.skipped : [],
  };
}
