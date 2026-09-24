import CampaignOutputs from "./CampaignOutputs";
import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import {
  getAudience as getSavedAudience,
  listAudiences,
} from "../audiences/api";
import { outreachEligibleMembers, type Audience, type AudienceSummary } from "../audiences/model";
import CampaignShell from "./CampaignShell";
import {
  activateCampaign,
  CampaignApiError,
  confirmedOverlapLeadIds,
  createCampaign,
  createCampaignRevision,
  getCampaign,
  getCampaignOverlaps,
  pauseCampaign,
  resumeCampaign,
  saveCampaign,
  type CampaignOverlap,
} from "./api";
import {
  applyAudience,
  createStep,
  insertStep,
  moveStep,
  reconcileSavedCampaign,
  removeStep,
  touchCampaign,
  updateStep,
  validateCampaign,
  type Campaign,
  type CampaignStep,
  type StepKind,
} from "./model";
import { CampaignSaveQueue } from "./save-queue";
import { disconnectedChannelIssues } from "./channel-readiness";
import { useToast } from "../dashboard-shared";
import { useWorkspacePermissions } from "../dashboard/workspace-permissions-context";
import { withMockMode } from "../mock-mode";
import {
  BackIcon,
  CloseIcon,
  DemoIcon,
  EditIcon,
  LinkedInIcon,
  MailIcon,
  MoveDownIcon,
  MoveUpIcon,
  PeopleIcon,
  PlusIcon,
  TrashIcon,
  WaitIcon,
} from "./icons";

type MobilePanel = "flow" | "editor";
type SaveState = "idle" | "saving" | "saved" | "error";

const STEP_OPTIONS: Array<{
  kind: StepKind;
  label: string;
  detail: string;
  icon: typeof MailIcon;
}> = [
  { kind: "email", label: "Email", detail: "Subject and personalized body", icon: MailIcon },
  { kind: "demo", label: "Tailored demo", detail: "Share an approved prospect demo", icon: DemoIcon },
  { kind: "wait", label: "Wait", detail: "Delay the next action", icon: WaitIcon },
  { kind: "linkedin-connect", label: "Connection request", detail: "Request a LinkedIn connection", icon: LinkedInIcon },
  { kind: "linkedin-message", label: "LinkedIn message", detail: "Message a connected lead", icon: LinkedInIcon },
];

function StepGlyph({ kind, size = 18 }: { kind: StepKind; size?: number }) {
  if (kind === "email") return <MailIcon size={size} />;
  if (kind === "wait") return <WaitIcon size={size} />;
  if (kind === "demo") return <DemoIcon size={size} />;
  return <LinkedInIcon size={size} />;
}

function detailForStep(step: CampaignStep): string {
  if (step.kind === "wait") return `${step.delayDays} ${step.delayDays === 1 ? "day" : "days"}`;
  if (step.kind === "email") return step.subject || "Subject needed";
  return step.body || "Copy needed";
}

function CampaignBuilderWorkspace({ campaignId }: { campaignId: string }) {
  const { canWrite, channels } = useWorkspacePermissions();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const campaignRef = useRef<Campaign | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  // undefined = dialog closed, null = append, string = insert before that step.
  const [addBeforeStepId, setAddBeforeStepId] = useState<string | null | undefined>(undefined);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewMode, setReviewMode] = useState<"activate" | "resume">("activate");
  const [overlap, setOverlap] = useState<CampaignOverlap | null>(null);
  const [overlapLoading, setOverlapLoading] = useState(false);
  const [overlapError, setOverlapError] = useState<string | null>(null);
  const [overlapConfirmed, setOverlapConfirmed] = useState(false);
  /* Transient confirmations ride the shared dashboard toast channel (mounted
     by WorkspacePage's ToastProvider) — the builder's error surfaces stay
     local: in-dialog alerts and the toolbar alert strip. */
  const pushToast = useToast();
  const [actionError, setActionError] = useState<string | null>(null);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("flow");
  const [loading, setLoading] = useState(campaignId !== "new");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [actionBusy, setActionBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const latestRevisionRef = useRef(0);
  const saveTimerRef = useRef<number | null>(null);
  const savePromiseRef = useRef<Promise<Campaign> | null>(null);
  const saveQueueRef = useRef(new CampaignSaveQueue(saveCampaign));

  useEffect(() => {
    let current = true;
    if (campaignId === "new") return () => { current = false; };
    const load = getCampaign(campaignId);
    load
      .then((loaded) => {
        if (!current) return;
        campaignRef.current = loaded;
        setCampaign(loaded);
        setSelectedStepId(loaded.steps[0]?.id ?? null);
        setSaveState("saved");
      })
      .catch((reason: unknown) => {
        if (current) {
          setLoadError(reason instanceof Error ? reason.message : "Campaign could not load.");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [campaignId]);

  async function createDraft() {
    if (!canWrite || actionBusy) return;
    setActionBusy(true);
    setLoadError(null);
    try {
      const created = await createCampaign();
      window.location.href = withMockMode(
        `/dashboard/campaigns/${encodeURIComponent(created.id)}`,
      );
    } catch (reason) {
      setLoadError(
        reason instanceof Error ? reason.message : "Campaign could not be created.",
      );
      setActionBusy(false);
    }
  }

  /* Unsaved work guard: while a save is pending (including the 600ms debounce
     window) or has failed, warn before the tab or page goes away. */
  useEffect(() => {
    if (saveState !== "saving" && saveState !== "error") return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveState]);

  /* Memoized (pushToast is its one reactive input, and stable) so the
     debounce effect below can list it honestly. */
  const persistSnapshot = useCallback((snapshot: Campaign, expectedRevision: number) => {
    const pending = saveQueueRef.current.enqueue(snapshot);
    savePromiseRef.current = pending;
    return pending
      .then((saved) => {
        const current = campaignRef.current;
        if (!current) return saved;
        if (latestRevisionRef.current === expectedRevision) {
          const reconciled = reconcileSavedCampaign(current, saved);
          campaignRef.current = reconciled;
          setCampaign(reconciled);
        } else {
          const versioned = { ...current, lockVersion: saved.lockVersion };
          campaignRef.current = versioned;
          setCampaign(versioned);
        }
        setSaveState("saved");
        return campaignRef.current ?? saved;
      })
      .catch((reason: unknown) => {
        if (latestRevisionRef.current === expectedRevision) {
          setSaveState("error");
          if (reason instanceof CampaignApiError && reason.code === "campaign_conflict") {
            pushToast("This campaign changed elsewhere. Reload before continuing.", "error");
          }
        }
        throw reason;
      })
      .finally(() => {
        if (savePromiseRef.current === pending) savePromiseRef.current = null;
      });
  }, [pushToast]);

  useEffect(() => {
    if (revision === 0) return;
    saveTimerRef.current = window.setTimeout(() => {
      const snapshot = campaignRef.current;
      if (!snapshot || snapshot.status !== "draft") return;
      void persistSnapshot(snapshot, latestRevisionRef.current).catch(() => undefined);
    }, 600);
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, [revision, persistSnapshot]);

  function commit(next: Campaign) {
    if (campaignRef.current?.status !== "draft") return;
    campaignRef.current = next;
    setCampaign(next);
    setSaveState("saving");
    latestRevisionRef.current += 1;
    setRevision(latestRevisionRef.current);
  }

  function patchCampaign(patch: Partial<Campaign>) {
    const current = campaignRef.current;
    if (!current) return;
    commit(touchCampaign(current, patch));
  }

  function patchStep(patch: Partial<CampaignStep>) {
    const current = campaignRef.current;
    if (!current || !selectedStepId) return;
    commit(updateStep(current, selectedStepId, patch));
  }

  function addStep(kind: StepKind) {
    const current = campaignRef.current;
    if (!current) return;
    const step = createStep(kind);
    const next = insertStep(current, step, addBeforeStepId ?? undefined);
    commit(next);
    setSelectedStepId(step.id);
    setAddBeforeStepId(undefined);
    setMobilePanel("editor");
    pushToast(`${step.label} added to the sequence.`, "success");
  }

  function handleMove(stepId: string, direction: -1 | 1) {
    const current = campaignRef.current;
    if (current) commit(moveStep(current, stepId, direction));
  }

  function handleRemove() {
    const current = campaignRef.current;
    if (!current || !selectedStepId) return;
    const index = current.steps.findIndex((step) => step.id === selectedStepId);
    const next = removeStep(current, selectedStepId);
    commit(next);
    setSelectedStepId(next.steps[Math.max(0, index - 1)]?.id ?? null);
    setMobilePanel("flow");
    pushToast("Step removed from the sequence.", "success");
  }

  function selectSavedAudience(audience: Audience) {
    const current = campaignRef.current;
    if (!current) return;
    const eligibleMembers = outreachEligibleMembers(audience.members);
    const leadIds = eligibleMembers.map((member) => member.leadId);
    const audienceContacts = audience.members.map((member) => ({
      id: member.leadId,
      name: member.name,
      company: member.company,
      role: member.title,
      stage: member.stage,
      selected: false,
      selectable: member.contactable && member.outreachEligible,
      status: null,
      currentStep: null,
      nextActionAt: null,
    }));
    const hydrated = { ...current, contacts: audienceContacts };
    commit(applyAudience(hydrated, audience.id, audience.name, leadIds));
    pushToast(
      `${audience.name} applied with ${leadIds.length} outreach-eligible ${leadIds.length === 1 ? "member" : "members"}.`,
      "success",
    );
  }

  async function persistLatest(): Promise<Campaign> {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    const current = campaignRef.current;
    if (!current) throw new Error("Campaign is unavailable.");
    setSaveState("saving");
    return await persistSnapshot(current, latestRevisionRef.current);
  }

  async function activate() {
    const current = campaignRef.current;
    if (
      !current || !canWrite || !validateCampaign(current).ready ||
      disconnectedChannelIssues(current, channels).length > 0 ||
      overlapLoading || overlapError || (overlap?.leadCount && !overlapConfirmed)
    ) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const saved = await persistLatest();
      const confirmedLeadIds = overlapConfirmed ? confirmedOverlapLeadIds(overlap) : [];
      const active = await activateCampaign(saved.id, confirmedLeadIds);
      campaignRef.current = active;
      setCampaign(active);
      closeReview();
      pushToast("Campaign activated. No outreach was queued or sent.", "success");
    } catch (reason) {
      /* The failure renders inside the still-open review dialog, next to the
         Activate button, which stays enabled for a retry. A corner toast is
         invisible here: the <dialog> top layer paints over it. */
      setActionError(reason instanceof Error ? reason.message : "Campaign could not be activated.");
    } finally {
      setActionBusy(false);
    }
  }

  async function openReview() {
    const current = campaignRef.current;
    if (!current || !canWrite || current.status !== "draft") return;
    setReviewMode("activate");
    setReviewOpen(true);
    setActionError(null);
    setOverlap(null);
    setOverlapConfirmed(false);
    setOverlapError(null);
    setOverlapLoading(true);
    try {
      const saved = await persistLatest();
      setOverlap(await getCampaignOverlaps(saved.id));
    } catch (reason) {
      setOverlapError(
        reason instanceof Error ? reason.message : "Lead overlap could not be checked.",
      );
    } finally {
      setOverlapLoading(false);
    }
  }

  async function openResumeReview() {
    const current = campaignRef.current;
    if (!current || !canWrite || current.status !== "paused") return;
    setReviewMode("resume");
    setReviewOpen(true);
    setActionError(null);
    setOverlap(null);
    setOverlapConfirmed(false);
    setOverlapError(null);
    setOverlapLoading(true);
    try {
      setOverlap(await getCampaignOverlaps(current.id));
    } catch (reason) {
      setOverlapError(
        reason instanceof Error ? reason.message : "Lead overlap could not be checked.",
      );
    } finally {
      setOverlapLoading(false);
    }
  }

  async function resume() {
    const current = campaignRef.current;
    if (
      !current || !canWrite || current.status !== "paused" ||
      overlapLoading || overlapError || (overlap?.leadCount && !overlapConfirmed)
    ) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const confirmedLeadIds = overlapConfirmed ? confirmedOverlapLeadIds(overlap) : [];
      const resumed = await resumeCampaign(current.id, confirmedLeadIds);
      campaignRef.current = resumed;
      setCampaign(resumed);
      closeReview();
      pushToast("Campaign resumed. Nothing was sent.", "success");
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "The campaign could not resume.");
    } finally {
      setActionBusy(false);
    }
  }

  function closeReview() {
    setReviewOpen(false);
    setOverlap(null);
    setOverlapConfirmed(false);
    setOverlapError(null);
  }

  async function toggleStatus() {
    const current = campaignRef.current;
    if (!current || !canWrite || (current.status !== "active" && current.status !== "paused")) return;
    if (current.status === "paused") {
      await openResumeReview();
      return;
    }
    setActionBusy(true);
    setActionError(null);
    try {
      const updated = await pauseCampaign(current.id);
      campaignRef.current = updated;
      setCampaign(updated);
      pushToast("Campaign paused.", "success");
    } catch (reason) {
      /* Renders as a role="alert" strip in the toolbar, next to the Pause
         button, which stays enabled for a retry. */
      setActionError(reason instanceof Error ? reason.message : "The campaign could not pause.");
    } finally {
      setActionBusy(false);
    }
  }

  async function revise() {
    const current = campaignRef.current;
    if (!current || !canWrite) return;
    setActionBusy(true);
    setActionError(null);
    try {
      const draft = await createCampaignRevision(current.id);
      window.location.href = withMockMode(`/dashboard/campaigns/${encodeURIComponent(draft.id)}`);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "A revision could not be created.");
      setActionBusy(false);
    }
  }

  if (campaignId === "new") {
    return (
      <div className="campaign-not-found">
        <h1>Start a new campaign</h1>
        {!canWrite && <p>Read-only members cannot create campaigns.</p>}
        {loadError && <p className="campaign-inline-error" role="alert">{loadError}</p>}
        {canWrite && (
          <button className="campaign-primary" type="button" onClick={() => void createDraft()} disabled={actionBusy}>
            {actionBusy ? "Creating…" : "Create campaign draft"}
          </button>
        )}
        <a className="campaign-secondary" href={withMockMode("/dashboard/campaigns")}>Back to campaigns</a>
      </div>
    );
  }

  if (loading) {
    return <BuilderSkeleton />;
  }

  if (!campaign || loadError) {
    return (
      <div className="campaign-not-found">
        <h1>Campaign unavailable</h1>
        <p>{loadError ?? "This campaign could not be found in your workspace."}</p>
        <a className="campaign-primary" href={withMockMode("/dashboard/campaigns")}>Back to campaigns</a>
      </div>
    );
  }

  const editable = canWrite && campaign.status === "draft";
  const selectedStep = campaign.steps.find((step) => step.id === selectedStepId) ?? null;
  const baseValidation = validateCampaign(campaign);
  const channelIssues = disconnectedChannelIssues(campaign, channels);
  const validation = {
    ready: baseValidation.ready && channelIssues.length === 0,
    issues: [...baseValidation.issues, ...channelIssues],
  };
  const selectedContacts = campaign.contacts.filter((contact) => contact.selected);

  return (
    <>
      <div className="campaign-workspace">
        <header className="campaign-builder-toolbar">
          <div className="campaign-builder-title">
            <a className="campaign-icon-link" href={withMockMode("/dashboard/campaigns")} aria-label="Back to campaigns">
              <BackIcon size={17} />
            </a>
            <div>
              <span className={`campaign-status campaign-status-${campaign.status}`}>
                {campaign.status} · v{campaign.version}
              </span>
              <input
                className="campaign-name-input"
                value={campaign.name}
                aria-label="Campaign name"
                data-testid="campaign-name"
                disabled={!editable}
                onChange={(event) => patchCampaign({ name: event.target.value })}
              />
            </div>
          </div>
          <div className="campaign-builder-actions">
            {canWrite && (campaign.status === "active" || campaign.status === "paused") ? (
              <button className="campaign-secondary" type="button" onClick={toggleStatus} disabled={actionBusy}>
                {campaign.status === "active" ? (actionBusy ? "Pausing…" : "Pause") : "Resume"}
              </button>
            ) : null}
            <span
              className={`campaign-saved-state campaign-save-${saveState}`}
              aria-live={saveState === "error" ? "assertive" : "polite"}
            >
              {!canWrite ? "Read only" : saveState === "saving" ? "Saving…" : saveState === "error" ? "Save failed" : editable ? "Saved" : "Version frozen"}
            </span>
            {saveState === "error" && editable && (
              <button
                className="campaign-save-retry"
                type="button"
                onClick={() => void persistLatest().catch(() => undefined)}
              >
                Retry save
              </button>
            )}
            {channelIssues.length > 0 && <span className="campaign-channel-warning">Channel setup required</span>}
            {canWrite && editable ? (
              <button className="campaign-primary" type="button" onClick={() => void openReview()} disabled={actionBusy} data-testid="review-campaign">
                Review campaign
              </button>
            ) : canWrite && campaign.status !== "draft" ? (
              <button className="campaign-primary" type="button" onClick={revise} disabled={actionBusy} data-testid="revise-campaign">
                {actionBusy ? "Creating…" : "Create revision"}
              </button>
            ) : null}
          </div>
          {actionError && !reviewOpen && (
            <div className="campaign-action-error" role="alert">
              <span>{actionError}</span>
              <button type="button" onClick={() => setActionError(null)}>Dismiss</button>
            </div>
          )}
        </header>

        <CampaignOutputs key={campaign.id} campaign={campaign} editable={editable && canWrite && saveState !== "saving" && saveState !== "error"} />
        <div className="campaign-mobile-switcher" role="group" aria-label="Campaign workspace panels">
          {(["flow", "editor"] as MobilePanel[]).map((panel) => (
            <button
              key={panel}
              type="button"
              className={mobilePanel === panel ? "is-active" : ""}
              onClick={() => setMobilePanel(panel)}
            >
              {panel === "flow" ? "Sequence" : "Editor"}
            </button>
          ))}
        </div>

        <section className={`campaign-canvas ${mobilePanel === "flow" ? "is-mobile-current" : ""}`} aria-label="Campaign sequence">
          <div className="campaign-canvas-head">
            <div>
              <span>Sequence</span>
              <small>{campaign.steps.length} steps · persisted version {campaign.version}</small>
            </div>
            {editable && (
              <button className="campaign-secondary campaign-compact-button" type="button" onClick={() => setAddBeforeStepId(null)}>
                <PlusIcon size={15} /> Add step
              </button>
            )}
          </div>
          <div className="campaign-flow" data-testid="campaign-flow">
            <button
              type="button"
              className="campaign-audience-node"
              data-testid="audience-node"
              onClick={() => {
                setSelectedStepId(null);
                setMobilePanel("editor");
              }}
            >
              <span className="campaign-node-icon"><PeopleIcon size={18} /></span>
              <span>
                <small>Audience</small>
                <strong>{campaign.audience}</strong>
                <span>
                  {selectedContacts.length} outreach-eligible {selectedContacts.length === 1 ? "member" : "members"}
                </span>
              </span>
              <EditIcon size={15} />
            </button>

            {campaign.steps.map((step, index) => (
              <SequenceNode
                key={step.id}
                step={step}
                index={index}
                total={campaign.steps.length}
                selected={selectedStepId === step.id}
                editable={editable}
                onSelect={() => {
                  setSelectedStepId(step.id);
                  setMobilePanel("editor");
                }}
                onMove={(direction) => handleMove(step.id, direction)}
                onAdd={() => setAddBeforeStepId(step.id)}
              />
            ))}

            {editable && (
              <button className="campaign-flow-add-final" type="button" onClick={() => setAddBeforeStepId(null)}>
                <PlusIcon size={16} />
                Add another step
              </button>
            )}
          </div>
        </section>

        <aside className={`campaign-inspector ${mobilePanel === "editor" ? "is-mobile-current" : ""}`} aria-label="Campaign editor">
          {selectedStep ? (
            <StepEditor
              step={selectedStep}
              editable={editable}
              onChange={patchStep}
              onRemove={handleRemove}
            />
          ) : (
            <AudienceEditor
              campaign={campaign}
              editable={editable}
              onChange={patchCampaign}
              onApply={selectSavedAudience}
            />
          )}
        </aside>
      </div>

      {addBeforeStepId !== undefined && editable && (
        <AddStepDialog onClose={() => setAddBeforeStepId(undefined)} onAdd={addStep} />
      )}

      {reviewOpen && (reviewMode === "resume" ? canWrite && campaign.status === "paused" : editable) && (
        <ReviewDialog
          mode={reviewMode}
          campaign={campaign}
          issues={reviewMode === "resume" ? [] : validation.issues}
          busy={actionBusy}
          actionError={actionError}
          overlap={overlap}
          overlapLoading={overlapLoading}
          overlapError={overlapError}
          overlapConfirmed={overlapConfirmed}
          onOverlapConfirmed={setOverlapConfirmed}
          onRetryOverlap={() => void (reviewMode === "resume" ? openResumeReview() : openReview())}
          onClose={closeReview}
          onConfirm={reviewMode === "resume" ? resume : activate}
        />
      )}
    </>
  );
}

export default function CampaignBuilder({ campaignId }: { campaignId: string }) {
  return (
    <CampaignShell active="campaigns" workspace>
      <CampaignBuilderWorkspace campaignId={campaignId} />
    </CampaignShell>
  );
}

/* Layout-mirroring skeleton for the builder's first paint (ux-principles
   rules 1+2): toolbar, sequence canvas, and inspector hold their final
   footprint so nothing jumps when the campaign lands. Static under
   prefers-reduced-motion via campaigns.css. */
function BuilderSkeleton() {
  return (
    <div className="campaign-workspace" aria-busy="true">
      <p className="sr-only" role="status">Loading campaign…</p>
      <header className="campaign-builder-toolbar" aria-hidden="true">
        <div className="campaign-builder-title">
          <span className="campaign-skel campaign-skel-circle" />
          <div>
            <span className="campaign-skel campaign-skel-chip" />
            <span className="campaign-skel campaign-skel-title" />
          </div>
        </div>
        <div className="campaign-builder-actions">
          <span className="campaign-skel campaign-skel-pill" />
        </div>
      </header>
      <section className="campaign-canvas is-mobile-current" aria-hidden="true">
        <div className="campaign-flow">
          <div className="campaign-skel-node" />
          {[0, 1, 2].map((index) => (
            <div className="campaign-flow-item" key={index}>
              <span className="campaign-skel-connector" />
              <div className="campaign-skel-node" />
            </div>
          ))}
        </div>
      </section>
      <aside className="campaign-inspector" aria-hidden="true">
        <div className="campaign-editor-form">
          <div className="campaign-editor-heading">
            <span className="campaign-skel campaign-skel-icon" />
            <span className="campaign-skel campaign-skel-heading" />
          </div>
          {[0, 1, 2].map((index) => (
            <div className="campaign-field" key={index}>
              <span className="campaign-skel campaign-skel-label" />
              <span className="campaign-skel campaign-skel-input" />
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function SequenceNode({
  step,
  index,
  total,
  selected,
  editable,
  onSelect,
  onMove,
  onAdd,
}: {
  step: CampaignStep;
  index: number;
  total: number;
  selected: boolean;
  editable: boolean;
  onSelect: () => void;
  onMove: (direction: -1 | 1) => void;
  onAdd: () => void;
}) {
  return (
    <div className="campaign-flow-item">
      <div className="campaign-flow-connector">
        {step.kind === "wait" ? <span>always · wait {step.delayDays}d</span> : <span>continue</span>}
        {editable && <button type="button" onClick={onAdd} aria-label={`Add step before ${step.label}`}><PlusIcon size={13} /></button>}
      </div>
      <div className={`campaign-sequence-node ${selected ? "is-selected" : ""}`} data-testid={`sequence-step-${step.kind}`}>
        <button className="campaign-node-main" type="button" onClick={onSelect} aria-pressed={selected}>
          <span className="campaign-node-icon"><StepGlyph kind={step.kind} /></span>
          <span className="campaign-node-copy">
            <small>Step {index + 1}</small>
            <strong>{step.label}</strong>
            <span>{detailForStep(step)}</span>
          </span>
        </button>
        {editable && (
          <div className="campaign-node-controls">
            <button type="button" onClick={() => onMove(-1)} disabled={index === 0} aria-label={`Move ${step.label} up`}><MoveUpIcon size={14} /></button>
            <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} aria-label={`Move ${step.label} down`}><MoveDownIcon size={14} /></button>
          </div>
        )}
      </div>
    </div>
  );
}

function AudienceEditor({
  campaign,
  editable,
  onChange,
  onApply,
}: {
  campaign: Campaign;
  editable: boolean;
  onChange: (patch: Partial<Campaign>) => void;
  onApply: (audience: Audience) => void;
}) {
  const [audiences, setAudiences] = useState<AudienceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    listAudiences()
      .then((rows) => {
        if (current) setAudiences(rows);
      })
      .catch((reason: unknown) => {
        if (current) {
          setError(reason instanceof Error ? reason.message : "Audiences could not load.");
        }
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  async function chooseAudience(id: string) {
    if (!id) return;
    setApplying(true);
    setError(null);
    try {
      onApply(await getSavedAudience(id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "This audience could not be applied.");
    } finally {
      setApplying(false);
    }
  }

  const selectedAudienceId = campaign.audienceId ??
    audiences.find((audience) => audience.name === campaign.audience)?.id ?? "";
  const selectedCount = campaign.contacts.filter((contact) => contact.selected).length;

  return (
    <div className="campaign-editor-form">
      <div className="campaign-editor-heading">
        <span className="campaign-node-icon"><PeopleIcon size={18} /></span>
        <div><small>Audience</small><h2>Who enters this campaign</h2></div>
      </div>
      <label className="campaign-field">
        <span>Saved audience</span>
        <select
          disabled={!editable || loading || applying}
          value={selectedAudienceId}
          data-testid="campaign-audience"
          onChange={(event) => void chooseAudience(event.target.value)}
        >
          <option value="">
            {loading
              ? "Loading audiences…"
              : audiences.length
                ? "Choose a saved audience"
                : "No saved audiences yet"}
          </option>
          {audiences.map((audience) => (
            <option key={audience.id} value={audience.id}>
              {audience.name} · {audience.memberCount} {audience.memberCount === 1 ? "member" : "members"}
            </option>
          ))}
        </select>
        <small>
          {applying
            ? "Applying eligible audience membership…"
            : `${selectedCount} outreach-eligible ${selectedCount === 1 ? "member" : "members"} in this audience.`}
        </small>
      </label>
      {error && <div className="campaign-audience-error" role="alert">{error}</div>}
      <a className="campaign-audience-link" href={withMockMode("/dashboard/audiences")}>
        Build or edit audiences
      </a>
      <label className="campaign-field">
        <span>Campaign description</span>
        <textarea disabled={!editable} rows={5} value={campaign.description} onChange={(event) => onChange({ description: event.target.value })} />
      </label>
      <div className="campaign-editor-note">
        Audience membership is copied into this campaign version. It does not change lead stages or queue outreach.
      </div>
    </div>
  );
}

function StepEditor({
  step,
  editable,
  onChange,
  onRemove,
}: {
  step: CampaignStep;
  editable: boolean;
  onChange: (patch: Partial<CampaignStep>) => void;
  onRemove: () => void;
}) {
  const isMessage = step.kind !== "wait";
  return (
    <div className="campaign-editor-form">
      <div className="campaign-editor-heading">
        <span className="campaign-node-icon"><StepGlyph kind={step.kind} /></span>
        <div><small>Sequence step</small><h2>{step.label}</h2></div>
      </div>
      <label className="campaign-field">
        <span>Step name</span>
        <input disabled={!editable} value={step.label} onChange={(event) => onChange({ label: event.target.value })} data-testid="step-label" />
      </label>
      {step.kind === "email" && (
        <label className="campaign-field">
          <span>Subject</span>
          <input disabled={!editable} value={step.subject} onChange={(event) => onChange({ subject: event.target.value })} data-testid="step-subject" />
        </label>
      )}
      {isMessage ? (
        <label className="campaign-field">
          <span>Message</span>
          <textarea disabled={!editable} rows={8} value={step.body} onChange={(event) => onChange({ body: event.target.value })} data-testid="step-body" />
          <small>Available variables: {"{{first_name}}"}, {"{{company}}"}, {"{{demo_link}}"}</small>
        </label>
      ) : (
        <label className="campaign-field">
          <span>Wait time in days</span>
          <input
            disabled={!editable}
            type="number"
            min={1}
            max={30}
            value={step.delayDays}
            onChange={(event) => onChange({ delayDays: Math.max(1, Number(event.target.value) || 1) })}
            data-testid="step-delay"
          />
        </label>
      )}
      {isMessage && (
        <>
          <label className="campaign-field">
            <span>Send window</span>
            <select disabled={!editable} value={step.sendWindow} onChange={(event) => onChange({ sendWindow: event.target.value as CampaignStep["sendWindow"] })}>
              <option value="business-hours">Weekdays, 9 AM to 6 PM</option>
              <option value="morning">Weekdays, 8 AM to noon</option>
              <option value="anytime">Any protected send window</option>
            </select>
          </label>
          <label className="campaign-check-field">
            <input disabled={!editable} type="checkbox" checked={step.stopOnReply} onChange={(event) => onChange({ stopOnReply: event.target.checked })} />
            <span><strong>Stop on reply</strong><small>Do not continue this lead after a reply.</small></span>
          </label>
        </>
      )}
      {editable && (
        <button className="campaign-danger-button campaign-editor-remove" type="button" onClick={onRemove}>
          <TrashIcon size={15} /> Remove step
        </button>
      )}
    </div>
  );
}

function CampaignModal({
  labelledBy,
  className,
  locked = false,
  onClose,
  children,
}: {
  labelledBy: string;
  className: string;
  locked?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const returnFocus = returnFocusRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      returnFocus?.focus();
    };
  }, []);

  function requestClose() {
    if (!locked) onClose();
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget || locked) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (
      event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom
    ) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      className={`campaign-dialog ${className}`}
      aria-modal="true"
      aria-labelledby={labelledBy}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          requestClose();
        }
      }}
      onMouseDown={closeFromBackdrop}
    >
      {children}
    </dialog>
  );
}

function AddStepDialog({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (kind: StepKind) => void;
}) {
  return (
    <CampaignModal labelledBy="add-step-heading" className="campaign-step-dialog" onClose={onClose}>
        <div className="campaign-dialog-heading">
          <div><small>Sequence library</small><h2 id="add-step-heading">Add a step</h2></div>
          <button className="campaign-icon-button" type="button" onClick={onClose} aria-label="Close step library" autoFocus><CloseIcon size={17} /></button>
        </div>
        <div className="campaign-step-options">
          {STEP_OPTIONS.map((option) => {
            const OptionIcon = option.icon;
            return (
              <button type="button" key={option.kind} onClick={() => onAdd(option.kind)} data-testid={`add-step-${option.kind}`}>
                <span className="campaign-node-icon"><OptionIcon size={18} /></span>
                <span><strong>{option.label}</strong><small>{option.detail}</small></span>
                <PlusIcon size={15} />
              </button>
            );
          })}
        </div>
    </CampaignModal>
  );
}

function ReviewDialog({
  mode,
  campaign,
  issues,
  busy,
  actionError,
  overlap,
  overlapLoading,
  overlapError,
  overlapConfirmed,
  onOverlapConfirmed,
  onRetryOverlap,
  onClose,
  onConfirm,
}: {
  mode: "activate" | "resume";
  campaign: Campaign;
  issues: string[];
  busy: boolean;
  actionError: string | null;
  overlap: CampaignOverlap | null;
  overlapLoading: boolean;
  overlapError: string | null;
  overlapConfirmed: boolean;
  onOverlapConfirmed: (confirmed: boolean) => void;
  onRetryOverlap: () => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const resuming = mode === "resume";
  const selected = campaign.contacts.filter((contact) => contact.selected).length;
  const needsOverlapConfirmation = (overlap?.leadCount ?? 0) > 0;
  const overlapReady = !overlapLoading && !overlapError && overlap !== null;
  return (
    <CampaignModal labelledBy="review-heading" className="campaign-review-dialog" locked={busy} onClose={onClose}>
        <div className="campaign-dialog-heading">
          <div><small>Version {campaign.version} check</small><h2 id="review-heading">{resuming ? "Resume campaign" : "Review campaign"}</h2></div>
          <button className="campaign-icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Close review" autoFocus><CloseIcon size={17} /></button>
        </div>
        <div className="campaign-review-summary">
          <div><span>Audience</span><strong>{campaign.audience}</strong></div>
          <div><span>Audience members</span><strong>{selected}</strong></div>
          <div><span>Sequence steps</span><strong>{campaign.steps.length}</strong></div>
        </div>
        {issues.length > 0 ? (
          <div className="campaign-review-issues" role="alert">
            <strong>Finish these items before activation</strong>
            <ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          </div>
        ) : (
          <div className="campaign-review-ready">
            <strong>{resuming ? "Ready to resume this version" : "Ready to freeze this version"}</strong>
            <p>
              {resuming
                ? "Resuming reopens this stored version's pending ledger. It does not approve, queue, or send outreach."
                : "Activation stores the version and initializes a pending ledger. It does not approve, queue, or send outreach."}
            </p>
          </div>
        )}
        {overlapLoading ? (
          <div className="campaign-review-overlap is-loading" role="status">
            Checking active campaigns…
          </div>
        ) : overlapError ? (
          <div className="campaign-review-overlap is-error" role="alert">
            <span>{overlapError}</span>
            <button className="campaign-secondary" type="button" onClick={onRetryOverlap}>Try again</button>
          </div>
        ) : needsOverlapConfirmation && overlap ? (
          <div className="campaign-review-overlap">
            <strong>
              {overlap.leadCount} {overlap.leadCount === 1 ? "lead is" : "leads are"} active in {overlap.campaignCount} other {overlap.campaignCount === 1 ? "campaign" : "campaigns"}
            </strong>
            <ul>
              {overlap.conflicts.slice(0, 5).map((conflict) => (
                <li key={`${conflict.leadId}-${conflict.campaignId}`}>
                  <span>{conflict.leadName}</span><small>{conflict.campaignName}</small>
                </li>
              ))}
            </ul>
            {overlap.conflicts.length > 5 && <p>+{overlap.conflicts.length - 5} more overlaps</p>}
            <label>
              <input type="checkbox" checked={overlapConfirmed} onChange={(event) => onOverlapConfirmed(event.target.checked)} />
              <span>Allow these leads to be active in both campaigns.</span>
            </label>
          </div>
        ) : overlapReady ? (
          <div className="campaign-review-overlap is-clear">
            No active campaign overlap
          </div>
        ) : null}
        {actionError && (
          <div className="campaign-dialog-error" role="alert">
            {actionError}
          </div>
        )}
        <div className="campaign-dialog-actions">
          <button className="campaign-secondary" type="button" onClick={onClose} disabled={busy}>{resuming ? "Keep paused" : "Keep editing"}</button>
          <button className="campaign-primary" type="button" onClick={onConfirm} disabled={issues.length > 0 || busy || !overlapReady || (needsOverlapConfirmation && !overlapConfirmed)} data-testid={resuming ? "resume-campaign" : "activate-campaign"}>
            {busy ? (resuming ? "Resuming…" : "Activating…") : resuming ? "Resume campaign" : "Activate campaign"}
          </button>
        </div>
    </CampaignModal>
  );
}
