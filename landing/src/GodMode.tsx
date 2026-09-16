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
  /* ISO timestamp, or null when the user is not archived. Archiving is a
     visibility switch on this list only: it does not pause that customer's
     agent, sign the person out, stop their sends, or block impersonation. */
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
  const [showArchived, setShowArchived] = useState(false);
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
     filter changes. archived_total counts every archived row matching q, in or
     out of this page, so the toggle's count stays honest at limit=50. */
  useEffect(() => {
    let cancelled = false;
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `/api/v1/admin/users?q=${encodeURIComponent(q)}&limit=50&include_archived=${showArchived}`,
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
  }, [q, showArchived]);

  /* Archive and restore paint first, then reconcile. Every update is a
     functional one so two rows in flight at once cannot clobber each other,
     and a failed request puts the row back at its old index and says so —
     the list never keeps a state the server rejected. */
  async function setArchived(user: AdminUser, archived: boolean) {
    const index = users.findIndex((row) => row.id === user.id);
    const optimistic: AdminUser = {
      ...user,
      archived_at: archived ? new Date().toISOString() : null,
    };
    setBusyId(user.id);
    setUsers((prev) =>
      prev.flatMap((row) => {
        if (row.id !== user.id) return [row];
        // With the filter off, an archived row leaves the list at once.
        return archived && !showArchived ? [] : [optimistic];
      }),
    );
    setArchivedTotal((n) => Math.max(0, n + (archived ? 1 : -1)));
    try {
      const res = await fetch(
        `/api/v1/admin/users/${encodeURIComponent(user.id)}/${archived ? "archive" : "unarchive"}`,
        { method: "POST", credentials: "include" },
      );
      if (!res.ok) throw new Error("request failed");
      const row = (await res.json()) as AdminUser;
      setUsers((prev) => prev.map((r) => (r.id === row.id ? row : r)));
    } catch {
      setUsers((prev) => {
        const next = prev.filter((r) => r.id !== user.id);
        next.splice(index < 0 ? next.length : Math.min(index, next.length), 0, user);
        return next;
      });
      setArchivedTotal((n) => Math.max(0, n + (archived ? -1 : 1)));
      toast(
        archived
          ? "Couldn't archive that user. Please try again."
          : "Couldn't restore that user. Please try again.",
        "error",
      );
    } finally {
      setBusyId((current) => (current === user.id ? null : current));
    }
  }

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

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button
            type="button"
            onClick={() => setShowArchived((on) => !on)}
            aria-pressed={showArchived}
            className={`cursor-pointer rounded-full border px-3.5 py-2 text-[12.5px] font-medium transition-colors ${
              showArchived
                ? "border-tide/40 bg-tide-wash text-tide"
                : "border-line bg-surface text-ink-soft hover:text-ink"
            }`}
          >
            Archived {archivedTotal}
          </button>
          {showArchived && (
            <p className="m-0 text-[12px] text-ink-soft">
              An archived user stays out of this list and the fleet page. They can
              still sign in, their agent keeps running, and you can still impersonate
              them.
            </p>
          )}
        </div>

        <div className="mt-4 min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span
                className="size-6 animate-spin rounded-full border-2 border-line border-t-tide"
                role="status"
                aria-label="Searching"
              />
            </div>
          ) : users.length === 0 ? (
            <p className="m-0 py-10 text-center text-[13.5px] text-ink-soft">
              No users found.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {users.map((u) => (
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
        </div>
      </div>
    </div>
  );
}

function UserRow({
  user,
  pending,
  disabled,
  archiveBusy,
  onImpersonatingChange,
  onArchivedChange,
}: {
  user: AdminUser;
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
    <li className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
      {user.avatar_url ? (
        <img
          src={user.avatar_url}
          alt={`${displayName}'s avatar`}
          className="size-8 shrink-0 rounded-full border border-line object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-tide text-[13px] font-semibold text-white">
          {displayName[0]?.toUpperCase()}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-[14px] font-medium text-ink">
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
        {/* Archive is a list filter, so it never gates the row's real action:
            an archived user impersonates exactly like any other. */}
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
