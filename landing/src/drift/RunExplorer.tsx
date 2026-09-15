import { useEffect, useState } from "react";
import { fetchRunDetail, type DriftRunDetail } from "./api";
import {
  classifyRun,
  fallbackStages,
  runDuration,
  terminalFor,
  type DriftRun,
  type FlowManifest,
} from "./model";

function subject(run: DriftRun) {
  for (const key of ["company", "company_name", "prospect_name", "slug"]) {
    const value = run.parameters[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return run.task.replaceAll("_", " ");
}

function outputLink(result: DriftRun["result"]): string | null {
  const candidate =
    result?.demo_url ?? result?.preview_url ?? result?.video_url;
  if (typeof candidate !== "string") return null;
  try {
    const url = new URL(candidate, window.location.origin);
    return url.protocol === "https:" ||
      (url.origin === window.location.origin && url.pathname.startsWith("/d/"))
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export default function RunExplorer({
  runs,
  flows,
}: {
  runs: DriftRun[];
  flows: Record<string, FlowManifest>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = runs.find((run) => run.id === selectedId) ?? runs[0];
  if (!selected)
    return (
      <div className="workflow-empty">
        <h2>No runs yet</h2>
        <p>Completed and in-progress demos will appear here.</p>
      </div>
    );
  return (
    <div className="workflow-run-layout">
      <aside className="workflow-run-list" aria-label="Recent runs">
        <h2>Recent runs</h2>
        {runs.map((run) => (
          <button
            className={`workflow-run-row ${selected.id === run.id ? "is-selected" : ""}`}
            key={run.id}
            aria-pressed={selected.id === run.id}
            onClick={() => setSelectedId(run.id)}
          >
            <strong>{subject(run)}</strong>
            <span>{terminalFor(run, flows[run.task] ?? null).label}</span>
            <small>
              {new Date(run.created_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </small>
          </button>
        ))}
      </aside>
      <RunTrace
        key={selected.id}
        run={selected}
        manifest={flows[selected.task] ?? null}
      />
    </div>
  );
}

function RunTrace({
  run,
  manifest,
}: {
  run: DriftRun;
  manifest: FlowManifest | null;
}) {
  const [detail, setDetail] = useState<DriftRunDetail | null>(null);
  const [error, setError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const load = () =>
      fetchRunDetail(run.id, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setDetail(result);
            setError(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setError(true);
        });
    void load();
    const timer = ["queued", "launching", "running"].includes(run.state)
      ? setInterval(() => {
          void load();
        }, 15000)
      : null;
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [run.id, run.state, refresh]);
  const current = detail ?? run;
  const stages = manifest
    ? classifyRun(current, manifest)
    : fallbackStages(current);
  const selected =
    stages.find((item) => item.stage.id === selectedStage) ??
    stages.find((item) => item.status === "failed") ??
    stages[0];
  const labels = new Set(selected?.rows.map((item) => item.label));
  const judgments =
    detail?.judgments.filter(
      (item) => labels.has(item.label) && item.passed !== null,
    ) ?? [];
  const link = outputLink(current.result);
  const terminal = terminalFor(current, manifest);
  return (
    <section className="workflow-run-trace" aria-label="Run progress">
      <header className="workflow-plan-heading">
        <div>
          <span className="workflow-eyebrow">
            {current.task.replaceAll("_", " ")}
          </span>
          <h2>{subject(current)}</h2>
          <p>
            {terminal.label}
            {runDuration(current) ? ` · ${runDuration(current)}` : ""}
          </p>
        </div>
        {link && (
          <a
            className="workflow-button"
            href={link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open demo ↗
          </a>
        )}
      </header>
      {!manifest && (
        <p className="workflow-notice">
          This workflow has no process map yet. These steps show recorded
          activity only.
        </p>
      )}
      {error && (
        <p className="workflow-notice" role="alert">
          Run details could not refresh.{" "}
          <button
            className="workflow-button is-quiet"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Try again
          </button>
        </p>
      )}
      <div className="workflow-editor">
        <div className="workflow-map">
          <ol className="workflow-steps">
            {stages.map((item, index) => {
              const state =
                item.status === "unreached"
                  ? "Not recorded"
                  : item.stage.gate && item.judgeCount === 0
                    ? "Awaiting review"
                    : item.status === "passed"
                      ? "Passed"
                      : item.status === "retried"
                        ? "Passed after correction"
                        : item.status === "failed"
                          ? "Needs attention"
                          : "Completed";
              return (
                <li key={item.stage.id}>
                  <button
                    className={`workflow-step ${selected?.stage.id === item.stage.id ? "is-selected" : ""}`}
                    aria-pressed={selected?.stage.id === item.stage.id}
                    onClick={() => setSelectedStage(item.stage.id)}
                  >
                    <span className="workflow-step-number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="workflow-step-copy">
                      <strong>{item.stage.name}</strong>
                      <span>{item.stage.sub ?? ""}</span>
                    </span>
                    <span
                      className={`workflow-step-meta ${item.status === "failed" ? "needs-attention" : ""}`}
                    >
                      {state}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {stages.length === 0 && (
            <p className="workflow-empty">
              Waiting for the first recorded step.
            </p>
          )}
        </div>
        {selected && (
          <aside className="workflow-inspector">
            <span className="workflow-eyebrow">Step detail</span>
            <h3>{selected.stage.name}</h3>
            <p>{selected.stage.sub}</p>
            {!detail && !error && <p role="status">Loading review details…</p>}
            {detail && judgments.length === 0 && (
              <p className="workflow-fixed">
                No review result recorded for this step.
              </p>
            )}
            {judgments.map((judgment, index) => (
              <div
                className="workflow-check"
                key={`${judgment.label}:${index}`}
              >
                <strong>
                  {judgment.passed ? "Review passed" : "Changes requested"}
                  {judgments.length > 1 ? ` · Attempt ${index + 1}` : ""}
                </strong>
                {Array.isArray(judgment.detail?.rows) && (
                  <ul>
                    {judgment.detail.rows.slice(0, 30).map((value, i) => {
                      if (!value || typeof value !== "object") return null;
                      const row = value as Record<string, unknown>;
                      return (
                        <li key={i}>
                          <span>
                            {typeof row.criterion === "string"
                              ? row.criterion.replaceAll("_", " ")
                              : "Check"}
                          </span>
                          <span>
                            {typeof row.score === "string" ||
                            typeof row.score === "number"
                              ? row.score
                              : row.verdict === "pass"
                                ? "Pass"
                                : "Needs review"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ))}
          </aside>
        )}
      </div>
    </section>
  );
}
