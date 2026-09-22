/* The Send schedule view of Settings: one card (days, one daily window, a
   timezone, US federal holidays). Settings.tsx renders the page heading and
   the tab strip above it, inside WorkspacePage. An owner and an admin can
   save; a member sees the same card with every control disabled and no Save
   button. The page frame, card, hint and pill come from team.css and the
   field controls from campaigns.css, so nothing here is a new control
   style. */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { CARD, prefetch, useToast } from "../dashboard-shared";
import { useWorkspacePermissions } from "../dashboard/workspace-permissions-context";
import { getSettings, saveSendSchedule, type SendSchedule, type SettingsPage } from "./api";
import {
  browserTimezone,
  capsLine,
  DAY_LABELS,
  DAY_NAMES,
  formatNextOpen,
  formatTime12,
  holidayLine,
  isDirty,
  savedNote,
  timeOptions,
  timezoneOptions,
  tzAbbreviation,
  validateDraft,
} from "./model";
import "../team/team.css";
import "../campaigns/campaigns.css";
import "./settings.css";

/* The settings fetch starts at module eval (chunk load), in parallel with
   WorkspacePage's /auth/me. The first load consumes it exactly once (see
   prefetch() in dashboard-shared); retries fetch fresh. */
const initialSettings = prefetch(() => getSettings());

/* What the card shows, disabled, before the page lands: the backend's
   default. The real layout paints on first render and nothing jumps. */
const PLACEHOLDER: SendSchedule = {
  days: [0, 1, 2, 3, 4],
  start: "09:00",
  end: "18:00",
  tz: "America/Los_Angeles",
  skip_us_holidays: true,
};

const TIME_OPTIONS = timeOptions();
const BROWSER_TZ = browserTimezone();

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; page: SettingsPage };

/* Where a save's outcome renders: beside the button, not in a toast that
   floats away. A success names what moved; a failure shows the server's
   plain message. */
type Note = { tone: "ok" | "error"; message: string } | null;

export default function Settings() {
  const [state, setState] = useState<State>({ status: "loading" });
  const [draft, setDraft] = useState<SendSchedule>(PLACEHOLDER);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<Note>(null);
  /* Bumped by Retry; the load effect runs again and fetches fresh. */
  const [attempt, setAttempt] = useState(0);
  const toast = useToast();
  /* One rule for the whole dashboard: an owner and an admin write, a member
     does not. WorkspacePage supplies it from /auth/me. */
  const { canWrite } = useWorkspacePermissions();

  /* The first run consumes the module-eval prefetch; a retry (or React's
     dev-mode second run) fetches fresh. State lands only in the callbacks,
     guarded so an unmounted page never sets it. */
  useEffect(() => {
    let current = true;
    (initialSettings.take() ?? getSettings()).then(
      (page) => {
        if (!current) return;
        setState({ status: "ready", page });
        setDraft(page.send_schedule);
      },
      (reason: unknown) => {
        if (!current) return;
        setState({
          status: "error",
          message:
            reason instanceof Error && reason.message
              ? reason.message
              : "The request never made it. Check your connection.",
        });
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);

  const page = state.status === "ready" ? state.page : null;
  const saved = page?.send_schedule ?? null;
  const dirty = saved !== null && isDirty(saved, draft);
  const problem = validateDraft(draft);
  const editable = canWrite && page !== null && !saving;
  const zones = useMemo(() => timezoneOptions(draft.tz), [draft.tz]);

  function update(patch: Partial<SendSchedule>) {
    setDraft((prev) => ({ ...prev, ...patch }));
    setNote(null);
  }

  function toggleDay(day: number) {
    setDraft((prev) => ({
      ...prev,
      days: prev.days.includes(day)
        ? prev.days.filter((d) => d !== day)
        : [...prev.days, day].sort((a, b) => a - b),
    }));
    setNote(null);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!editable || !dirty || problem) return;
    setSaving(true);
    setNote(null);
    try {
      const next = await saveSendSchedule(draft);
      setState({ status: "ready", page: next });
      setDraft(next.send_schedule);
      setNote({ tone: "ok", message: savedNote(next.moved_sends) });
      toast("Schedule saved", "success");
    } catch (reason) {
      const message =
        reason instanceof Error && reason.message ? reason.message : "Something went wrong. Try again.";
      setNote({ tone: "error", message });
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  /* The status line reads from the saved schedule and the server's
     next_open_at, never from the unsaved draft. */
  let statusLine: string | null = null;
  if (state.status === "loading") {
    statusLine = "Loading…";
  } else if (page && saved) {
    if (page.window_open_now) {
      statusLine = `Sending now, until ${formatTime12(saved.end)} ${tzAbbreviation(saved.tz)}.`;
    } else {
      const next = formatNextOpen(page.next_open_at, saved.tz);
      statusLine = next ? `Next send window: ${next}.` : null;
    }
  }

  const holidayText = draft.skip_us_holidays
    ? holidayLine(page?.upcoming_holidays ?? [])
    : "Sends on holidays too.";

  const saveTitle = saving
    ? "Saving…"
    : state.status === "loading"
      ? "Loading…"
      : !dirty
        ? "Nothing changed"
        : (problem ?? undefined);

  return (
    <section className="team-page" aria-labelledby="settings-heading">
      {state.status === "error" ? (
        <div className={`${CARD} team-error`} role="alert">
          <p className="team-error-lead">Could not load settings.</p>
          <p className="team-error-detail">{state.message}</p>
          <button
            type="button"
            onClick={() => {
              setState({ status: "loading" });
              setAttempt((n) => n + 1);
            }}
          >
            Retry
          </button>
        </div>
      ) : (
        <form className={`${CARD} team-invite settings-card`} aria-labelledby="schedule-heading" onSubmit={handleSave}>
          <h2 id="schedule-heading">Send schedule</h2>
          <p className="team-hint">
            {canWrite
              ? "When your approved emails, LinkedIn messages and X DMs go out. Daily caps still apply."
              : "Only owners and admins can change this."}
          </p>

          <div className="campaign-field" role="group" aria-labelledby="settings-days-label">
            <span id="settings-days-label">Days</span>
            <div className="settings-days">
              {DAY_LABELS.map((label, day) => (
                <button
                  key={label}
                  type="button"
                  className="settings-day"
                  aria-pressed={draft.days.includes(day)}
                  aria-label={DAY_NAMES[day]}
                  disabled={!editable}
                  onClick={() => toggleDay(day)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="settings-field-row">
            <div className="campaign-field" role="group" aria-labelledby="settings-hours-label">
              <span id="settings-hours-label">Hours</span>
              <div className="settings-hours">
                <select
                  aria-label="Window opens"
                  value={draft.start}
                  disabled={!editable}
                  onChange={(e) => update({ start: e.target.value })}
                >
                  {TIME_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <span>to</span>
                <select
                  aria-label="Window closes"
                  value={draft.end}
                  disabled={!editable}
                  onChange={(e) => update({ end: e.target.value })}
                >
                  {TIME_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="campaign-field">
              <span id="settings-tz-label">Timezone</span>
              <select
                aria-labelledby="settings-tz-label"
                value={draft.tz}
                disabled={!editable}
                onChange={(e) => update({ tz: e.target.value })}
              >
                <optgroup label="Common">
                  {zones.common.map((zone) => (
                    <option key={zone.value} value={zone.value}>
                      {zone.label}
                    </option>
                  ))}
                </optgroup>
                {zones.all.length > 0 && (
                  <optgroup label="All time zones">
                    {zones.all.map((zone) => (
                      <option key={zone.value} value={zone.value}>
                        {zone.label}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
              {editable && BROWSER_TZ && BROWSER_TZ !== draft.tz && (
                <button type="button" className="settings-tz-use" onClick={() => update({ tz: BROWSER_TZ })}>
                  Use my time zone ({BROWSER_TZ})
                </button>
              )}
            </div>
          </div>

          <label className="campaign-check-field">
            <input
              type="checkbox"
              checked={draft.skip_us_holidays}
              disabled={!editable}
              onChange={(e) => update({ skip_us_holidays: e.target.checked })}
            />
            <span>
              <strong>Skip US federal holidays</strong>
              {holidayText && <small>{holidayText}</small>}
            </span>
          </label>

          {statusLine && (
            <p className="settings-window" role="status">
              {statusLine}
            </p>
          )}

          {canWrite && (
            <div className="team-invite-row settings-save">
              <button type="submit" disabled={!editable || !dirty || problem !== null} title={saveTitle}>
                {saving ? "Saving…" : "Save schedule"}
              </button>
              {note &&
                (note.tone === "error" ? (
                  <p className="team-inline-error" role="alert">
                    {note.message}
                  </p>
                ) : (
                  <p className="team-inline-note settings-saved" role="status">
                    {note.message}
                  </p>
                ))}
            </div>
          )}
        </form>
      )}

      {page && <p className="settings-caps">{capsLine(page.daily_caps)}</p>}
    </section>
  );
}
