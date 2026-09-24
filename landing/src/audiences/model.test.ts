import assert from "node:assert/strict";
import test from "node:test";

import {
  csvFilename,
  FOUND_BY_LABELS,
  filterAudiences,
  filterMembers,
  foundByCounts,
  memberFoundBy,
  membersCsv,
  outreachEligibleMembers,
  providerLabel,
  summarizeLeadImport,
  stageLabel,
  toggleLead,
  type AudienceSummary,
} from "./model.ts";

const rows: AudienceSummary[] = [
  {
    id: "one",
    name: "Qualified founders",
    description: "Founder-led companies",
    sourceProvider: "workspace",
    memberCount: 3,
    createdAt: "2026-08-21T12:00:00Z",
    updatedAt: "2026-08-21T12:00:00Z",
  },
  {
    id: "two",
    name: "Sales leaders",
    description: "",
    sourceProvider: "orange_slice",
    memberCount: 5,
    createdAt: "2026-08-21T12:00:00Z",
    updatedAt: "2026-08-21T12:00:00Z",
  },
];

test("audience library search covers copy and provider", () => {
  assert.deepEqual(filterAudiences(rows, "founder").map((row) => row.id), ["one"]);
  assert.deepEqual(filterAudiences(rows, "orange").map((row) => row.id), ["two"]);
});

test("lead selection is immutable and toggles membership", () => {
  const original = new Set(["one"]);
  const added = toggleLead(original, "two");
  const removed = toggleLead(added, "one");
  assert.deepEqual([...original], ["one"]);
  assert.deepEqual([...added], ["one", "two"]);
  assert.deepEqual([...removed], ["two"]);
});

test("stage labels normalize stored enum slugs", () => {
  assert.equal(stageLabel("demo_built"), "Demo Built");
});

test("campaign eligibility stays separate from reusable audience membership", () => {
  const base = {
    name: "Ari",
    title: "Founder",
    company: "Northwind",
    email: "Email not set",
    linkedinUrl: null,
    stage: "new",
    contactable: true,
  };
  const members = [
    { ...base, leadId: "qualified", outreachEligible: true },
    { ...base, leadId: "unknown-company", outreachEligible: false },
    { ...base, leadId: "suppressed", contactable: false, outreachEligible: false },
  ];
  assert.deepEqual(
    outreachEligibleMembers(members).map((member) => member.leadId),
    ["qualified"],
  );
});

test("a first upload says what it imported and which audience holds it", () => {
  assert.deepEqual(
    summarizeLeadImport({
      added: 550,
      skipped_duplicate: 4,
      skipped_suppressed: 0,
      errors: [],
      audience: {
        id: "aud-1",
        name: "ai faire approved guest list from screenshots",
        member_count: 551,
        created: true,
      },
    }),
    {
      kind: "success",
      message:
        "Imported 550 people into “ai faire approved guest list from screenshots” · 4 duplicates skipped",
    },
  );
  assert.deepEqual(
    summarizeLeadImport({
      added: 1,
      skipped_duplicate: 0,
      skipped_suppressed: 2,
      errors: [{ row: 9, reason: "missing company" }],
      audience: { id: "aud-1", name: "warm intros", member_count: 1, created: true },
    }),
    {
      kind: "success",
      message: "Imported 1 person into “warm intros” · 2 suppressed · 1 invalid row",
    },
  );
});

test("an upload into an existing audience reports the new total", () => {
  assert.deepEqual(
    summarizeLeadImport({
      added: 12,
      skipped_duplicate: 539,
      skipped_suppressed: 0,
      errors: [],
      audience: { id: "aud-1", name: "conference wave two", member_count: 551, created: false },
    }),
    {
      kind: "success",
      message: "Added 12 people to “conference wave two” (551 total) · 539 duplicates skipped",
    },
  );
});

test("an all-duplicate re-upload reads as already done, not as a failure", () => {
  const notice = summarizeLeadImport({
    added: 0,
    skipped_duplicate: 551,
    skipped_suppressed: 0,
    errors: [],
    audience: {
      id: "aud-1",
      name: "ai faire approved guest list from screenshots",
      member_count: 551,
      created: false,
    },
  });
  assert.deepEqual(notice, {
    kind: "info",
    message:
      "Everything in this file is already imported · “ai faire approved guest list from screenshots” has all 551 people",
  });
  assert.notEqual(notice.kind, "error");
  assert.notEqual(notice.message, "No new leads");
});

test("a file with no resolvable rows is an error with the first row reasons", () => {
  assert.deepEqual(
    summarizeLeadImport({
      added: 0,
      skipped_duplicate: 0,
      skipped_suppressed: 0,
      errors: [
        { row: 2, reason: "missing company" },
        { row: 3, reason: "missing company" },
        { row: 4, reason: "empty row" },
        { row: 5, reason: "missing company" },
      ],
      audience: null,
    }),
    {
      kind: "error",
      message: "Nothing imported · 4 invalid rows",
      details: ["Row 2: missing company", "Row 3: missing company", "Row 4: empty row"],
      hint: "Every row needs a company. Add a company column and upload the file again.",
    },
  );
});

test("a response without the audience field still summarizes sensibly", () => {
  assert.deepEqual(
    summarizeLeadImport({
      added: 4,
      skipped_duplicate: 2,
      skipped_suppressed: 1,
      errors: [{ row: 7, reason: "missing company" }],
    }),
    {
      kind: "success",
      message: "Imported 4 people · 2 duplicates skipped · 1 suppressed · 1 invalid row",
    },
  );
});

test("provider slugs render as capability labels, never vendor names", () => {
  assert.equal(providerLabel("csv_upload"), "CSV upload");
  assert.equal(providerLabel("orange_slice"), "Lead search");
  assert.equal(providerLabel("workspace"), "Workspace");
  // An unrecognized slug must never title-case a vendor name into the UI.
  assert.equal(providerLabel("some_new_vendor"), "Imported");
});

const MEMBER = {
  leadId: "l1",
  name: "Dana Whitfield",
  title: "VP Ops",
  company: "Meridian",
  email: "dana@meridian.test",
  linkedinUrl: "https://www.linkedin.com/in/dana",
  stage: "demo_built",
  contactable: true,
  outreachEligible: true,
};

test("a member's source is its own, else the audience's, else unknown", () => {
  assert.equal(memberFoundBy({ ...MEMBER, foundBy: "agent" }, { sourceProvider: "orange_slice" }), "agent");
  assert.equal(memberFoundBy(MEMBER, { sourceProvider: "orange_slice" }), "lead_search");
  assert.equal(memberFoundBy(MEMBER, { sourceProvider: "csv_upload" }), "upload");
  assert.equal(memberFoundBy(MEMBER, { sourceProvider: "workspace" }), null);
  assert.equal(FOUND_BY_LABELS.lead_search, "Lead search");
});

test("source chips count each source, largest first, after All", () => {
  const members = [
    { ...MEMBER, leadId: "a", foundBy: "lead_search" as const },
    { ...MEMBER, leadId: "b", foundBy: "lead_search" as const },
    { ...MEMBER, leadId: "c", foundBy: "upload" as const },
  ];
  assert.deepEqual(foundByCounts(members, { sourceProvider: "workspace" }), [
    { id: "all", label: "All", count: 3 },
    { id: "lead_search", label: "Lead search", count: 2 },
    { id: "upload", label: "CSV upload", count: 1 },
  ]);
  assert.deepEqual(
    filterMembers(members, { sourceProvider: "workspace" }, "upload", "").map((m) => m.leadId),
    ["c"],
  );
  assert.deepEqual(
    filterMembers(members, { sourceProvider: "workspace" }, "all", "  MERIDIAN ").length,
    3,
  );
});

test("the CSV export quotes what needs quoting and never writes a formula", () => {
  const csv = membersCsv(
    [
      { ...MEMBER, foundBy: "lead_search", addedAt: "2026-09-20T12:00:00Z" },
      { ...MEMBER, leadId: "l2", name: "=HYPERLINK(\"x\")", title: "Role not set", company: "Acme, Inc.", email: "Email not set", linkedinUrl: null },
    ],
    { sourceProvider: "csv_upload" },
  );
  assert.equal(
    csv,
    "Name,Title,Company,Email,LinkedIn,Stage,Found by,Added\r\n" +
      "Dana Whitfield,VP Ops,Meridian,dana@meridian.test,https://www.linkedin.com/in/dana,Demo Built,Lead search,2026-09-20\r\n" +
      "\"'=HYPERLINK(\"\"x\"\")\",,\"Acme, Inc.\",,,Demo Built,CSV upload,\r\n",
  );
  assert.equal(csvFilename("Qualified QA leaders!"), "qualified-qa-leaders.csv");
  assert.equal(csvFilename("  "), "audience.csv");
});
