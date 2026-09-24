export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export type StepKind =
  | "email"
  | "wait"
  | "linkedin-connect"
  | "linkedin-message"
  | "demo";

export type ContactJourneyStatus =
  | "draft"
  | "ready"
  | "waiting"
  | "review"
  | "replied"
  | "completed"
  | "stopped";

export type CampaignStep = {
  id: string;
  kind: StepKind;
  label: string;
  subject: string;
  body: string;
  delayDays: number;
  sendWindow: "business-hours" | "morning" | "anytime";
  stopOnReply: boolean;
  attachmentSlug?: string;
};

export type CampaignContact = {
  id: string;
  name: string;
  company: string;
  role: string;
  stage: string;
  selected: boolean;
  selectable: boolean;
  status: ContactJourneyStatus | null;
  currentStep: number | null;
  nextActionAt: string | null;
};

export type CampaignSummary = {
  id: string;
  seriesId: string;
  version: number;
  name: string;
  description: string;
  audience: string;
  audienceId: string | null;
  lockVersion: number;
  status: CampaignStatus;
  stepCount: number;
  contactCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Campaign = Omit<CampaignSummary, "stepCount" | "contactCount"> & {
  steps: CampaignStep[];
  contacts: CampaignContact[];
};

export type CampaignValidation = {
  ready: boolean;
  issues: string[];
};

export function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function createStep(kind: StepKind): CampaignStep {
  const common = {
    id: makeId(),
    subject: "",
    delayDays: 0,
    sendWindow: "business-hours" as const,
    stopOnReply: true,
  };

  if (kind === "email") {
    return {
      ...common,
      kind,
      label: "Send email",
      subject: "A quick idea for {{company}}",
      body: "Hi {{first_name}},\n\nI put together a short, tailored look at how this could work for {{company}}.",
    };
  }
  if (kind === "wait") {
    return {
      ...common,
      kind,
      label: "Wait",
      body: "",
      delayDays: 3,
      stopOnReply: false,
    };
  }
  if (kind === "linkedin-connect") {
    return {
      ...common,
      kind,
      label: "Connection request",
      body: "Hi {{first_name}}, I made something for {{company}} and would value your take.",
    };
  }
  if (kind === "linkedin-message") {
    return {
      ...common,
      kind,
      label: "LinkedIn message",
      body: "Thanks for connecting. Here is the tailored walkthrough I mentioned: {{demo_link}}",
    };
  }
  return {
    ...common,
    kind,
    label: "Share tailored demo",
    body: "Send the approved prospect-specific demo with a short context note.",
  };
}

// Inserts `step` directly before `beforeStepId`. The builder's connector "+"
// sits above a step and reads "Add step before <label>", so the anchor is the
// step below the gap. No anchor, or an unknown one, appends at the end.
export function insertStep(
  campaign: Campaign,
  step: CampaignStep,
  beforeStepId?: string,
): Campaign {
  const steps = [...campaign.steps];
  const beforeIndex = beforeStepId
    ? steps.findIndex((candidate) => candidate.id === beforeStepId)
    : -1;
  const index = beforeIndex >= 0 ? beforeIndex : steps.length;
  steps.splice(index, 0, step);
  return touchCampaign(campaign, { steps });
}

export function updateStep(
  campaign: Campaign,
  stepId: string,
  patch: Partial<CampaignStep>,
): Campaign {
  return touchCampaign(campaign, {
    steps: campaign.steps.map((step) =>
      step.id === stepId ? { ...step, ...patch, id: step.id } : step,
    ),
  });
}

export function moveStep(
  campaign: Campaign,
  stepId: string,
  direction: -1 | 1,
): Campaign {
  const index = campaign.steps.findIndex((step) => step.id === stepId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= campaign.steps.length) return campaign;
  const steps = [...campaign.steps];
  [steps[index], steps[target]] = [steps[target], steps[index]];
  return touchCampaign(campaign, { steps });
}

export function removeStep(campaign: Campaign, stepId: string): Campaign {
  return touchCampaign(campaign, {
    steps: campaign.steps.filter((step) => step.id !== stepId),
  });
}

export function touchCampaign(
  campaign: Campaign,
  patch: Partial<Campaign>,
  now = new Date(),
): Campaign {
  return { ...campaign, ...patch, id: campaign.id, updatedAt: now.toISOString() };
}

export function applyAudience(
  campaign: Campaign,
  audienceId: string,
  audienceName: string,
  leadIds: Iterable<string>,
): Campaign {
  const members = new Set(leadIds);
  return touchCampaign(campaign, {
    audience: audienceName,
    audienceId,
    contacts: campaign.contacts.map((contact) => {
      const selected = contact.selectable && members.has(contact.id);
      return {
        ...contact,
        selected,
        status: selected ? "draft" : null,
        currentStep: null,
        nextActionAt: null,
      };
    }),
  });
}

export function mergeCampaignContactPage(
  current: CampaignContact[],
  incoming: CampaignContact[],
  replaceUnselected: boolean,
): CampaignContact[] {
  const base = replaceUnselected
    ? current.filter((contact) => contact.selected)
    : current;
  const contacts = new Map(base.map((contact) => [contact.id, contact]));
  incoming.forEach((contact) => {
    const existing = contacts.get(contact.id);
    contacts.set(
      contact.id,
      existing
        ? {
            ...contact,
            selected: existing.selected,
            status: existing.status,
            currentStep: existing.currentStep,
            nextActionAt: existing.nextActionAt,
          }
        : contact,
    );
  });
  return [...contacts.values()];
}

export function reconcileSavedCampaign(
  local: Campaign,
  saved: Campaign,
): Campaign {
  const persisted = new Map(saved.contacts.map((contact) => [contact.id, contact]));
  const contacts = local.contacts.map((contact) => {
    const serverContact = persisted.get(contact.id);
    if (serverContact) {
      persisted.delete(contact.id);
      return serverContact;
    }
    return {
      ...contact,
      selected: false,
      status: null,
      currentStep: null,
      nextActionAt: null,
    };
  });
  return { ...saved, contacts: [...persisted.values(), ...contacts] };
}

export function validateCampaign(campaign: Campaign): CampaignValidation {
  const issues: string[] = [];
  if (!campaign.name.trim() || campaign.name === "Untitled campaign") {
    issues.push("Give the campaign a specific name.");
  }
  if (!campaign.audience.trim() || campaign.audience === "Choose an audience") {
    issues.push("Choose an audience before review.");
  }
  if (campaign.steps.length === 0) issues.push("Add at least one sequence step.");
  if (!campaign.contacts.some((contact) => contact.selected)) {
    issues.push("Choose an audience with at least one outreach-eligible member.");
  }
  campaign.steps.forEach((step, index) => {
    if (step.kind !== "wait" && !step.body.trim()) {
      issues.push(`Step ${index + 1} needs message copy.`);
    }
    if (step.kind === "email" && !step.subject.trim()) {
      issues.push(`Step ${index + 1} needs an email subject.`);
    }
    if (step.kind === "wait" && step.delayDays < 1) {
      issues.push(`Step ${index + 1} needs a wait of at least one day.`);
    }
  });
  return { ready: issues.length === 0, issues };
}

export function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function contactStatusLabel(contact: CampaignContact): string {
  if (!contact.selected) return "Not selected";
  if (contact.status === "draft") return "Selected for this draft";
  if (contact.status === "ready") return "Ready; nothing queued";
  if (contact.status === "waiting") return "Waiting";
  if (contact.status === "review") return "Needs review";
  if (contact.status === "replied") return "Reply received";
  if (contact.status === "completed") return "Completed";
  if (contact.status === "stopped") return "Stopped";
  return "Selected";
}
