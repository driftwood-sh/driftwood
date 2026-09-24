/* node --test (npm test) — Node 24 strips TypeScript types natively. */
/// <reference types="node" />

import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmedOverlapLeadIds,
  mapCampaign,
  mapCampaignOverlap,
} from "./api.ts";
import {
  applyAudience,
  createStep,
  insertStep,
  mergeCampaignContactPage,
  moveStep,
  reconcileSavedCampaign,
  removeStep,
  updateStep,
  validateCampaign,
  type Campaign,
} from "./model.ts";

function campaignFixture(): Campaign {
  return {
    id: "395a0279-fc59-43aa-b3e9-c22e0743ace3",
    seriesId: "b6cb32e9-2922-4962-8812-63c097828c1c",
    version: 1,
    name: "Untitled campaign",
    description: "A deliberate sequence.",
    audience: "Choose an audience",
    audienceId: null,
    lockVersion: 0,
    status: "draft",
    createdAt: "2026-08-21T12:00:00.000Z",
    updatedAt: "2026-08-21T12:00:00.000Z",
    steps: [createStep("email"), createStep("wait")],
    contacts: [
      {
        id: "c78e9104-eedd-4962-8779-d6ba9541da19",
        name: "Ada Lovelace",
        company: "Analytical Engines",
        role: "Founder",
        stage: "new",
        selected: true,
        selectable: true,
        status: "draft",
        currentStep: null,
        nextActionAt: null,
      },
    ],
  };
}

test("sequence steps can be inserted, reordered, edited, and removed", () => {
  const campaign = campaignFixture();
  const added = createStep("linkedin-message");
  const inserted = insertStep(campaign, added, campaign.steps[1].id);

  assert.equal(inserted.steps[1].id, added.id);

  const edited = updateStep(inserted, added.id, {
    label: "Founder follow-up",
    body: "A deliberately reviewed note.",
  });
  assert.equal(edited.steps[1].id, added.id);
  assert.equal(edited.steps[1].label, "Founder follow-up");

  const moved = moveStep(edited, added.id, -1);
  assert.equal(moved.steps[0].id, added.id);

  const removed = removeStep(moved, added.id);
  assert.equal(removed.steps.some((step) => step.id === added.id), false);
});

test("a connector + inserts the step directly before its anchor step", () => {
  const campaign = campaignFixture();
  const [email, wait] = campaign.steps;

  // The first connector sits between the audience card and step 1.
  const first = createStep("demo");
  assert.deepEqual(
    insertStep(campaign, first, email.id).steps.map((step) => step.id),
    [first.id, email.id, wait.id],
  );

  // The connector above Wait puts the step between Email and Wait.
  const middle = createStep("demo");
  assert.deepEqual(
    insertStep(campaign, middle, wait.id).steps.map((step) => step.id),
    [email.id, middle.id, wait.id],
  );
});

test("no insertion anchor appends the step at the end", () => {
  const campaign = campaignFixture();
  const [email, wait] = campaign.steps;
  const added = createStep("demo");

  assert.deepEqual(
    insertStep(campaign, added).steps.map((step) => step.id),
    [email.id, wait.id, added.id],
  );
});

test("an unknown insertion anchor safely appends the step", () => {
  const campaign = campaignFixture();
  const added = createStep("demo");
  const inserted = insertStep(campaign, added, "missing-step");

  assert.equal(inserted.steps.at(-1)?.id, added.id);
});

test("validation blocks vague drafts and requires an eligible audience member", () => {
  const draft = campaignFixture();
  const invalid = validateCampaign({
    ...draft,
    contacts: draft.contacts.map((contact) => ({ ...contact, selected: false })),
  });

  assert.equal(invalid.ready, false);
  assert.ok(invalid.issues.includes("Give the campaign a specific name."));
  assert.ok(invalid.issues.includes("Choose an audience before review."));
  assert.ok(
    invalid.issues.includes(
      "Choose an audience with at least one outreach-eligible member.",
    ),
  );

  const ready = validateCampaign({
    ...draft,
    name: "Qualified founder follow-up",
    audience: "Reviewed founder leads",
  });
  assert.deepEqual(ready, { ready: true, issues: [] });
});

test("applying an audience replaces the draft contact selection", () => {
  const campaign = campaignFixture();
  const unavailable = {
    ...campaign.contacts[0],
    id: "unavailable-lead",
    selected: false,
    selectable: false,
  };
  const eligible = {
    ...campaign.contacts[0],
    id: "new-audience-lead",
    selected: false,
    status: null,
  };
  const next = applyAudience(
    { ...campaign, contacts: [campaign.contacts[0], eligible, unavailable] },
    "audience-qa",
    "QA decision makers",
    [eligible.id, unavailable.id],
  );

  assert.equal(next.audience, "QA decision makers");
  assert.equal(next.audienceId, "audience-qa");
  assert.equal(next.contacts[0].selected, false);
  assert.equal(next.contacts[1].selected, true);
  assert.equal(next.contacts[1].status, "draft");
  assert.equal(next.contacts[2].selected, false);
});

test("contact pages replace old search results while retaining selected leads", () => {
  const campaign = campaignFixture();
  const oldResult = { ...campaign.contacts[0], id: "old", selected: false, status: null };
  const nextResult = { ...oldResult, id: "next", name: "Grace Hopper" };
  const merged = mergeCampaignContactPage(
    [campaign.contacts[0], oldResult],
    [nextResult],
    true,
  );

  assert.deepEqual(merged.map((contact) => contact.id), [campaign.contacts[0].id, "next"]);
});

test("a save response keeps the paged catalogue but takes persisted selection", () => {
  const local = campaignFixture();
  const browsed = { ...local.contacts[0], id: "browsed", selected: true };
  const saved = {
    ...local,
    lockVersion: 1,
    contacts: [local.contacts[0]],
  };
  const reconciled = reconcileSavedCampaign(
    { ...local, contacts: [local.contacts[0], browsed] },
    saved,
  );

  assert.equal(reconciled.lockVersion, 1);
  assert.equal(reconciled.contacts.find((contact) => contact.id === "browsed")?.selected, false);
});

test("API responses map snake-case persistence fields into builder state", () => {
  const mapped = mapCampaign({
    id: "395a0279-fc59-43aa-b3e9-c22e0743ace3",
    series_id: "b6cb32e9-2922-4962-8812-63c097828c1c",
    version: 2,
    name: "Founder QA",
    description: "Persisted",
    audience_name: "Qualified founders",
    audience_id: "64dddcb7-4be5-4587-8077-08974491ff9d",
    lock_version: 3,
    status: "draft",
    step_count: 1,
    contact_count: 1,
    created_at: "2026-08-21T12:00:00.000Z",
    updated_at: "2026-08-21T12:01:00.000Z",
    steps: [
      {
        id: "6f568871-5172-4e45-9931-0c429a148fd0",
        position: 1,
        kind: "email",
        label: "Email",
        subject: "Hello",
        body: "Hi",
        delay_days: 0,
        send_window: "business-hours",
        stop_on_reply: true,
        attachment_slug: null,
      },
    ],
    contacts: [
      {
        id: "c78e9104-eedd-4962-8779-d6ba9541da19",
        name: "Ada Lovelace",
        company: "Analytical Engines",
        role: "Founder",
        stage: "new",
        selected: true,
        selectable: true,
        enrollment_status: "draft",
        current_step: null,
        next_action_at: null,
      },
    ],
  });

  assert.equal(mapped.version, 2);
  assert.equal(mapped.audience, "Qualified founders");
  assert.equal(mapped.audienceId, "64dddcb7-4be5-4587-8077-08974491ff9d");
  assert.equal(mapped.lockVersion, 3);
  assert.equal(mapped.steps[0].sendWindow, "business-hours");
  assert.equal(mapped.contacts[0].selected, true);
});

test("overlap confirmation is scoped to the exact previewed lead set", () => {
  const mapped = mapCampaignOverlap({
    lead_count: 1,
    campaign_count: 2,
    conflicts: [
      {
        lead_id: "lead-one",
        lead_name: null,
        campaign_id: "campaign-one",
        campaign_name: "Founder follow-up",
      },
      {
        lead_id: "lead-one",
        lead_name: "Ada Lovelace",
        campaign_id: "campaign-two",
        campaign_name: "Product leaders",
      },
    ],
  });

  assert.equal(mapped.leadCount, 1);
  assert.equal(mapped.conflicts[0].leadName, "Unnamed lead");
  assert.deepEqual(confirmedOverlapLeadIds(mapped), ["lead-one"]);
});
