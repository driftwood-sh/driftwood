import { useEffect, useState, type ReactNode } from "react";
import { LoggedOutView, ToastProvider } from "./DashboardCommon";
import { AdminPanelControls, ImpersonationBanner } from "../GodMode";
import AppShell, { type DashboardSection } from "./AppShell";
import { WorkspacePermissionsProvider } from "./workspace-permissions";
import type { WorkspaceRole } from "./workspace-permissions-context";
import { withMockMode } from "../mock-mode";
import { clearIdentity, loadIdentity } from "../identity";
import { useDemosNavCount } from "../demos/nav-count";

type WorkspaceUser = {
  email: string;
  name: string;
  avatar_url: string | null;
  is_approved: boolean;
  is_admin?: boolean;
  impersonating?: boolean;
  linkedin_connected?: boolean;
  email_connected?: boolean;
  twitter_connected?: boolean;
  org?: { name: string; role: WorkspaceRole } | null;
};

type AuthState =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "ready"; user: WorkspaceUser };

/* /auth/me starts at module eval (chunk load), in parallel with whatever the
   child page prefetches — cached identity paints the real shell immediately
   and the background result confirms it or swaps to the logged-out view. */
const identityBoot =
  typeof window === "undefined" ? null : loadIdentity<WorkspaceUser>();

export default function WorkspacePage({
  active,
  children,
  notice,
  workspace = false,
}: {
  active: DashboardSection;
  children: ReactNode;
  notice?: ReactNode;
  workspace?: boolean;
}) {
  /* Unapproved users never seed from cache — they belong on the denied view,
     and the fresh result below sends them there. */
  const [auth, setAuth] = useState<AuthState>(
    identityBoot?.cached?.is_approved
      ? { status: "ready", user: identityBoot.cached }
      : { status: "loading" },
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fresh = (await identityBoot?.fresh) ?? null;
      if (cancelled) return;
      // Only approved users get the workspace; everyone else gets the
      // logged-out view, exactly as before the cache existed. A 401 or
      // network failure already cleared the identity cache.
      if (fresh?.is_approved) {
        setAuth({ status: "ready", user: fresh }); // swap in place when it differs from the cache
      } else {
        if (fresh) clearIdentity(); // logged in, but not approved
        setAuth({ status: "denied" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* The Demos badge: what waits on the customer's own approval, and nothing
     on auto approval. Read once the viewer is known, so an unauthed page
     load asks for nothing. */
  const demosCount = useDemosNavCount(auth.status === "ready");

  async function logout() {
    try {
      await fetch("/auth/logout", { method: "POST", credentials: "include" });
    } finally {
      clearIdentity();
      window.location.href = withMockMode("/dashboard");
    }
  }

  // First-ever visit only (no cached identity): nothing real to paint yet.
  if (auth.status === "loading") {
    return <div className="flex min-h-[100dvh] items-center justify-center"><span className="size-7 animate-spin rounded-full border-2 border-line border-t-tide" role="status" aria-label="Loading workspace" /></div>;
  }
  if (auth.status === "denied") return <LoggedOutView />;

  const user = auth.user;
  const role = user.org?.role ?? "owner";
  const canWrite = role !== "member";
  return (
    <ToastProvider>
      {user.impersonating && <ImpersonationBanner email={user.email} />}
      <WorkspacePermissionsProvider role={role} channels={{
        linkedin: user.linkedin_connected ?? false,
        email: user.email_connected ?? false,
        x: user.twitter_connected ?? false,
      }}>
        <AppShell
          active={active}
          workspace={workspace}
          identity={{ name: user.name || user.email, workspace: user.org?.name, avatarUrl: user.avatar_url }}
          onLogout={logout}
          adminControl={user.is_admin ? <AdminPanelControls /> : undefined}
          notice={notice}
          canWrite={canWrite}
          navCounts={{ demos: demosCount }}
        >
          {children}
        </AppShell>
      </WorkspacePermissionsProvider>
    </ToastProvider>
  );
}
