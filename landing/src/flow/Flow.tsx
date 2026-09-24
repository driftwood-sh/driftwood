import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { EmailPreview } from "../EmailPreview";
import { getPolicy } from "../approvals/api";
import type { ApprovalPolicy } from "../approvals/model";
import { listAudiences } from "../audiences/api";
import type { AudienceSummary } from "../audiences/model";
import { useToast } from "../dashboard-shared";
import { useWorkspacePermissions } from "../dashboard/workspace-permissions-context";
import { listDemos, type Demo } from "../demos/api";
import { demosNavCount } from "../demos/nav-count";
import { holdAllSends, resumeAllSends } from "../demos/staging-api";
import type { SendRow } from "../demos/staging-model";
import { withMockMode } from "../mock-mode";
import { getSettings } from "../settings/api";
import { loadUpcoming, removeFromQueue, type UpcomingSends } from "./api";
import {
  channelName,
  dayKey,
  groupByDay,
  isPaused,
  nextDay,
  people,
  removedMessage,
  sendDemoSlug,
  sendTime,
  type FlowDay,
} from "./flow-model";
import "./flow.css";

/* The workspace's one daily flow, in the order it runs: who we reach, the
   demo made for each of them, the email that carries it, and the queue it
   waits in. The first three are read-only summaries that link to the page
   that edits them; the queue is edited here, because "who goes out next" is
   the question this page exists to answer. */

type Load<T> = { status: "loading" } | { status: "error" } | { status: "ready"; data: T };

const DAYS_SHOWN = 3;
const ARM_MS = 5000;
/* A second press inside this window of arming is a double click, not a
   decision (the Demos page rule). */
const ARM_GUARD_MS = 400;

function now(): number {
  return Date.now();
}

export default function Flow() {
  const { canWrite } = useWorkspacePermissions();
  const toast = useToast();
  const [audiences, setAudiences] = useState<Load<AudienceSummary[]>>({ status: "loading" });
  const [demos, setDemos] = useState<Load<{ total: number; latest: Demo | null }>>({ status: "loading" });
  const [policy, setPolicy] = useState<Load<ApprovalPolicy>>({ status: "loading" });
  const [waiting, setWaiting] = useState<number | null>(null);
  const [queue, setQueue] = useState<Load<UpcomingSends & { tz: string | null }>>({ status: "loading" });
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [armed, setArmed] = useState<{ key: string; at: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const previewRef = useRef<HTMLElement>(null);

  const loadQueue = useCallback(async () => {
    try {
      /* The zone decides which day a send falls on, so it lands first. A
         workspace whose settings do not load reads in the browser's zone. */
      const tz = await getSettings().then((page) => page.send_schedule.tz || null, () => null);
      const upcoming = await loadUpcoming((send) => dayKey(new Date(send.due_at), tz));
      setQueue({ status: "ready", data: { ...upcoming, tz } });
    } catch {
      setQueue((prev) => (prev.status === "ready" ? prev : { status: "error" }));
    }
  }, []);

  useEffect(() => {
    let live = true;
    listAudiences().then(
      (rows) => live && setAudiences({ status: "ready", data: rows }),
      () => live && setAudiences({ status: "error" }),
    );
    const controller = new AbortController();
    listDemos("", 0, controller.signal).then(
      (page) => live && setDemos({ status: "ready", data: { total: page.total, latest: page.demos[0] ?? null } }),
      () => live && setDemos({ status: "error" }),
    );
    getPolicy(controller.signal).then(
      (loaded) => {
        if (!live) return;
        setPolicy({ status: "ready", data: loaded });
        /* Only a team that approves its own outreach has anything waiting
           on it; on auto approval the count is not asked for at all. It is
           the Demos badge's number, so the two never disagree. */
        if (loaded.mode === "auto") return;
        demosNavCount().then(
          (count) => live && setWaiting(count),
          () => {},
        );
      },
      () => live && setPolicy({ status: "error" }),
    );
    void (async () => {
      await loadQueue();
    })();
    return () => {
      live = false;
      controller.abort();
    };
  }, [loadQueue]);

  /* An armed control disarms itself after a beat, and Escape disarms it on
     purpose (ux-principles rule 9). */
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(null), ARM_MS);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setArmed(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [armed]);

  function armOrRun(key: string, run: () => void) {
    if (!armed || armed.key !== key) {
      setArmed({ key, at: now() });
      return;
    }
    if (now() - armed.at < ARM_GUARD_MS) return;
    setArmed(null);
    run();
  }

  const tz = queue.status === "ready" ? queue.data.tz : null;
  const days: FlowDay[] = queue.status === "ready" ? groupByDay(queue.data.sends, tz) : [];
  const shownDays = days.slice(0, DAYS_SHOWN);
  const day = shownDays.find((candidate) => candidate.key === pickedDay) ?? nextDay(shownDays, tz);
  const rows = day?.sends ?? [];
  /* Until someone is chosen, the preview shows the day's first email: it is
     the one that carries a demo, which is the whole flow in one place. */
  const selected =
    rows.find((send) => send.id === selectedId) ??
    rows.find((send) => send.kind === "email") ??
    rows[0] ??
    null;
  const shownCount = shownDays.reduce((sum, candidate) => sum + candidate.sends.length, 0);
  const later = queue.status === "ready" ? Math.max(0, queue.data.upcoming - shownCount) : 0;
  const everyRowPaused = queue.status === "ready" && days.length > 0 && days.every((d) => d.sends.every(isPaused));
  const pickedRows = rows.filter((send) => picked.has(send.id));

  function chooseDay(next: FlowDay) {
    setPickedDay(next.key);
    setSelectedId(null);
    setPicked(new Set());
    setArmed(null);
    setError(null);
  }

  function choose(send: SendRow) {
    setSelectedId(send.id);
    /* On a phone the preview sits under the list, so the choice has to bring
       it into view or the press looks like it did nothing. */
    if (window.matchMedia("(max-width: 900px)").matches)
      requestAnimationFrame(() => previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function togglePicked(sendId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(sendId)) next.delete(sendId);
      else next.add(sendId);
      return next;
    });
  }

  async function remove(targets: SendRow[], key: string) {
    if (targets.length === 0 || busy) return;
    setBusy(key);
    setError(null);
    try {
      const result = await removeFromQueue(targets.map((send) => send.id));
      const gone = new Set(targets.map((send) => send.id));
      /* Skipped rows already went out or changed, so they are not queued
         either way; every posted row leaves the list and the toast says
         which was which. */
      setQueue((prev) =>
        prev.status === "ready"
          ? {
              status: "ready",
              data: {
                ...prev.data,
                sends: prev.data.sends.filter((send) => !gone.has(send.id)),
                upcoming: Math.max(0, prev.data.upcoming - gone.size),
              },
            }
          : prev,
      );
      setPicked((prev) => new Set([...prev].filter((id) => !gone.has(id))));
      toast(removedMessage(result.canceled, result.skipped.length, day?.label ?? ""), "success");
    } catch (reason) {
      setError({ key, message: reason instanceof Error ? reason.message : "Couldn't remove them. Try again." });
    } finally {
      setBusy(null);
    }
  }

  async function pauseOrResume() {
    setBusy("pause");
    setError(null);
    const result = everyRowPaused ? await resumeAllSends() : await holdAllSends();
    setBusy(null);
    if (!result.ok) {
      setError({ key: "pause", message: result.missing ? "Not available yet." : result.message });
      return;
    }
    toast(everyRowPaused ? "Sends resumed." : "Sends paused.", "success");
    void loadQueue();
  }

  const nextLabel = day ? (day.label === "Today" || day.label === "Tomorrow" ? day.label.toLowerCase() : day.label) : null;

  return (
    <section className="flow-page" aria-labelledby="flow-heading">
      <header className="flow-heading">
        <h1 id="flow-heading">Flow</h1>
        <p>Who gets a demo next, and exactly what they will receive.</p>
      </header>

      <ol className="flow-steps" aria-label="How the flow runs">
        <Step
          n={1}
          title="Audience"
          load={audiences}
          value={(rows) => people(rows.reduce((sum, audience) => sum + audience.memberCount, 0))}
          sub={(rows) =>
            rows.length === 0
              ? "No audience yet"
              : rows.length <= 2
                ? rows.map((audience) => audience.name).join(", ")
                : `Across ${rows.length.toLocaleString()} audiences`
          }
          href="/dashboard/audiences"
          action={canWrite ? "Change audience" : "View audiences"}
        />
        <Step
          n={2}
          title="Demo"
          load={demos}
          value={(data) => `${data.total.toLocaleString()} ${data.total === 1 ? "demo" : "demos"} made`}
          sub={(data) => (data.latest ? `Latest for ${data.latest.company_name}` : "The first one is on its way")}
          href="/dashboard/demos"
          action="View demos"
        />
        <Step
          n={3}
          title="Email"
          load={policy}
          value={(data) =>
            data.mode === "auto"
              ? "Checked by Driftwood"
              : waiting === null
                ? "Your team approves"
                : `${waiting.toLocaleString()} waiting for you`
          }
          sub={() => "One per person, with their demo"}
          href={policy.status === "ready" && policy.data.mode !== "auto" ? "/dashboard/demos?view=approve-emails" : "/dashboard/inbox"}
          action={policy.status === "ready" && policy.data.mode !== "auto" ? "Review emails" : "See emails"}
        />
        <Step
          n={4}
          title="Queue"
          load={queue}
          value={() => (day ? `${people(day.sends.length)} ${nextLabel === "today" || nextLabel === "tomorrow" ? nextLabel : `on ${nextLabel}`}` : "Nothing queued")}
          sub={(data) => `${data.upcoming.toLocaleString()} queued in all`}
          href="#flow-queue"
          action={canWrite ? "Edit who goes out" : "See who goes out"}
          local
        />
      </ol>

      <section id="flow-queue" className="flow-queue" aria-labelledby="flow-queue-heading">
        <div className="flow-queue-head">
          <h2 id="flow-queue-heading">Going out</h2>
          {shownDays.length > 0 && (
            <div className="flow-days" role="group" aria-label="Send day">
              {shownDays.map((candidate) => (
                <button key={candidate.key} type="button" aria-pressed={candidate.key === day?.key} onClick={() => chooseDay(candidate)}>
                  {candidate.label}
                  <span>{candidate.sends.length.toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
          {canWrite && queue.status === "ready" && days.length > 0 && (
            <button
              type="button"
              className={`flow-quiet ${armed?.key === "pause" ? "is-armed" : ""}`}
              disabled={busy !== null}
              title={busy !== null ? "Working on your queue now" : undefined}
              onClick={() => armOrRun("pause", () => void pauseOrResume())}
            >
              {busy === "pause"
                ? "Working"
                : everyRowPaused
                  ? armed?.key === "pause" ? "Resume all sends? Confirm" : "Resume all sends"
                  : armed?.key === "pause" ? "Pause all sends? Confirm" : "Pause all sends"}
            </button>
          )}
        </div>
        {error?.key === "pause" && <p className="flow-error" role="alert">{error.message}</p>}

        {canWrite && pickedRows.length > 0 && (
          <div className="flow-selbar" role="region" aria-label="Selected people">
            <strong>{pickedRows.length.toLocaleString()} selected</strong>
            <button
              type="button"
              className={`flow-btn ${armed?.key === "bulk" ? "is-armed" : ""}`}
              disabled={busy !== null}
              title={busy !== null ? "Working on your queue now" : undefined}
              onClick={() => armOrRun("bulk", () => void remove(pickedRows, "bulk"))}
            >
              {busy === "bulk" ? "Removing" : armed?.key === "bulk" ? `Remove ${people(pickedRows.length)}? Confirm` : "Remove from queue"}
            </button>
            <button type="button" className="flow-quiet" onClick={() => { setPicked(new Set()); setArmed(null); }}>
              Clear
            </button>
            {error?.key === "bulk" && <span className="flow-error" role="alert">{error.message}</span>}
          </div>
        )}

        {queue.status === "loading" ? (
          <QueueSkeleton />
        ) : queue.status === "error" ? (
          <div className="flow-empty" role="alert">
            <p>The queue did not load.</p>
            <button type="button" className="flow-btn" onClick={() => { setQueue({ status: "loading" }); void loadQueue(); }}>
              Try again
            </button>
          </div>
        ) : !day ? (
          <div className="flow-empty">
            <p>Nothing is queued yet. New emails land here once demos are made for your audience.</p>
            <a className="flow-btn" href={withMockMode("/dashboard/audiences")}>Open audiences</a>
          </div>
        ) : (
          <div className="flow-queue-body">
            <ul className="flow-list" aria-label={`Going out ${nextLabel}`}>
              {rows.map((send) => {
                const name = send.lead?.name ?? "Not named yet";
                const rowKey = `row:${send.id}`;
                const isSelected = selected?.id === send.id;
                return (
                  <li key={send.id} className={`${isSelected ? "is-selected" : ""} ${picked.has(send.id) ? "is-picked" : ""}`.trim()}>
                    {canWrite && (
                      <input
                        type="checkbox"
                        className="flow-check"
                        checked={picked.has(send.id)}
                        onChange={() => togglePicked(send.id)}
                        aria-label={`Select ${name}`}
                      />
                    )}
                    <button type="button" className="flow-row" aria-pressed={isSelected} onClick={() => choose(send)}>
                      <strong>{name}</strong>
                      <span>{[send.lead?.title, send.lead?.company].filter(Boolean).join(" · ") || "Company unavailable"}</span>
                    </button>
                    <span className="flow-row-when">
                      {isPaused(send) ? "Paused" : sendTime(send, tz)}
                      <small>{channelName(send.kind)}</small>
                    </span>
                    {canWrite && (
                      <button
                        type="button"
                        className={`flow-quiet flow-row-remove ${armed?.key === rowKey ? "is-armed" : ""}`}
                        disabled={busy !== null}
                        title={busy !== null ? "Working on your queue now" : undefined}
                        aria-label={armed?.key === rowKey ? `Confirm removing ${name}` : `Remove ${name} from the queue`}
                        onClick={() => armOrRun(rowKey, () => void remove([send], rowKey))}
                      >
                        {busy === rowKey ? "Removing" : armed?.key === rowKey ? "Remove? Confirm" : "Remove"}
                      </button>
                    )}
                    {error?.key === rowKey && <p className="flow-error flow-row-error" role="alert">{error.message}</p>}
                  </li>
                );
              })}
            </ul>
            {selected && <Preview ref={previewRef} send={selected} dayLabel={day.label} tz={tz} />}
          </div>
        )}
        {queue.status === "ready" && later > 0 && (
          <p className="flow-later">
            {later.toLocaleString()} more {later === 1 ? "is" : "are"} queued after {shownDays[shownDays.length - 1]?.label ?? "these days"}.{" "}
            <a href={withMockMode("/dashboard/inbox")}>See every queued message</a>
          </p>
        )}
      </section>
    </section>
  );
}

function Step<T>({
  n,
  title,
  load,
  value,
  sub,
  href,
  action,
  local = false,
}: {
  n: number;
  title: string;
  load: Load<T>;
  value: (data: T) => string;
  sub: (data: T) => string;
  href: string;
  action: string;
  /* An anchor on this page, which mock mode must not rewrite. */
  local?: boolean;
}) {
  return (
    <li className="flow-step">
      <div className="flow-step-head">
        <span className="flow-step-n" aria-hidden="true">{n}</span>
        <h2>{title}</h2>
      </div>
      {load.status === "loading" ? (
        <div role="status" aria-label={`Loading ${title.toLowerCase()}`}>
          <span className="flow-skel flow-skel-value" />
          <span className="flow-skel flow-skel-sub" />
        </div>
      ) : load.status === "error" ? (
        <p className="flow-step-sub" role="alert">Unavailable right now</p>
      ) : (
        <>
          <p className="flow-step-value">{value(load.data)}</p>
          <p className="flow-step-sub">{sub(load.data)}</p>
        </>
      )}
      <a className="flow-step-link" href={local ? href : withMockMode(href)}>{action}</a>
    </li>
  );
}

/* One person's whole flow: who they are, the demo made for them, and the
   email that carries it, exactly as it will go out. */
function Preview({
  ref,
  send,
  dayLabel,
  tz,
}: {
  ref: RefObject<HTMLElement | null>;
  send: SendRow;
  dayLabel: string;
  tz: string | null;
}) {
  const lead = send.lead;
  const slug = sendDemoSlug(send);
  const name = lead?.name ?? "Not named yet";
  return (
    <aside ref={ref} className="flow-preview" aria-label={`What ${name} receives`}>
      <header>
        <strong>{name}</strong>
        <span>{[lead?.title, lead?.company].filter(Boolean).join(" · ")}</span>
        <span>
          {dayLabel} · {isPaused(send) ? "Paused" : sendTime(send, tz)} · {channelName(send.kind)}
          {lead?.email && send.kind === "email" ? ` to ${lead.email}` : ""}
        </span>
      </header>
      {slug && (
        <div className="flow-preview-part">
          <h3>Their demo</h3>
          <DemoClip key={slug} href={`/d/${slug}`} label={name} />
        </div>
      )}
      <div className="flow-preview-part">
        <h3>{send.kind === "email" ? "Their email" : "Their message"}</h3>
        {send.kind === "email" ? (
          <EmailPreview subject={send.subject} body={send.note} />
        ) : (
          <p className="flow-note">{send.note}</p>
        )}
      </div>
    </aside>
  );
}

/* The clip plays in place; one that will not load keeps its frame and opens
   in a tab instead of turning into an error message. */
function DemoClip({ href, label }: { href: string; label: string }) {
  const [failed, setFailed] = useState(false);
  if (failed)
    return (
      <a className="flow-clip flow-clip-out" href={href} target="_blank" rel="noopener noreferrer">
        Open the demo in a new tab
      </a>
    );
  return (
    <video
      className="flow-clip"
      controls
      playsInline
      preload="metadata"
      src={href}
      aria-label={`Demo for ${label}`}
      onError={() => setFailed(true)}
    />
  );
}

function QueueSkeleton() {
  return (
    <div className="flow-queue-body" role="status" aria-label="Loading the queue">
      <ul className="flow-list" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <li key={index} className="flow-skel-row">
            <span className="flow-skel flow-skel-name" />
            <span className="flow-skel flow-skel-time" />
          </li>
        ))}
      </ul>
      <div className="flow-preview flow-skel-preview" aria-hidden="true">
        <span className="flow-skel flow-skel-sub" />
        <span className="flow-skel flow-skel-block" />
      </div>
    </div>
  );
}
