/* Pure helpers behind the Sending accounts lists, split out so node --test
   can pin the label fallback and the "channel is connected" rule (same
   convention as team-model.ts). Type-only import keeps this file free of
   fetch code. */

import type { AccountsPage, EmailState, SendingAccount, XState } from "./api";
import type { ManagedMailbox } from "../dashboard/managed-inboxes";

/* What a row is called: the backend's display, then the linker's name,
   then their email. */
export function accountLabel(account: SendingAccount<unknown>): string {
  return account.display ?? account.connectedBy.name ?? account.connectedBy.email;
}

/* Who the row's second line names: "you" on the viewer's own row, else
   the linker's name, then their email. */
export function linkedBy(account: SendingAccount<unknown>): string {
  if (account.isMine) return "you";
  return account.connectedBy.name ?? account.connectedBy.email;
}

/* The row's second line as one string (the title attribute, tests). */
export function linkedByLine(account: SendingAccount<unknown>): string {
  return `Linked by ${linkedBy(account)}`;
}

/* A row that can send now. An X login that still sits behind the chat PIN
   wall is active as far as the backend is concerned, but DMs cannot go out,
   so the card and the "N of 3 connected" count treat it as not yet usable,
   exactly as the single-account card did. */
export function isUsable(account: SendingAccount<unknown>): boolean {
  if (account.status !== "active") return false;
  const state = account.channelState as Partial<XState> | null;
  return !(state && state.chatLocked === true);
}

export function channelConnected(rows: SendingAccount<unknown>[]): boolean {
  return rows.some(isUsable);
}

/* The viewer's own row in a channel, or null. LinkedIn and X hold at most
   one per person; email may hold several, and the first is returned. */
export function ownAccount<S>(rows: SendingAccount<S>[]): SendingAccount<S> | null {
  return rows.find((row) => row.isMine) ?? null;
}

/* "N of 3 connected": channels with at least one usable row. */
export function connectedChannelCount(page: AccountsPage): number {
  return [page.linkedin, page.email, page.x].filter(channelConnected).length;
}

/* ---------- the Email card ---------- */

/* A connected mailbox sends up to this many a day when the backend does
   not say otherwise (older payloads carry no daily_cap). */
export const EMAIL_DEFAULT_CAP = 20;

/* A pending sign-in link lives this long after it is minted. */
export const EMAIL_LINK_TTL_MS = 10 * 60_000;

export function emailDailyCap(account: SendingAccount<EmailState>): number {
  return account.dailyCap ?? EMAIL_DEFAULT_CAP;
}

/* The row's name line: the mailbox address, then the label fallback. */
export function emailAddress(account: SendingAccount<EmailState>): string {
  return account.channelState.address ?? accountLabel(account);
}

/* What the row shows: an expired link is an error row whose channel
   state says so. Everything else follows the status. */
export type EmailRowState = "active" | "pending" | "expired" | "error";

export function emailRowState(account: SendingAccount<EmailState>): EmailRowState {
  if (account.status === "error") {
    return account.channelState.linkState === "expired" ? "expired" : "error";
  }
  return account.status;
}

/* "Google" or "Microsoft" for the chip and the tab sentence. Null when
   the provider is unknown, and the row then reads as it did before. */
export function emailProviderName(provider: EmailState["provider"]): "Google" | "Microsoft" | null {
  if (provider === "gmail") return "Google";
  if (provider === "outlook") return "Microsoft";
  return null;
}

/* Whole minutes left on a pending link, floored at 0. Null when the
   backend did not say when the link was minted. */
export function linkMinutesLeft(linkMintedAt: string | null, now: number): number | null {
  if (linkMintedAt === null) return null;
  const minted = Date.parse(linkMintedAt);
  if (Number.isNaN(minted)) return null;
  return Math.max(0, Math.floor((minted + EMAIL_LINK_TTL_MS - now) / 60_000));
}

/* A bought inbox that can send today: warm or ready. Warming inboxes
   carry no sends until their warm-up ends, so they are counted apart;
   provisioning and paused inboxes are listed but not counted. */
export function managedInboxReady(box: ManagedMailbox): boolean {
  return box.status === "active" || box.status === "ready";
}

/* The summary under "Email": ready mailboxes, the day's ceiling, and the
   bought inboxes still warming up. Ready is every usable connected row
   plus every bought inbox that can send today. The cap sums each
   sender's own daily ceiling. */
export function emailSummary(
  rows: SendingAccount<EmailState>[],
  mailboxes: ManagedMailbox[],
): { ready: number; cap: number; warming: number } {
  const usable = rows.filter(isUsable);
  const bought = mailboxes.filter(managedInboxReady);
  return {
    ready: usable.length + bought.length,
    cap:
      usable.reduce((sum, row) => sum + emailDailyCap(row), 0) +
      bought.reduce((sum, box) => sum + box.todays_cap, 0),
    warming: mailboxes.filter((box) => box.status === "warming").length,
  };
}

/* "3 mailboxes ready · up to 60 sends a day · 2 warming up". The cap
   part is left out when nothing can send, the warming part when none
   is warming. */
export function emailSummaryLine(summary: { ready: number; cap: number; warming?: number }): string {
  let line = `${summary.ready} ${summary.ready === 1 ? "mailbox" : "mailboxes"} ready`;
  if (summary.cap > 0) line += ` · up to ${summary.cap} ${summary.cap === 1 ? "send" : "sends"} a day`;
  if (summary.warming) line += ` · ${summary.warming} warming up`;
  return line;
}

/* The row the return banner names: the viewer's newest active mailbox.
   Null when the viewer has none. */
export function newestOwnActive(rows: SendingAccount<EmailState>[]): SendingAccount<EmailState> | null {
  let newest: SendingAccount<EmailState> | null = null;
  for (const row of rows) {
    if (!row.isMine || row.status !== "active") continue;
    if (newest === null) {
      newest = row;
      continue;
    }
    const at = row.connectedAt === null ? -Infinity : Date.parse(row.connectedAt);
    const best = newest.connectedAt === null ? -Infinity : Date.parse(newest.connectedAt);
    if (at > best) newest = row;
  }
  return newest;
}
