import { useCallback, useEffect, useState } from "react";
import AppShell from "../dashboard/AppShell";
import { LoggedOutView, ToastProvider } from "../dashboard/DashboardCommon";
import { AdminPanelControls, ImpersonationBanner } from "../GodMode";
import { fetchAgentRuns, fetchOverview, type DriftOverview } from "./api";
import type { DriftRun } from "./model";
import ScriptStudio from "./ScriptStudio";
import RunExplorer from "./RunExplorer";
import "./drift.css";

type User = {
  id: string;
  email: string;
  name: string;
  avatar_url: string | null;
  is_admin?: boolean;
  impersonating?: boolean;
};
type Auth =
  | { status: "loading" }
  | { status: "denied" }
  | { status: "ok"; user: User };

export default function Drift() {
  const [auth, setAuth] = useState<Auth>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    fetch("/auth/me", { credentials: "include", signal: controller.signal })
      .then(async (response) => {
        const user: User | null = response.ok ? await response.json() : null;
        if (!controller.signal.aborted)
          setAuth(
            user?.is_admin ? { status: "ok", user } : { status: "denied" },
          );
      })
      .catch(() => {
        if (!controller.signal.aborted) setAuth({ status: "denied" });
      });
    return () => controller.abort();
  }, []);
  return (
    <ToastProvider>
      {auth.status === "loading" ? (
        <div className="workflow-loading" role="status">
          Checking access…
        </div>
      ) : auth.status === "denied" ? (
        <LoggedOutView />
      ) : (
        <DriftView user={auth.user} />
      )}
    </ToastProvider>
  );
}

function DriftView({ user }: { user: User }) {
  const [overview, setOverview] = useState<DriftOverview | null>(null);
  const [agentId, setAgentId] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("agent"),
  );
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pendingAgent, setPendingAgent] = useState<string | null>(null);
  const handleDirty = useCallback((value: boolean) => {
    setDirty(value);
    if (!value) setPendingAgent(null);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetchOverview(controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setOverview(data);
        setError(null);
        setAgentId((current) =>
          data.agents.some((agent) => agent.agent_id === current)
            ? current
            : (data.agents.find((agent) => agent.agent_id === "photon")
                ?.agent_id ??
              data.agents[0]?.agent_id ??
              null),
        );
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : "Workflows could not load.",
          );
      });
    return () => controller.abort();
  }, [refresh]);
  function switchAgent(id: string) {
    if (id === agentId) return;
    if (dirty) {
      setPendingAgent(id);
      return;
    }
    changeAgent(id);
  }
  function changeAgent(id: string) {
    setAgentId(id);
    setPendingAgent(null);
    setDirty(false);
    const url = new URL(window.location.href);
    url.searchParams.set("agent", id);
    window.history.replaceState(null, "", url);
  }
  async function logout() {
    await fetch("/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = "/";
  }
  return (
    <>
      {user.impersonating && <ImpersonationBanner email={user.email} />}
      <AppShell
        active="admin-drift"
        mode="admin"
        identity={{
          name: user.name || user.email,
          workspace: "Admin workspace",
          avatarUrl: user.avatar_url ?? undefined,
        }}
        onLogout={logout}
        adminControl={<AdminPanelControls inAdminPanel />}
      >
        <div className="drift-workspace">
          <header className="drift-heading">
            <div>
              <h1>Drift script</h1>
              <p>
                See how prompts become a demo. Refine the script by editing its
                output.
              </p>
            </div>
            {overview && (
              <label className="workflow-agent-picker">
                Agent
                <select
                  aria-label="Agent"
                  value={agentId ?? ""}
                  onChange={(event) => switchAgent(event.target.value)}
                >
                  {overview.agents.map((agent) => (
                    <option key={agent.agent_id} value={agent.agent_id}>
                      {agent.agent_id}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </header>
          {pendingAgent && (
            <div className="workflow-notice" role="alert">
              <p>
                Switching agents resets this local example, including your
                unsaved clip edits.
              </p>
              <div className="workflow-save-actions">
                <button
                  className="workflow-button"
                  onClick={() => setPendingAgent(null)}
                >
                  Keep editing
                </button>
                <button
                  className="workflow-button"
                  onClick={() => {
                    changeAgent(pendingAgent);
                  }}
                >
                  Discard and switch
                </button>
              </div>
            </div>
          )}
          {error ? (
            <div className="workflow-empty" role="alert">
              <p>{error}</p>
              <button
                className="workflow-button"
                onClick={() => setRefresh((value) => value + 1)}
              >
                Try again
              </button>
            </div>
          ) : !overview ? (
            <WorkflowSkeleton />
          ) : agentId ? (
            <AgentWorkspace
              key={agentId}
              agentId={agentId}
              overview={overview}
              onDirty={handleDirty}
            />
          ) : (
            <div className="workflow-empty">
              <h2>No agents yet</h2>
              <p>Workflows will appear when an agent is connected.</p>
            </div>
          )}
        </div>
      </AppShell>
    </>
  );
}

function AgentWorkspace({
  agentId,
  overview,
  onDirty,
}: {
  agentId: string;
  overview: DriftOverview;
  onDirty: (dirty: boolean) => void;
}) {
  const [runs, setRuns] = useState<DriftRun[] | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [view, setView] = useState("plan");
  const [refresh, setRefresh] = useState(0);
  const [limit, setLimit] = useState(25);
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetchAgentRuns(agentId, limit, controller.signal)
        .then((data) => {
          if (!controller.signal.aborted) {
            setRuns(data.runs);
            setRunError(null);
          }
        })
        .catch((reason) => {
          if (!controller.signal.aborted)
            setRunError(
              reason instanceof Error
                ? reason.message
                : "Run history could not load.",
            );
        });
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [agentId, limit, refresh]);
  return (
    <>
      <div
        className="workflow-tabs"
        role="tablist"
        aria-label="Workflow views"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? "plan"
              : event.key === "End"
                ? "runs"
                : view === "plan"
                  ? "runs"
                  : "plan";
          setView(next);
          document
            .getElementById(next === "plan" ? "plan-tab" : "runs-tab")
            ?.focus();
        }}
      >
        <button
          id="plan-tab"
          role="tab"
          tabIndex={view === "plan" ? 0 : -1}
          aria-selected={view === "plan"}
          aria-controls="workflow-plan-panel"
          onClick={() => setView("plan")}
        >
          Visualize script
        </button>
        <button
          id="runs-tab"
          role="tab"
          tabIndex={view === "runs" ? 0 : -1}
          aria-selected={view === "runs"}
          aria-controls="workflow-runs-panel"
          onClick={() => setView("runs")}
        >
          Run history
        </button>
      </div>
      <div
        id="workflow-plan-panel"
        role="tabpanel"
        aria-labelledby="plan-tab"
        hidden={view !== "plan"}
      >
        {agentId === "photon" ? (
          <ScriptStudio onDirty={onDirty} active={view === "plan"} />
        ) : (
          <div className="workflow-empty">
            <h2>The visual prototype starts with Photon</h2>
            <p>
              Choose Photon above to explore the prompt sequence and edit a
              sample clip.
            </p>
            <button className="workflow-button" onClick={() => setView("runs")}>
              View run history
            </button>
          </div>
        )}
      </div>
      <div
        id="workflow-runs-panel"
        role="tabpanel"
        aria-labelledby="runs-tab"
        hidden={view !== "runs"}
      >
        {runError ? (
          <div className="workflow-empty" role="alert">
            <p>{runError}</p>
            <button
              className="workflow-button"
              onClick={() => setRefresh((value) => value + 1)}
            >
              Try again
            </button>
          </div>
        ) : runs === null ? (
          <WorkflowSkeleton />
        ) : (
          <>
            <div className="workflow-history-heading">
              <span>
                Latest {runs.length} {runs.length === 1 ? "run" : "runs"}
              </span>
              <label>
                Show
                <select
                  value={limit}
                  onChange={(event) => setLimit(Number(event.target.value))}
                >
                  <option value={25}>25 runs</option>
                  <option value={50}>50 runs</option>
                  <option value={100}>100 runs</option>
                </select>
              </label>
            </div>
            <RunExplorer runs={runs} flows={overview.flows} />
          </>
        )}
      </div>
    </>
  );
}

function WorkflowSkeleton() {
  return (
    <div
      className="workflow-skeleton"
      role="status"
      aria-label="Loading workflow"
    >
      <div />
      <div className="workflow-skeleton-columns">
        <div>
          {[1, 2, 3, 4, 5, 6].map((id) => (
            <span key={id} />
          ))}
        </div>
        <div />
      </div>
    </div>
  );
}
