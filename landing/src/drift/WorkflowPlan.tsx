import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  fetchPlans,
  savePlan,
  WorkflowError,
  type WorkflowPlan as Plan,
} from "./api";
import { CheckIcon, LockIcon } from "../assets/icons";

export default function WorkflowPlan({
  agentId,
  plan: initial,
  onDirty,
  onBusy,
}: {
  agentId: string;
  plan: Plan;
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [plan, setPlan] = useState(initial);
  const [values, setValues] = useState(() =>
    Object.fromEntries(initial.fields.map((field) => [field.id, field.value])),
  );
  const [stageId, setStageId] = useState(
    initial.stages.find((stage) => stage.id === "story")?.id ??
      initial.stages[0]?.id ??
      "",
  );
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const inspectorRef = useRef<HTMLElement>(null);
  const stepsRef = useRef<HTMLOListElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [reloadConfirmation, setReloadConfirmation] = useState(false);
  const changes = Object.fromEntries(
    plan.fields
      .filter((field) => values[field.id].trim() !== field.value)
      .map((field) => [field.id, values[field.id].trim()]),
  );
  const dirty = Object.keys(changes).length > 0;
  const stage = plan.stages.find((item) => item.id === stageId);
  const fields = plan.fields.filter((field) => field.stage_id === stageId);

  // Navigation must see the committed draft before the next browser event.
  useLayoutEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useLayoutEffect(() => {
    onBusy(saving);
  }, [saving, onBusy]);
  function selectStage(id: string) {
    setStageId(id);
    if (window.matchMedia("(max-width: 820px)").matches) {
      requestAnimationFrame(() => {
        inspectorRef.current?.focus({ preventScroll: true });
        inspectorRef.current?.scrollIntoView({ block: "start" });
      });
    }
  }
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  async function save() {
    if (!dirty || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    setSaved(null);
    try {
      const result = await savePlan(agentId, plan, changes);
      setPlan(result.plan);
      setConflict(false);
      setReloadConfirmation(false);
      setValues(
        Object.fromEntries(
          result.plan.fields.map((field) => [field.id, field.value]),
        ),
      );
      setSaved(
        result.notification_delivered
          ? "Changes saved for future demos."
          : "Changes saved. The internal team notification could not be delivered.",
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Changes could not be saved. Your draft is still here.",
      );
      setConflict(
        reason instanceof WorkflowError &&
          ["workflow_changed", "plan_unavailable"].includes(reason.code),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  async function reloadLatest() {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const result = await fetchPlans(agentId);
      const latest = result.plans.find((item) => item.task === plan.task);
      if (!latest)
        throw new Error(
          "This workflow is no longer available. Your draft is still here.",
        );
      setPlan(latest);
      setValues(
        Object.fromEntries(
          latest.fields.map((field) => [field.id, field.value]),
        ),
      );
      setError(null);
      setConflict(false);
      setReloadConfirmation(false);
      setSaved("Latest workflow loaded. Review it before making new changes.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The latest workflow could not load. Your draft is still here.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section className="workflow-plan" aria-label="Workflow plan">
      <header className="workflow-plan-heading">
        <div>
          <span className="workflow-eyebrow">Workflow plan</span>
          <h2>{plan.title}</h2>
          <p>{plan.description}</p>
        </div>
        <span className="workflow-admin">
          <LockIcon size={14} />
          Admin only
        </span>
      </header>
      {plan.unavailable_reason && (
        <p className="workflow-notice">{plan.unavailable_reason}</p>
      )}
      {plan.stages.length > 0 && (
        <>
          <div className="workflow-deliverable">
            <span>You’ll generate</span>
            <strong>{plan.output.format}</strong>
            <span>
              {plan.output.duration} · {plan.output.dimensions}
            </span>
          </div>
          <div className="workflow-editor">
            <div className="workflow-map">
              <div className="workflow-section-title">
                <h3>From company to finished demo</h3>
                <span>{plan.stages.length} steps</span>
              </div>
              <ol ref={stepsRef} className="workflow-steps">
                {plan.stages.map((item, index) => {
                  const edited = plan.fields.some(
                    (field) =>
                      field.stage_id === item.id &&
                      Object.hasOwn(changes, field.id),
                  );
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        className={`workflow-step ${stageId === item.id ? "is-selected" : ""}`}
                        aria-pressed={stageId === item.id}
                        onClick={() => selectStage(item.id)}
                      >
                        <span className="workflow-step-number">
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span className="workflow-step-copy">
                          <strong>{item.name}</strong>
                          <span>{item.output}</span>
                        </span>
                        <span className="workflow-step-meta">
                          {edited
                            ? "Edited"
                            : item.gate
                              ? "Review step"
                              : "Automatic"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
              <p className="workflow-map-note">
                Each review checks the result before the next step continues. A
                failed review can return work for correction.
              </p>
            </div>
            {stage && (
              <aside
                ref={inspectorRef}
                tabIndex={-1}
                className="workflow-inspector"
                aria-label="Step details"
              >
                <button
                  className="workflow-button is-quiet workflow-back"
                  onClick={() => {
                    const selected =
                      stepsRef.current?.querySelector<HTMLButtonElement>(
                        'button[aria-pressed="true"]',
                      );
                    selected?.focus({ preventScroll: true });
                    selected?.scrollIntoView({ block: "center" });
                  }}
                >
                  ↑ Back to all steps
                </button>
                <span className="workflow-eyebrow">
                  Step {plan.stages.indexOf(stage) + 1} of {plan.stages.length}
                </span>
                <h3>{stage.name}</h3>
                <p>{stage.description}</p>
                <div className="workflow-step-output">
                  <span>Produces</span>
                  <strong>{stage.output}</strong>
                </div>
                {fields.length > 0 ? (
                  <div className="workflow-fields">
                    <h4>Creative direction</h4>
                    <p>Guide this step for future demos.</p>
                    {fields.map((field) => (
                      <div className="workflow-field" key={field.id}>
                        <label htmlFor={`plan-${field.id}`}>
                          {field.label}
                        </label>
                        <textarea
                          id={`plan-${field.id}`}
                          rows={field.stage_id === "artwork" ? 3 : 5}
                          value={values[field.id]}
                          placeholder={field.placeholder}
                          maxLength={field.max_length}
                          disabled={saving || !plan.editable}
                          title={
                            saving
                              ? "Saving your changes."
                              : !plan.editable
                                ? (plan.unavailable_reason ??
                                  "This workflow is read-only.")
                                : undefined
                          }
                          onChange={(event) => {
                            setValues((current) => ({
                              ...current,
                              [field.id]: event.target.value,
                            }));
                            setSaved(null);
                          }}
                        />
                        {values[field.id].length > field.max_length - 200 && (
                          <small>
                            {field.max_length - values[field.id].length}{" "}
                            characters left
                          </small>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="workflow-fixed">
                    <LockIcon size={15} />
                    This step runs automatically.
                  </p>
                )}
                {stage.id === "story" && (
                  <div className="workflow-storyboard">
                    <h4>Planned story</h4>
                    <ol>
                      <li>
                        <span>Opening</span>
                        <strong>A customer makes a request</strong>
                      </li>
                      <li>
                        <span>Choice</span>
                        <strong>Three relevant options</strong>
                      </li>
                      <li>
                        <span>Result</span>
                        <strong>A concrete outcome to react to</strong>
                      </li>
                      <li>
                        <span>Close</span>
                        <strong>Confirm the next step or purchase</strong>
                      </li>
                    </ol>
                  </div>
                )}
              </aside>
            )}
          </div>
        </>
      )}
      {error && (
        <div className="workflow-notice" role="alert">
          <p>{error}</p>
          {conflict && !reloadConfirmation && (
            <button
              className="workflow-button"
              onClick={() => setReloadConfirmation(true)}
            >
              Reload latest plan
            </button>
          )}
          {reloadConfirmation && (
            <>
              <p>
                Reloading will discard your unsaved directions. Copy any text
                you want to keep first.
              </p>
              <div className="workflow-save-actions">
                <button
                  className="workflow-button"
                  disabled={saving}
                  onClick={() => setReloadConfirmation(false)}
                >
                  Keep draft
                </button>
                <button
                  className="workflow-button"
                  disabled={saving}
                  onClick={() => {
                    void reloadLatest();
                  }}
                >
                  {saving ? "Loading…" : "Discard draft and reload"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {saved && (
        <p className="workflow-saved" role="status">
          <CheckIcon size={17} />
          {saved}
        </p>
      )}
      {plan.editable && (
        <footer
          className={`workflow-savebar ${dirty || saving ? "is-dirty" : ""}`}
        >
          <div>
            <strong>
              {dirty
                ? `${Object.keys(changes).length} unsaved ${Object.keys(changes).length === 1 ? "change" : "changes"}`
                : "No unsaved changes"}
            </strong>
            <span>Applies to future demos in this agent’s workspace.</span>
          </div>
          <div className="workflow-save-actions">
            <button
              className="workflow-button is-quiet"
              type="button"
              disabled={!dirty || saving}
              title={
                saving
                  ? "Saving your changes."
                  : !dirty
                    ? "There are no changes to discard."
                    : undefined
              }
              onClick={() => {
                setValues(
                  Object.fromEntries(
                    plan.fields.map((field) => [field.id, field.value]),
                  ),
                );
                setError(null);
                setSaved(null);
              }}
            >
              Discard changes
            </button>
            <button
              className="workflow-button is-primary"
              type="button"
              disabled={!dirty || saving}
              title={
                saving
                  ? "Saving your changes."
                  : !dirty
                    ? "Edit a step’s creative direction first."
                    : undefined
              }
              onClick={() => {
                void save();
              }}
            >
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}
