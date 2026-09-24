/* How a member first reached the workspace. "lead_search" is the discovery
   search (and its company backfill); "agent" is anything else Driftwood's
   agent sourced. */
export type FoundBy = "lead_search" | "upload" | "agent" | "manual";

export type AudienceMember = {
  leadId: string;
  name: string;
  title: string;
  company: string;
  email: string;
  linkedinUrl: string | null;
  stage: string;
  contactable: boolean;
  outreachEligible: boolean;
  /* Absent from a backend that predates the field; memberFoundBy() falls back
     to the audience's own source. */
  foundBy?: FoundBy;
  addedAt?: string | null;
};

export type AudienceSource = "uploaded" | "campaign" | "curated" | "other";

export type AudienceSummary = {
  sourceKind?: AudienceSource;
  tags?: string[];
  id: string;
  name: string;
  description: string;
  sourceProvider: string;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type Audience = AudienceSummary & {
  discoveryFilters: Record<string, string>;
  members: AudienceMember[];
};

export type DiscoveryCandidate = Omit<AudienceMember, "contactable" | "outreachEligible" | "leadId"> & {
  providerRecordId: string;
  leadId: string | null;
};

export type DiscoveryResult = {
  provider: string;
  providerLabel: string;
  candidates: DiscoveryCandidate[];
};

export type DiscoveryProvider = {
  provider: "orange_slice" | "workspace";
  label: string;
  configured: boolean;
};

export type DiscoveryStatus = {
  defaultProvider: "orange_slice" | "workspace";
  providers: DiscoveryProvider[];
};

export type LeadImportAudience = {
  id: string;
  name: string;
  member_count: number;
  created: boolean;
};

export type LeadImportResult = {
  added: number;
  skipped_duplicate: number;
  skipped_suppressed: number;
  errors: Array<{ row: number; reason: string }>;
  // The csv_upload audience this import created or refreshed. Null when the
  // file produced no resolvable leads; absent from older backend responses.
  audience?: LeadImportAudience | null;
};

export type LeadImportNotice = {
  kind: "success" | "info" | "error";
  message: string;
  details?: string[];
  hint?: string;
};

export type AudienceFilters = {
  // The search is one sentence, translated server-side into Orange Slice
  // queries. Saved audiences persist it for reproducible re-runs.
  prompt: string;
};

export const EMPTY_FILTERS: AudienceFilters = {
  prompt: "",
};

export function filterAudiences(
  audiences: AudienceSummary[],
  query: string,
): AudienceSummary[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return audiences;
  return audiences.filter((audience) =>
    [audience.name, audience.description, audience.sourceProvider]
      .join(" ")
      .toLowerCase()
      .includes(normalized),
  );
}

export function toggleLead(
  selected: ReadonlySet<string>,
  leadId: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(leadId)) next.delete(leadId);
  else next.add(leadId);
  return next;
}

export function outreachEligibleMembers(
  members: AudienceMember[],
): AudienceMember[] {
  return members.filter((member) => member.contactable && member.outreachEligible);
}

const COMPANY_COLUMN_HINT =
  "Every row needs a company. Add a company column and upload the file again.";

function countNoun(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function invalidRows(count: number): string {
  return countNoun(count, "invalid row", "invalid rows");
}

// Four outcomes, in order: the file was unusable (error), the upload created
// an audience, it added people to an existing one, or everything in it was
// already imported (info, deliberately not styled like a failure).
export function summarizeLeadImport(result: LeadImportResult): LeadImportNotice {
  const audience = result.audience ?? null;
  const skipped: string[] = [];
  if (result.skipped_duplicate) {
    skipped.push(`${countNoun(result.skipped_duplicate, "duplicate", "duplicates")} skipped`);
  }
  if (result.skipped_suppressed) skipped.push(`${result.skipped_suppressed} suppressed`);
  if (result.errors.length) skipped.push(invalidRows(result.errors.length));
  const suffix = skipped.length ? ` · ${skipped.join(" · ")}` : "";

  if (!audience && result.added === 0 && !result.skipped_duplicate && !result.skipped_suppressed) {
    const notice: LeadImportNotice = {
      kind: "error",
      message: result.errors.length
        ? `Nothing imported · ${invalidRows(result.errors.length)}`
        : "Nothing imported",
      hint: COMPANY_COLUMN_HINT,
    };
    const details = result.errors.slice(0, 3).map((error) => `Row ${error.row}: ${error.reason}`);
    if (details.length) notice.details = details;
    return notice;
  }

  if (result.added > 0) {
    const people = countNoun(result.added, "person", "people");
    if (!audience) return { kind: "success", message: `Imported ${people}${suffix}` };
    if (audience.created) {
      return { kind: "success", message: `Imported ${people} into “${audience.name}”${suffix}` };
    }
    return {
      kind: "success",
      message: `Added ${people} to “${audience.name}” (${audience.member_count} total)${suffix}`,
    };
  }

  if (audience && result.skipped_duplicate) {
    const rest: string[] = [];
    if (result.skipped_suppressed) rest.push(`${result.skipped_suppressed} suppressed`);
    if (result.errors.length) rest.push(invalidRows(result.errors.length));
    const restSuffix = rest.length ? ` · ${rest.join(" · ")}` : "";
    return {
      kind: "info",
      message: `Everything in this file is already imported · “${audience.name}” has all ${countNoun(audience.member_count, "person", "people")}${restSuffix}`,
    };
  }

  return { kind: "info", message: `No new people imported${suffix}` };
}

/* Customer-facing source labels speak in capabilities, never vendor names
   (ux-principles rule 18): the discovery vendor is swappable plumbing, so
   its slug renders as "Lead search". Unknown slugs fall back to a generic
   word rather than title-casing a possible vendor name into the UI. */
const PROVIDER_LABELS: Record<string, string> = {
  csv_upload: "CSV upload",
  orange_slice: "Lead search",
  workspace: "Workspace",
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? "Imported";
}

/* Where each person came from, in capability words (rule 18: the search
   vendor is plumbing, so it reads as "Lead search", the name the search box
   already carries). */
export const FOUND_BY_LABELS: Record<FoundBy, string> = {
  lead_search: "Lead search",
  upload: "CSV upload",
  agent: "Driftwood",
  manual: "Added by hand",
};

/* A member's source, or the audience's when the member row does not carry
   one: a lead-search audience is lead search's finds, an upload is uploads.
   Null when neither says, which the table shows as a dash. */
export function memberFoundBy(member: AudienceMember, audience: Pick<AudienceSummary, "sourceProvider">): FoundBy | null {
  if (member.foundBy) return member.foundBy;
  if (audience.sourceProvider === "orange_slice") return "lead_search";
  if (audience.sourceProvider === "csv_upload") return "upload";
  return null;
}

export type MemberFilter = "all" | FoundBy;

/* The source chips over the member table: All, then each source that has
   anyone in it, largest first. */
export function foundByCounts(
  members: AudienceMember[],
  audience: Pick<AudienceSummary, "sourceProvider">,
): Array<{ id: MemberFilter; label: string; count: number }> {
  const counts = new Map<FoundBy, number>();
  for (const member of members) {
    const found = memberFoundBy(member, audience);
    if (found) counts.set(found, (counts.get(found) ?? 0) + 1);
  }
  const chips = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => ({ id, label: FOUND_BY_LABELS[id], count }));
  return [{ id: "all", label: "All", count: members.length }, ...chips];
}

export function filterMembers(
  members: AudienceMember[],
  audience: Pick<AudienceSummary, "sourceProvider">,
  filter: MemberFilter,
  query: string,
): AudienceMember[] {
  const normalized = query.trim().toLowerCase();
  return members.filter(
    (member) =>
      (filter === "all" || memberFoundBy(member, audience) === filter) &&
      (!normalized ||
        [member.name, member.title, member.company, member.email]
          .join(" ")
          .toLowerCase()
          .includes(normalized)),
  );
}

/* The placeholder words mapMember() writes for a missing value are display
   text, not data, so an export leaves those cells empty. */
const PLACEHOLDERS = new Set(["Unnamed lead", "Role not set", "Email not set"]);

function csvCell(value: string | null | undefined): string {
  const text = value && !PLACEHOLDERS.has(value) ? value : "";
  /* A leading = + - @ turns a cell into a formula in a spreadsheet. */
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function membersCsv(
  members: AudienceMember[],
  audience: Pick<AudienceSummary, "sourceProvider">,
): string {
  const header = ["Name", "Title", "Company", "Email", "LinkedIn", "Stage", "Found by", "Added"];
  const rows = members.map((member) => {
    const found = memberFoundBy(member, audience);
    return [
      member.name,
      member.title,
      member.company,
      member.email,
      member.linkedinUrl,
      stageLabel(member.stage),
      found ? FOUND_BY_LABELS[found] : "",
      member.addedAt ? member.addedAt.slice(0, 10) : "",
    ].map(csvCell).join(",");
  });
  return [header.join(","), ...rows].join("\r\n") + "\r\n";
}

/* "qualified-qa-leaders.csv" from the audience's name. */
export function csvFilename(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${slug || "audience"}.csv`;
}

export function formatAudienceDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function stageLabel(stage: string): string {
  return stage.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function audienceSource(audience: AudienceSummary): AudienceSource {
  if (audience.sourceKind) return audience.sourceKind;
  return audience.sourceProvider === "csv_upload" ? "uploaded" : "other";
}
