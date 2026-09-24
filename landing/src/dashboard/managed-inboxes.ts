import { useCallback, useEffect, useRef, useState } from "react";

/* Managed inboxes — data + labels for the EmailCard's compact pool view
   and its sender-first buy flow (GET /mailboxes/overview,
   GET /mailboxes/availability, POST /mailboxes/purchase — all proxied like
   the other backend routes).

   The pool surfaces ONLY when the API returns at least one domain. On an
   empty pool, a 404, or any fetch failure the hook stays null and the
   EmailCard shows only the customer's own mailbox — the pool must never
   break the page.

   No prices or billing anywhere: customers never see money here. From the
   customer's view they are choosing senders and domains, not purchasing —
   the button says Done and execution is immediate. */

export type ManagedMailbox = {
  address: string;
  domain: string;
  status: "provisioning" | "warming" | "ready" | "active" | "paused";
  warming_day: number | null;
  warming_days_total: number;
  todays_cap: number;
  /* the daily cap a fully ramped inbox reaches, and the two dates the
     row names: when a warming inbox turns ready, and when a ramping one
     reaches full_cap. Optional: a backend that predates them omits them,
     and the row then leaves the dates out. */
  full_cap?: number;
  ready_at?: string | null;
  full_cap_at?: string | null;
  sent_today: number;
  health: "good" | "warning" | "unknown";
  paused_reason: string | null;
};

export type ManagedDomain = {
  name: string;
  status: string;
  registered_at: string | null;
};

/* The customer's own Composio-connected mailbox, as the overview reports
   it. `address` is null whenever the backend can't learn it from Composio
   (which today is always — the connected-account payload carries no
   address); the row then shows a generic label, never the login email. */
export type OwnMailbox = {
  connected: boolean;
  address: string | null;
};

export type MailboxesOverview = {
  /* capacity covers the managed pool only — the customer's own connected
     mailbox adds 20/day client-side, from the same email_connected flag
     the EmailCard uses. */
  capacity: { current_per_day: number; projected_per_day: number };
  domains: ManagedDomain[];
  mailboxes: ManagedMailbox[];
  /* absent on payloads from a backend that predates the field — the
     overlay then renders managed rows only, exactly as before. */
  own_mailbox?: OwnMailbox;
};

export type SenderInput = {
  username: string;
};

export type PurchaseResult = {
  domains: { name: string; status: string }[];
  mailboxes_planned: number;
};

/* one workspace's ceiling — enforced in the UI before the backend sees it */
export const DOMAIN_CAP = 5;
export const INBOX_CAP = 10;

export function useManagedInboxes(): {
  pool: MailboxesOverview | null;
  applyPurchase: (result: PurchaseResult, senders: SenderInput[]) => void;
} {
  const [pool, setPool] = useState<MailboxesOverview | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/mailboxes/overview", {
          credentials: "include",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as MailboxesOverview;
        if (cancelled) return;
        // Only a well-formed payload with at least one domain surfaces the
        // pool; anything else keeps the EmailCard exactly as it is today.
        if (
          Array.isArray(data.domains) &&
          data.domains.length > 0 &&
          Array.isArray(data.mailboxes)
        ) {
          setPool(data);
        }
      } catch {
        /* stay absent — never break the overview over this */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Optimistic refresh after a successful purchase: fold the response into
     the local pool so the tile shows the new counts immediately, with the
     bought domains in their registering state and one provisioning mailbox
     per sender × domain. Server truth replaces this on the next load. */
  const applyPurchase = useCallback(
    (result: PurchaseResult, senders: SenderInput[]) => {
      setPool((prev) => {
        const domains = [...(prev?.domains ?? [])];
        for (const bought of result.domains) {
          if (!domains.some((d) => d.name === bought.name)) {
            domains.push({
              name: bought.name,
              status: bought.status,
              registered_at: null,
            });
          }
        }
        const mailboxes = [...(prev?.mailboxes ?? [])];
        for (const bought of result.domains) {
          for (const sender of senders) {
            const address = `${sender.username}@${bought.name}`;
            if (mailboxes.some((m) => m.address === address)) continue;
            mailboxes.push({
              address,
              domain: bought.name,
              status: "provisioning",
              warming_day: null,
              warming_days_total: 14,
              todays_cap: 0,
              sent_today: 0,
              health: "unknown",
              paused_reason: null,
            });
          }
        }
        return {
          capacity: prev?.capacity ?? {
            current_per_day: 0,
            projected_per_day: 0,
          },
          domains,
          mailboxes,
          // carry the own-mailbox row through the optimistic rebuild
          own_mailbox: prev?.own_mailbox,
        };
      });
    },
    [],
  );

  return { pool, applyPurchase };
}

/* What the managed pool can carry today. The cap rising day by day as
   inboxes warm is the feature's whole visible behavior. */
export const managedInboxCap = (mailboxes: ManagedMailbox[]) =>
  mailboxes.reduce((sum, box) => sum + box.todays_cap, 0);

/* The overlay's FIRST row: the customer's own connected mailbox, so the
   list adds up to the tile's count. No row when own_mailbox is absent (a
   backend that predates the field) or the grant is disconnected — the
   overlay then reads exactly as it did before. A null address falls back
   to a generic label. */
export const ownMailboxRow = (
  own: OwnMailbox | null | undefined,
): { label: string } | null =>
  own?.connected ? { label: own.address ?? "Your connected mailbox" } : null;

/* "Sep 25" in the viewer's time zone. */
const shortDate = (at: number) =>
  new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/* A future moment from an ISO string, or null when the string is absent,
   unparseable, or already past. */
function futureAt(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isNaN(at) || at <= now ? null : at;
}

/* What a bought inbox's row says: one sub line, plus a chip for the
   states that cannot send (provisioning, paused). Sentence case in the
   strings.
   - warming: the day of the warm-up and the date it will be ready;
   - ready/active: today's count against today's cap, and while the cap
     is still rising, the full cap and the date it gets there. */
export function boughtInboxLine(
  box: ManagedMailbox,
  now: number,
): { sub: string; chip: string | null } {
  if (box.status === "warming") {
    if (box.warming_day === null) return { sub: "Bought inbox · warming up", chip: null };
    // the reconciler flips a finished inbox within minutes; never show
    // a day past the total while it does
    const day = Math.min(box.warming_day, box.warming_days_total);
    let sub = `Bought inbox · warming up, day ${day} of ${box.warming_days_total}`;
    const ready = futureAt(box.ready_at, now);
    if (ready !== null) sub += ` · ready ${shortDate(ready)}`;
    return { sub, chip: null };
  }
  if (box.status === "active" || box.status === "ready") {
    let sub = `Bought inbox · ${box.sent_today} of ${box.todays_cap} sent today`;
    const full = futureAt(box.full_cap_at, now);
    if (full !== null && box.full_cap !== undefined && box.todays_cap < box.full_cap) {
      sub += ` · rises to ${box.full_cap} a day by ${shortDate(full)}`;
    }
    return { sub, chip: null };
  }
  return {
    sub: "Bought inbox",
    chip: box.status.charAt(0).toUpperCase() + box.status.slice(1),
  };
}

/* ---------- buy-flow helpers ---------- */

/* Ordered variation shapes applied to any base. The five Autosana-slate
   originals lead, because they are the proven favorites. The rest of the
   credible business shapes follow in order.
   The 17 .com names come first, because .com is the safest choice for
   cold email. The 12 .co names come after them, as a fallback for a
   company whose .com names are all taken. The vendor sells .co. It does
   not sell .ai or .io (availability probe, 2026-09-11), so those stay out
   until a bring-your-own-domain path exists. Cheap or abused TLDs stay
   out: .top, .xyz, .click, .info, .biz, and .online. */
export function domainVariations(base: string): string[] {
  const clean = base.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!clean) return [];
  return [
    `${clean}-ai.com`,
    `${clean}hq.com`,
    `use${clean}.com`,
    `join${clean}.com`,
    `with${clean}.com`,
    `get${clean}.com`,
    `try${clean}.com`,
    `meet${clean}.com`,
    `hello${clean}.com`,
    `go${clean}.com`,
    `on${clean}.com`,
    `${clean}ai.com`,
    `${clean}-hq.com`,
    `${clean}app.com`,
    `${clean}-app.com`,
    `${clean}team.com`,
    `${clean}-team.com`,
    `${clean}.co`,
    `use${clean}.co`,
    `join${clean}.co`,
    `get${clean}.co`,
    `try${clean}.co`,
    `with${clean}.co`,
    `meet${clean}.co`,
    `${clean}hq.co`,
    `hello${clean}.co`,
    `go${clean}.co`,
    `${clean}app.co`,
    `${clean}team.co`,
  ];
}

/* Domain ideas seeded from the customer's company name. */
export const domainSuggestions = (companyName: string | null): string[] =>
  domainVariations(companyName ?? "");

/* Whether the domain search should offer "Show more": verified available
   names exist beyond the visible slice, or unchecked candidates remain.
   Deliberately independent of how many rows are visible right now —
   picking every visible suggestion must never hide the path to more.
   The one exception: while a sweep is filling an empty list the checking
   hint owns that state, so the control waits for results or exhaustion. */
export const hasMoreDomains = (state: {
  unselectedVerified: number;
  visibleTarget: number;
  exhausted: boolean;
  checkingEmpty: boolean;
}): boolean =>
  !state.checkingEmpty &&
  (state.unselectedVerified > state.visibleTarget || !state.exhausted);

/* mailbox names are the local part of an address: lowercase, no spaces */
export const deriveUsername = (name: string) =>
  name.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");

export async function checkDomainAvailability(
  domain: string,
): Promise<boolean | null> {
  try {
    const res = await fetch(
      `/mailboxes/availability?domain=${encodeURIComponent(domain)}`,
      { credentials: "include" },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { domain: string; available: boolean };
    return typeof data.available === "boolean" ? data.available : null;
  } catch {
    return null;
  }
}

export async function purchaseInboxes(
  domains: string[],
  senders: SenderInput[],
): Promise<
  { ok: true; result: PurchaseResult } | { ok: false; status: number }
> {
  try {
    const res = await fetch("/mailboxes/purchase", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domains, senders }),
    });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, result: (await res.json()) as PurchaseResult };
  } catch {
    return { ok: false, status: 0 };
  }
}

/* ---------- shared dialog chrome ---------- */

/* Focus trap + Esc + body scroll lock for the small overlays this feature
   floats over the grid (the add-inboxes flow and the inbox list). Focus
   moves into the dialog on open, Tab cycles inside it, Esc closes unless
   canClose says otherwise, and focus returns to the opener. */
export function useDialogTrap(
  dialogRef: { current: HTMLElement | null },
  onClose: () => void,
  canClose?: () => boolean,
): void {
  const closeRef = useRef(onClose);
  const canRef = useRef(canClose);
  useEffect(() => {
    closeRef.current = onClose;
    canRef.current = canClose;
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    const opener = document.activeElement as HTMLElement | null;
    dialog
      ?.querySelector<HTMLElement>(
        'input:not([disabled]), button:not([disabled])',
      )
      ?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (canRef.current?.() ?? true) closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusables = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), [href]",
        ),
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = bodyOverflow;
      opener?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
