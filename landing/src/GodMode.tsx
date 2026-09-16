import { useEffect, useState } from "react";
import { AdminIcon, CloseIcon, OverviewIcon } from "./dashboard/icons";
import { CARD, useToast } from "./dashboard-shared";
import { withMockMode } from "./mock-mode";

/* God mode — admin-only user impersonation. A header button opens a search
   modal to pick a user and "become" them; a sticky banner shows while
   impersonating and lets the admin drop back to themselves. Both talk to the
   same-origin /api/v1/admin/* endpoints with the first-party session cookie.
   On any state change we hard-reload so the whole app re-reads /auth/me as the
   effective (impersonated) user. */

type AdminUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatar_url: string | null;
  is_approved: boolean;
  is_admin: boolean;
  /* ISO timestamp, or null when the user is not archived. Archiving moves the
     user into the Archived group at the bottom of this picker: it does not
     pause that customer's agent, sign the person out, stop their sends, or
     block impersonation. */
  archived_at: string | null;
  created_at: string;
};

/* ---------- header button + modal ---------- */

export function AdminPanelControls({ inAdminPanel = false }: { inAdminPanel?: boolean }) {
  return (
    <div className="admin-access-controls">
      <a className="admin-access-action" href={withMockMode(inAdminPanel ? "/dashboard" : "/dashboard/admin")}>
        {inAdminPanel ? <OverviewIcon size={15} /> : <AdminIcon size={15} />}
        {inAdminPanel ? "Customer workspace" : "Admin panel"}
      </a>
      <GodModeButton />
    </div>
  );
}

export function GodModeButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="admin-access-action"
      >
        <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
          <path d="M9.6 1.5 4.2 8.2h3.4l-1.1 6.3 5.3-7H8.5l1.1-6Z" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
        </svg>
        Impersonate user
      </button>
      {open && <ImpersonateModal onClose={() => setOpen(false)} />}
    </>
  );
}

function ImpersonateModal({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [archivedTotal, setArchivedTotal] = useState(0);
  /* Collapsed on every open: the picker opens on the people you can act on. */
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [impersonatingId, setImpersonatingId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const toast = useToast();

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /* Debounced search — fetch on mount (empty q) and whenever q or the archived
     section changes. archived_total counts every archived row matching q, in
     or out of this page, so the divider's count stays honest at limit=50 and
     reports archived matches while the section is shut. */
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/v1/admin/users?q=${encodeURIComponent(q)}&limit=50&include_archived=${archivedOpen}`,
          { credentials: "include" },
        );
        if (cancelled) return;
        if (!res.ok) throw new Error("request failed");
        const data = (await res.json()) as {
          users: AdminUser[];
          total: number;
          archived_total: number;
        };
        if (!cancelled) {
          setUsers(data.users);
          setArchivedTotal(data.archived_total);
        }
      } catch {
        if (!cancelled) {
          setUsers([]);
          setArchivedTotal(0);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, archivedOpen]);

  /* Archive and restore paint first, then reconcile. The row holds its index
     in `users` and only archived_at changes, so the groups below re-sort it
     at once: an archived row drops out of the live list, a restored one comes
     back up into it. Every update is a functional one so two rows in flight
     at once cannot clobber each other, and a failed request writes the
     original row back at the same index and says why — the list never keeps a
     state the server rejected. */
  async function setArchived(user: AdminUser, archived: boolean) {
    const optimistic: AdminUser = {
      ...user,
      archived_at: archived ? new Date().toISOString() : null,
    };
    setBusyId(user.id);
    setUsers((prev) => prev.map((row) => (row.id === user.id ? optimistic : row)));
    setArchivedTotal((n) => Math.max(0, n + (archived ? 1 : -1)));
    try {
      const res = await fetch(
        `/api/v1/admin/users/${encodeURIComponent(user.id)}/${archived ? "archive" : "unarchive"}`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) {
        /* {"error":{"code","detail"}} — the server's own reason, e.g. you
           cannot archive yourself, which no amount of retrying fixes. */
        const body = (await res.json().catch(() => null)) as {
          error?: { detail?: string };
        } | null;
        throw new Error(body?.error?.detail ?? "");
      }
      const row = (await res.json()) as AdminUser;
      setUsers((prev) => prev.map((r) => (r.id === row.id ? row : r)));
    } catch (err) {
      setUsers((prev) => prev.map((r) => (r.id === user.id ? user : r)));
      setArchivedTotal((n) => Math.max(0, n + (archived ? -1 : 1)));
      const reason = err instanceof Error && err.message ? err.message : null;
      toast(
        reason ??
          (archived
            ? "Couldn't archive that user. Please try again."
            : "Couldn't restore that user. Please try again."),
        "error",
      );
    } finally {
      setBusyId((current) => (current === user.id ? null : current));
    }
  }

  /* One list, two groups. The live group is the picker; archived rows only
     ever render under the divider, so an archived account can never sit
     between two live ones. */
  const liveUsers = users.filter((row) => row.archived_at === null);
  const archivedUsers = users.filter((row) => row.archived_at !== null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 px-4 py-[10vh] backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Impersonate a user"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`flex max-h-[80vh] w-full max-w-lg flex-col ${CARD} p-5 sm:p-6`}>
        <div className="flex items-start justify-between gap-3">
          <h2 className="m-0 text-[18px] font-semibold tracking-[-0.01em]">
            Impersonate a user
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 grid size-9 cursor-pointer place-items-center rounded-lg border-0 bg-transparent text-ink-faint transition-colors hover:text-ink"
          >
            <CloseIcon size={17} />
          </button>
        </div>

        <input
          type="text"
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or email…"
          className="mt-4 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[14px] text-ink outline-none transition-colors placeholder:text-ink-faint focus:border-tide/60"
        />

        <div className="mt-4 min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span
                className="size-6 animate-spin rounded-full border-2 border-line border-t-tide"
                role="status"
                aria-label="Searching"
              />
            </div>
          ) : (
            <>
              {liveUsers.length === 0 ? (
                <p className="m-0 py-10 text-center text-[13.5px] text-ink-soft">
                  {archivedTotal > 0 ? "No users found in the main list." : "No users found."}
                </p>
              ) : (
                <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label="Users">
                  {liveUsers.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      pending={impersonatingId === u.id}
                      disabled={impersonatingId !== null}
                      archiveBusy={busyId === u.id}
                      onImpersonatingChange={setImpersonatingId}
                      onArchivedChange={setArchived}
                    />
                  ))}
                </ul>
              )}

              {/* The line that closes the live list. Its count is archived_total
                  for the current q, so a shut section still reports matches. */}
              <button
                type="button"
                onClick={() => setArchivedOpen((open) => !open)}
                aria-expanded={archivedOpen}
                aria-controls="impersonate-archived"
                className="mt-2.5 flex w-full cursor-pointer items-center gap-2.5 border-0 bg-transparent px-0.5 py-2 text-left text-[12px] font-medium text-ink-soft transition-colors hover:text-ink"
              >
                <span className="shrink-0">Archived {archivedTotal}</span>
                <span className="h-px flex-1 bg-line" aria-hidden="true" />
                <span className="shrink-0 font-normal text-ink-faint">
                  {archivedOpen ? "Hide" : "Show"}
                </span>
              </button>

              {archivedOpen && (
                <section id="impersonate-archived" aria-label="Archived users">
                  <p className="m-0 px-0.5 pb-2.5 text-[12px] leading-[1.45] text-ink-soft">
                    An archived user stays out of the list above and off the fleet page.
                    They can still sign in, their agent keeps running, and you can still
                    impersonate them.
                  </p>
                  {archivedUsers.length === 0 ? (
                    <p className="m-0 px-0.5 pb-1 text-[12.5px] text-ink-soft">
                      {q ? "No archived users match this search." : "No archived users."}
                    </p>
                  ) : (
                    <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
                      {archivedUsers.map((u) => (
                        <UserRow
                          key={u.id}
                          user={u}
                          muted
                          pending={impersonatingId === u.id}
                          disabled={impersonatingId !== null}
                          archiveBusy={busyId === u.id}
                          onImpersonatingChange={setImpersonatingId}
                          onArchivedChange={setArchived}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function UserRow({
  user,
  muted = false,
  pending,
  disabled,
  archiveBusy,
  onImpersonatingChange,
  onArchivedChange,
}: {
  user: AdminUser;
  /* Archived rows read quieter than live ones, but stay legible: the name
     drops to body gray, never to a faint tint. */
  muted?: boolean;
  pending: boolean;
  disabled: boolean;
  archiveBusy: boolean;
  onImpersonatingChange: (id: string | null) => void;
  onArchivedChange: (user: AdminUser, archived: boolean) => void;
}) {
  const displayName = user.name || user.email || "Unnamed user";
  const archived = user.archived_at !== null;
  const toast = useToast();

  async function handleImpersonate() {
    onImpersonatingChange(user.id);
    try {
      const res = await fetch(`/api/v1/admin/impersonate/${user.id}`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("request failed");
      window.location.href = withMockMode("/dashboard");
    } catch {
      toast("Couldn't impersonate that user. Please try again.", "error");
      onImpersonatingChange(null);
    }
  }

  return (
    <li
      className={`flex items-center gap-3 rounded-xl border border-line px-3 py-2.5 ${
        muted ? "bg-sand/50" : "bg-surface"
      }`}
    >
      {user.avatar_url ? (
        <img
          src={user.avatar_url}
          alt={`${displayName}'s avatar`}
          className="size-8 shrink-0 rounded-full border border-line object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span
          className={`flex size-8 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white ${
            muted ? "bg-ink-faint" : "bg-tide"
          }`}
        >
          {displayName[0]?.toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span
            className={`truncate text-[14px] font-medium ${muted ? "text-ink-soft" : "text-ink"}`}
          >
            {user.name || user.email || "Unnamed user"}
          </span>
          {user.is_admin && <Badge>admin</Badge>}
          {user.is_approved && <Badge>approved</Badge>}
          {archived && <Badge>archived</Badge>}
        </div>
        {user.name && user.email && (
          <div className="truncate text-[12.5px] text-ink-soft">{user.email}</div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* Archive only decides which group the row sits in, so it never gates
            the row's real action: an archived user impersonates exactly like
            any other. */}
        <button
          type="button"
          onClick={() => onArchivedChange(user, !archived)}
          disabled={archiveBusy || disabled}
          className={
            archived
              ? "cursor-pointer rounded-full border border-tide/40 bg-surface px-3 py-2 text-[12px] font-medium text-tide hover:bg-tide-wash disabled:cursor-wait disabled:opacity-50"
              : "cursor-pointer rounded-full border border-line bg-surface px-3 py-2 text-[12px] font-medium text-ink-soft hover:border-ink-faint hover:text-ink disabled:cursor-wait disabled:opacity-50"
          }
        >
          {archived ? "Restore" : "Archive"}
        </button>
        <button
          type="button"
          onClick={handleImpersonate}
          disabled={disabled}
          className="inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full bg-ink px-3.5 py-2 text-[13px] font-medium text-white no-underline transition-all hover:-translate-y-px hover:bg-black disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending && (
            <span
              aria-hidden="true"
              className="size-3.5 animate-spin rounded-full border-[1.5px] border-white/40 border-t-white"
            />
          )}
          {pending ? "Entering…" : "Impersonate"}
        </button>
      </div>
    </li>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-line bg-sand/60 px-1.5 py-0.5 text-[10.5px] text-ink-faint">
      {children}
    </span>
  );
}

/* ---------- sticky "you are impersonating" banner ---------- */

export function ImpersonationBanner({ email }: { email: string }) {
  const [exiting, setExiting] = useState(false);
  const toast = useToast();

  async function handleExit() {
    setExiting(true);
    try {
      const res = await fetch("/api/v1/admin/stop-impersonating", {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) throw new Error("request failed");
      window.location.href = withMockMode("/dashboard");
    } catch {
      toast("Couldn't exit god mode. Please try again.", "error");
      setExiting(false);
    }
  }

  return (
    <div className="god-mode-banner">
      <div className="god-mode-banner-content">
        <span className="god-mode-banner-label">
          <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
            <path d="M2.2 9s2.6-4.2 6.8-4.2S15.8 9 15.8 9s-2.6 4.2-6.8 4.2S2.2 9 2.2 9Z" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="9" cy="9" r="2.2" stroke="currentColor" strokeWidth="1.4" />
          </svg>
          God mode — viewing as {email}.
        </span>
        <button
          type="button"
          onClick={handleExit}
          disabled={exiting}
          className="god-mode-banner-exit"
        >
          {exiting ? "Exiting…" : "Exit god mode"}
        </button>
      </div>
    </div>
  );
}
