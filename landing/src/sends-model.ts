/* Pure logic for the sends surfaces (the review page's Queued + Sent tabs):
   send-kind vocabulary, chip building, and the sent-ledger query string.
   Extracted from Review.tsx so it's testable without the view (the
   overview-model.ts pattern). */

/* ScheduledSend kinds use the stats-strip vocabulary, not the review-item
   one — same human labels either way. */
export function sendKindLabel(kind: string): string {
  if (kind === "message") return "message";
  if (kind === "connection_request") return "connection";
  if (kind === "email") return "email";
  if (kind === "x_dm") return "X DM";
  if (kind === "x_follow") return "X follow";
  return kind;
}

/* Kind order for chips and grouping; unknown kinds trail in queue order. */
export const SEND_KIND_ORDER = ["connection_request", "message", "email"];

export function sendKindRank(kind: string): number {
  const i = SEND_KIND_ORDER.indexOf(kind);
  return i === -1 ? SEND_KIND_ORDER.length : i;
}

export type SendKindChip = { kind: string; count: number };

/* The per-kind census (GET /sends `kind_counts`) as an ordered chip list —
   known kinds first in SEND_KIND_ORDER, unknown kinds after them in name
   order (stable whatever the backend adds); empty kinds are omitted, so a
   chip always has rows behind it. */
export function sendKindChips(
  kindCounts: Record<string, number>,
): SendKindChip[] {
  return Object.entries(kindCounts)
    .filter(([, count]) => count > 0)
    .sort(
      ([a], [b]) => sendKindRank(a) - sendKindRank(b) || a.localeCompare(b),
    )
    .map(([kind, count]) => ({ kind, count }));
}

/* ---------- demo engagement (tracked demo emails) ---------- */

/* What the backend records per send once the email carries the demo GIF:
   an open when a mail client fetches the GIF, a click when the player
   page's script runs, and how far the video played. Every field is
   optional so the ledger renders against a backend that predates them. */
export type SendEngagement = {
  tracked?: boolean;
  opened_at?: string | null;
  open_suspect?: boolean; // the only open looks like a mail-client prefetch
  clicked_at?: string | null;
  watched_pct?: number | null; // 0 to 100
};

/* The ledger's engagement chips for one send, in funnel order. An untracked
   send has nothing to say, so it gets no chips at all — a bare row means
   "we never asked", not "nobody opened it".

   "Opened, maybe" is the honest label when the only open reads as a
   prefetch: Apple Mail fetches the GIF before a person sees the email. A
   click or a watch settles it, so the hedge drops as soon as either lands. */
export function engagementChips(send: SendEngagement): string[] {
  if (!send.tracked) return [];
  const watched = send.watched_pct ?? 0;
  const clicked = Boolean(send.clicked_at);
  const chips: string[] = [];
  if (send.opened_at) {
    chips.push(
      send.open_suspect && !clicked && watched <= 0 ? "Opened, maybe" : "Opened",
    );
  }
  if (clicked) chips.push("Clicked");
  if (watched > 0) chips.push(`Watched ${Math.round(watched)}%`);
  return chips;
}

export type SentOrder = "newest" | "oldest";

export type SentQuery = {
  kind: string | null; // null = all kinds
  order: SentOrder;
};

export const DEFAULT_SENT_QUERY: SentQuery = { kind: null, order: "newest" };

/* The sent ledger's GET /sends query string. Defaults are omitted so the
   plain first load stays byte-identical to what older builds sent (and an
   older backend simply ignores the params it predates). */
export function sentLedgerQuery(query: SentQuery, limit: number): string {
  const params = new URLSearchParams({ view: "sent", limit: String(limit) });
  if (query.kind !== null) params.set("kind", query.kind);
  if (query.order !== "newest") params.set("order", query.order);
  return params.toString();
}
