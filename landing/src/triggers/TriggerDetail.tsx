/* /dashboard/triggers/<id>: one trigger, the line its agent wrote about
   what it watches, what it found and when it last checked. Checks happen
   on the schedule; "Check now" queues one by hand and the page polls every
   5 s until the newest check settles. Pause and Resume flip the schedule.

   A trigger still being built has nothing in its tables yet, so its own
   sentence takes the readback slot and the line about the wait fills a
   card where the tables would be. A source the agent could not read does
   the same with its reason, and keeps Edit open, because changing the
   sentence is the way out. */

import { useCallback, useEffect, useRef, useState } from "react";
import { getTrigger, pauseTrigger, resumeTrigger, runTrigger, TriggerApiError } from "./api";
import TriggerForm from "./TriggerForm";
import {
  buildingLine,
  counterCell,
  foundCell,
  formatMoment,
  itemName,
  itemStatusLabel,
  itemStatusTone,
  itemTitle,
  lastCheckFact,
  readbackLine,
  rowFields,
  RUN_COLUMNS,
  runIsOpen,
  runResult,
  runTriggerLabel,
  scheduleLabel,
  shortReason,
  triggerTitle,
  triggerView,
  unsupportedLine,
  viewLabel,
  viewTone,
  type Tone,
  type Trigger,
  type TriggerActions,
  type TriggerDetail as TriggerDetailData,
  type TriggerItem,
  type TriggerRun,
} from "./model";
import { TriggerIcon } from "../dashboard/icons";
import { useWorkspacePermissions } from "../dashboard/workspace-permissions-context";
import { prefetch, useToast } from "../dashboard-shared";
import { withMockMode } from "../mock-mode";
import "../audiences/audiences.css";
import "../campaigns/campaigns.css";
import "./triggers.css";

const POLL_MS = 5000;

/* The detail fetch starts at module eval off the URL, in parallel with
   WorkspacePage's /auth/me; the first load consumes it exactly once. */
const bootId =
  typeof window === "undefined"
    ? null
    : window.location.pathname.match(/^\/dashboard\/triggers\/([^/]+)/)?.[1] ?? null;
const initialDetail = bootId && bootId !== "new" ? prefetch(() => getTrigger(decodeURIComponent(bootId))) : null;

function takeCreatedFlag(): boolean {
  if (typeof window === "undefined") return false;
  const url = new URL(window.location.href);
  if (url.searchParams.get("created") !== "1") return false;
  url.searchParams.delete("created");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  return true;
}

type State =
  | { status: "loading" }
  | { status: "error"; message: string; notFound: boolean }
  | { status: "ready"; detail: TriggerDetailData };

type Pending = "run" | "pause" | "resume" | null;

/* The one chip. The tone is shared with the trigger's own state and the
   check result, so all three read as one language (triggers.css). */
function Chip({ tone, children }: { tone: Tone; children: string }) {
  return <span className={`trigger-chip trigger-tone-${tone}`}>{children}</span>;
}

function StatusChip({ trigger }: { trigger: Trigger }) {
  const view = triggerView(trigger);
  return <span className={`campaign-status trigger-status trigger-tone-${viewTone(view)}`}>{viewLabel(view)}</span>;
}

/* A row is: when it went up, who it is about, what it is, where it stands
   and where to read it. The two extra facts under the title come from
   whatever the item carried, so a funding round and a job both fit. The
   status names what done looks like for this trigger, which is why the
   trigger's actions come along. Only a dismissed row explains itself,
   short, with the whole sentence on hover. */
function ItemRow({ item, actions }: { item: TriggerItem; actions: TriggerActions }) {
  const title = itemTitle(item);
  const name = itemName(item);
  const fields = rowFields(item);
  const reason = item.status === "dismissed" ? shortReason(item.note) : null;
  const when = foundCell(item);
  return (
    <tr>
      <td className="trigger-num">
        {when.day}
        {/* The source never dated this one, so the date is ours; saying so
            is what keeps the column a column of bare dates. */}
        {when.undated && <span className="trigger-sub">Undated</span>}
      </td>
      <td>
        <strong className="trigger-cell-strong trigger-clamp" title={item.entityName || undefined}>{name || "—"}</strong>
      </td>
      <td>
        <span className="trigger-clamp" title={item.title || undefined}>{title || "—"}</span>
        {fields.length > 0 && (
          <span className="trigger-sub">
            {fields.map((field) => `${field.label}: ${field.value}`).join(" · ")}
          </span>
        )}
        {reason && <span className="trigger-sub" title={item.note ?? undefined}>{reason}</span>}
      </td>
      <td><Chip tone={itemStatusTone(item.status)}>{itemStatusLabel(item.status, actions)}</Chip></td>
      <td>
        {/* The demo is the win, so it leads and carries the accent. */}
        <span className="trigger-links">
          {item.demoUrl && <a className="trigger-link trigger-link-win" href={item.demoUrl} target="_blank" rel="noopener noreferrer">Demo</a>}
          <a className="trigger-link" href={item.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a>
        </span>
      </td>
    </tr>
  );
}

/* Seen and New prefer the counters that move while a check runs and fall
   back to the item counts every row has. Seen is every listing the check
   scanned, which is why it is not called Found: the trigger's "found" is
   the smaller number it kept. A check that hit a snag and finished anyway
   reads "Done": only a failure is the customer's news. */
function RunRow({ run }: { run: TriggerRun }) {
  const result = runResult(run);
  return (
    <tr>
      <td className="trigger-num">
        {formatMoment(run.startedAt ?? run.createdAt) ?? "Unknown"}
        <span className="trigger-sub">{runTriggerLabel(run.triggeredBy)}</span>
      </td>
      <td className="trigger-num trigger-col-num">{counterCell(run.idsSeen ?? run.itemsSeen)}</td>
      <td className="trigger-num trigger-col-num">{counterCell(run.idsNew ?? run.itemsNew)}</td>
      <td>
        <Chip tone={result.tone}>{result.label}</Chip>
        {result.detail && <span className="trigger-sub" title={run.error ?? undefined}>{result.detail}</span>}
      </td>
    </tr>
  );
}

function SkeletonRows({ columns, rows }: { columns: number; rows: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr className="trigger-table-skeleton" key={row} aria-hidden="true">
          {Array.from({ length: columns }, (_, column) => (
            <td key={column}><span className="campaign-skel campaign-skel-line" /></td>
          ))}
        </tr>
      ))}
    </>
  );
}

export default function TriggerDetail({ triggerId }: { triggerId: string }) {
  const { canWrite } = useWorkspacePermissions();
  const toast = useToast();
  const [state, setState] = useState<State>({ status: "loading" });
  const [pending, setPending] = useState<Pending>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async (initial?: Promise<TriggerDetailData> | null) => {
    try {
      setState({ status: "ready", detail: await (initial ?? getTrigger(triggerId)) });
    } catch (reason) {
      setState((prev) => {
        // A poll that fails keeps the page it already painted.
        if (prev.status === "ready") return prev;
        /* A 422 is an id the API cannot even look up (not a UUID). A trigger
           that cannot exist does not exist, so it reads like a 404 rather than
           an outage with a "Try again" that can never help. */
        const notFound =
          reason instanceof TriggerApiError && (reason.status === 404 || reason.status === 422);
        return {
          status: "error",
          notFound,
          message: notFound
            ? "This trigger does not exist, or it belongs to another workspace."
            : reason instanceof Error && reason.message
              ? reason.message
              : "Check your connection and try again.",
        };
      });
    }
  }, [triggerId]);

  useEffect(() => {
    void load(initialDetail?.take());
  }, [load]);

  /* The list page hands off here right after a create; the toast belongs on
     the page the customer lands on. The param is stripped on mount, but the
     toast waits for the first load to settle: a trigger that fails to load
     (a 404 reads "Trigger not found") was not visibly created, so the flag
     is dropped instead. */
  const createdPending = useRef(false);
  useEffect(() => {
    if (takeCreatedFlag()) createdPending.current = true;
  }, []);
  useEffect(() => {
    if (!createdPending.current || state.status === "loading") return;
    createdPending.current = false;
    if (state.status === "ready") toast("Trigger created.", "success");
  }, [state.status, toast]);

  const openRun = state.status === "ready" && runIsOpen(state.detail.runs[0]?.state);
  const building = state.status === "ready" && triggerView(state.detail.trigger) === "building";

  /* Poll while a check is queued or running, and while the agent is still
     working out how to check this (ux-principles rule 4): state lives
     server-side, so a tab switch or reload picks up where it was. */
  useEffect(() => {
    if (!openRun && !building) return;
    const timer = window.setTimeout(() => void load(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [openRun, building, state, load]);

  async function act(kind: NonNullable<Pending>) {
    if (pending || state.status !== "ready") return;
    setPending(kind);
    setActionError(null);
    try {
      if (kind === "run") {
        await runTrigger(triggerId);
        await load();
      } else {
        const trigger = kind === "pause" ? await pauseTrigger(triggerId) : await resumeTrigger(triggerId);
        setState((prev) => (prev.status === "ready" ? { status: "ready", detail: { ...prev.detail, trigger } } : prev));
        toast(kind === "pause" ? "Trigger paused." : "Trigger resumed.", "success");
      }
    } catch (reason) {
      const code = reason instanceof TriggerApiError ? reason.code : null;
      if (kind === "run" && code === "run_in_progress") {
        // Someone (or the schedule) got there first: show that check.
        await load();
      }
      setActionError(
        code === "needs_setup"
          ? "Still building. Try again in a bit."
          : reason instanceof Error && reason.message
            ? reason.message
            : "Something went wrong. Try again.",
      );
    } finally {
      setPending(null);
    }
  }

  if (state.status === "error") {
    return (
      <section className="audience-page trigger-page" aria-labelledby="trigger-heading">
        <a className="trigger-back" href={withMockMode("/dashboard/triggers")}><BackChevron />Triggers</a>
        <div className="audience-state trigger-empty" role="alert">
          <TriggerIcon size={24} />
          <h2 id="trigger-heading">{state.notFound ? "Trigger not found" : "This trigger is unavailable"}</h2>
          <p>{state.message}</p>
          {state.notFound ? (
            <a className="audience-secondary" href={withMockMode("/dashboard/triggers")}>Back to triggers</a>
          ) : (
            <button className="audience-secondary" type="button" onClick={() => { setState({ status: "loading" }); void load(); }}>Try again</button>
          )}
        </div>
      </section>
    );
  }

  const detail = state.status === "ready" ? state.detail : null;
  const trigger = detail?.trigger ?? null;
  const title = trigger ? triggerTitle(trigger) : null;

  /* Edit swaps the page for the box, prefilled; saving lands back here with
     the row the backend returned, which is a trigger back in Building when
     the sentence changed. */
  if (editing && trigger && canWrite) {
    return (
      <section className="audience-page trigger-page" aria-labelledby="triggers-heading">
        <a className="trigger-back" href={withMockMode(`/dashboard/triggers/${encodeURIComponent(triggerId)}`)} onClick={(event) => { event.preventDefault(); setEditing(false); }}>
          <BackChevron />{title}
        </a>
        <TriggerForm
          mode="edit"
          trigger={trigger}
          onCancel={() => setEditing(false)}
          onSaved={(saved) => {
            setState((prev) => (prev.status === "ready" ? { status: "ready", detail: { ...prev.detail, trigger: saved } } : prev));
            setEditing(false);
            toast("Trigger saved.", "success");
          }}
        />
      </section>
    );
  }

  const view = trigger ? triggerView(trigger) : null;
  const runnable = view === "active" || view === "paused";
  const runBusy = pending === "run" || openRun;
  const hasRows = Boolean(detail && (detail.items.length > 0 || detail.runs.length > 0));
  const showTables = view !== "building" && (view !== "unsupported" || hasRows);

  /* A trigger that is not running yet has two lines to show and one good
     slot for each: the customer's own sentence takes the readback, under
     the name, and the line about the wait (or the agent's reason for a
     source it could not read) moves into a card where the tables would
     be. Same strings as before, arranged so neither state is a page with
     a heading and nothing under it. */
  const stateLine =
    !trigger ? null : view === "building" ? buildingLine(trigger) : view === "unsupported" ? unsupportedLine(trigger) : null;
  const readback = !trigger ? null : stateLine ? trigger.watch?.trim() || null : readbackLine(trigger);

  return (
    <section className="audience-page trigger-page" aria-labelledby="trigger-heading" aria-busy={state.status === "loading"}>
      <a className="trigger-back" href={withMockMode("/dashboard/triggers")}><BackChevron />Triggers</a>
      {/* Name, the agent's line and the facts are one block, closed by the
          hairline this class carries. */}
      <div className="trigger-head">
        <header className="audience-heading">
          <div className="trigger-title-row">
            {trigger ? (
              <>
                <h1 id="trigger-heading">{title}</h1>
                <StatusChip trigger={trigger} />
              </>
            ) : (
              <>
                <h1 id="trigger-heading" className="audience-visually-hidden">Trigger</h1>
                <span className="campaign-skel campaign-skel-title" aria-hidden="true" />
              </>
            )}
          </div>
          {canWrite && trigger ? (
            /* All three actions live here, in two house button families
               rather than the three this page used to carry: Check now is
               the quiet one because the schedule is what normally runs a
               check (ux-principles rule 11). */
            <div className="trigger-heading-actions">
              {runnable && (
                <button
                  className="campaign-quiet-button"
                  type="button"
                  onClick={() => void act("run")}
                  disabled={runBusy || pending !== null}
                  title={openRun ? "A check is already running." : pending ? "Wait for the current action to finish" : "Runs a check now."}
                  data-testid="check-now"
                >
                  {runBusy ? "Checking…" : "Check now"}
                </button>
              )}
              {runnable && (
                <button
                  className="audience-secondary"
                  type="button"
                  onClick={() => void act(trigger.status === "paused" ? "resume" : "pause")}
                  disabled={pending !== null}
                  title={pending ? "Wait for the current action to finish" : undefined}
                >
                  {pending === "pause" ? "Pausing…" : pending === "resume" ? "Resuming…" : trigger.status === "paused" ? "Resume" : "Pause"}
                </button>
              )}
              <button
                className="audience-secondary"
                type="button"
                onClick={() => setEditing(true)}
                disabled={pending !== null}
                title={pending ? "Wait for the current action to finish" : undefined}
                data-testid="edit-trigger"
              >
                Edit
              </button>
            </div>
          ) : !canWrite && trigger ? (
            <span className="audience-read-only">Read-only access</span>
          ) : null}
        </header>

        {trigger ? (
          <>
            {readback && <p className="trigger-readback">{readback}</p>}
            {runnable && (
              <p className="trigger-meta-line">
                {scheduleLabel(trigger.schedule)}
                <span className="trigger-meta-sep" aria-hidden="true">·</span>
                {lastCheckFact(trigger, detail?.runs[0])}
                {trigger.campaignId && trigger.campaignName ? (
                  <>
                    <span className="trigger-meta-sep" aria-hidden="true">·</span>
                    {"Campaign: "}
                    <a href={withMockMode(`/dashboard/campaigns/${encodeURIComponent(trigger.campaignId)}`)}>{trigger.campaignName}</a>
                  </>
                ) : null}
              </p>
            )}
          </>
        ) : (
          <p className="trigger-readback" aria-hidden="true"><span className="campaign-skel campaign-skel-line-wide" /></p>
        )}
      </div>

      {actionError && (
        <div className="campaign-inline-error" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError(null)}>Dismiss</button>
        </div>
      )}

      {stateLine && (
        <div className="trigger-state-card">
          <div className={`trigger-state${view === "building" ? " trigger-state-working" : ""}`}>
            <TriggerIcon size={24} />
            <p role={view === "building" ? "status" : undefined}>{stateLine}</p>
          </div>
        </div>
      )}

      {showTables && (
        <>
          <section className="trigger-section" aria-labelledby="trigger-items">
            <div className="trigger-section-head">
              <h2 id="trigger-items">Found</h2>
              {detail && detail.items.length > 0 && (
                <span className="trigger-section-count">
                  {detail.trigger.counts.items > detail.items.length
                    ? `${detail.items.length.toLocaleString()} of ${detail.trigger.counts.items.toLocaleString()}`
                    : detail.items.length.toLocaleString()}
                </span>
              )}
            </div>
            <div className="trigger-table-card" aria-live="polite">
              {detail && detail.items.length === 0 ? (
                <p className="trigger-table-empty">Nothing yet. The next check runs on schedule.</p>
              ) : (
                <div className="trigger-table-wrap">
                  {/* Both tables lead with "When", so the two read as one
                      pair rather than two inventions. */}
                  <table className="trigger-table trigger-table-items">
                    <thead>
                      <tr>
                        <th scope="col">When</th>
                        <th scope="col">Name</th>
                        <th scope="col">What</th>
                        <th scope="col">Status</th>
                        <th scope="col" className="trigger-col-num"><span className="audience-visually-hidden">Links</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail
                        ? detail.items.map((item) => <ItemRow key={item.id} item={item} actions={detail.trigger.actions} />)
                        : <SkeletonRows columns={5} rows={5} />}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>

          <section className="trigger-section" aria-labelledby="trigger-runs">
            <div className="trigger-section-head">
              <h2 id="trigger-runs">Checks</h2>
              {detail && detail.runs.length > 0 && <span className="trigger-section-count">Last {detail.runs.length.toLocaleString()}</span>}
            </div>
            <div className="trigger-table-card" aria-live="polite">
              {detail && detail.runs.length === 0 ? (
                <p className="trigger-table-empty">No checks yet.</p>
              ) : (
                <div className="trigger-table-wrap">
                  <table className="trigger-table trigger-table-runs">
                    <thead>
                      <tr>
                        {/* The labels live in the model beside the cells
                            they sit over (RunRow), so the two agree. */}
                        {RUN_COLUMNS.map((column) => (
                          <th scope="col" key={column.label} className={column.numeric ? "trigger-col-num" : undefined}>{column.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {detail
                        ? detail.runs.map((run) => <RunRow key={run.id} run={run} />)
                        : <SkeletonRows columns={4} rows={3} />}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </>
      )}
      {state.status === "loading" && <p className="audience-visually-hidden" role="status">Loading trigger…</p>}
    </section>
  );
}

function BackChevron() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 5l-7 7 7 7" />
    </svg>
  );
}
