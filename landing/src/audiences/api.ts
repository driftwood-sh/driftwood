import type {
  Audience,
  AudienceFilters,
  AudienceMember,
  AudienceSummary,
  DiscoveryCandidate,
  DiscoveryStatus,
  DiscoveryResult,
  LeadImportResult,
} from "./model";

type RawAudienceSummary = {
  source_kind?: AudienceSummary["sourceKind"];
  tags?: string[];
  id: string;
  name: string;
  description: string;
  source_provider: string;
  member_count: number;
  created_at: string;
  updated_at: string;
};

type RawMember = {
  lead_id: string;
  name: string | null;
  title: string | null;
  company: string;
  email: string | null;
  linkedin_url: string | null;
  stage: string;
  contactable: boolean;
  outreach_eligible: boolean;
  found_by?: AudienceMember["foundBy"];
  added_at?: string | null;
};

type RawAudience = RawAudienceSummary & {
  discovery_filters: Record<string, string>;
  members: RawMember[];
};

type RawCandidate = Omit<RawMember, "contactable" | "lead_id" | "found_by" | "added_at"> & {
  lead_id: string | null;
  provider_record_id: string;
};

export class AudienceApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as {
        error?: { detail?: string };
        detail?: string;
      };
      message = body.error?.detail ?? body.detail ?? message;
    } catch {
      // Keep the status fallback for a non-JSON proxy error.
    }
    throw new AudienceApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function mapMember(raw: RawMember): AudienceMember {
  return {
    leadId: raw.lead_id,
    name: raw.name ?? "Unnamed lead",
    title: raw.title ?? "Role not set",
    company: raw.company,
    email: raw.email ?? "Email not set",
    linkedinUrl: raw.linkedin_url,
    stage: raw.stage,
    contactable: raw.contactable,
    outreachEligible: raw.outreach_eligible,
    foundBy: raw.found_by,
    addedAt: raw.added_at ?? null,
  };
}

export function mapAudienceSummary(raw: RawAudienceSummary): AudienceSummary {
  return {
    id: raw.id,
    name: raw.name,
    description: raw.description,
    sourceProvider: raw.source_provider,
    sourceKind: raw.source_kind,
    tags: raw.tags ?? [],
    memberCount: raw.member_count,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

function mapAudience(raw: RawAudience): Audience {
  return {
    ...mapAudienceSummary(raw),
    discoveryFilters: raw.discovery_filters,
    members: raw.members.map(mapMember),
  };
}

function mapCandidate(raw: RawCandidate): DiscoveryCandidate {
  return {
    leadId: raw.lead_id,
    providerRecordId: raw.provider_record_id,
    name: raw.name ?? "Unnamed lead",
    title: raw.title ?? "Role not set",
    company: raw.company,
    email: raw.email ?? "Email not set",
    linkedinUrl: raw.linkedin_url,
    stage: raw.stage,
  };
}

export async function listAudiences(): Promise<AudienceSummary[]> {
  const body = await requestJson<{ audiences: RawAudienceSummary[] }>(
    "/api/v1/dashboard/audiences",
  );
  return body.audiences.map(mapAudienceSummary);
}

export async function getAudience(id: string): Promise<Audience> {
  const body = await requestJson<RawAudience>(
    `/api/v1/dashboard/audiences/${encodeURIComponent(id)}`,
  );
  return mapAudience(body);
}

export async function discoverAudienceLeads(
  filters: AudienceFilters,
  sourceProvider: "orange_slice" | "workspace",
): Promise<DiscoveryResult> {
  const body = await requestJson<{
    provider: string;
    provider_label: string;
    candidates: RawCandidate[];
  }>("/api/v1/dashboard/audiences/discover", {
    method: "POST",
    body: JSON.stringify({ ...filters, source_provider: sourceProvider, limit: 100 }),
  });
  return {
    provider: body.provider,
    providerLabel: body.provider_label,
    candidates: body.candidates.map(mapCandidate),
  };
}

export async function getDiscoveryStatus(): Promise<DiscoveryStatus> {
  const body = await requestJson<{
    default_provider: "orange_slice" | "workspace";
    providers: Array<{
      provider: "orange_slice" | "workspace";
      label: string;
      configured: boolean;
    }>;
  }>("/api/v1/dashboard/audiences/discovery-status");
  return {
    defaultProvider: body.default_provider,
    providers: body.providers,
  };
}

export async function uploadLeadList(
  file: File,
  audienceName = "",
): Promise<LeadImportResult> {
  const body = new FormData();
  body.append("file", file);
  // A typed name beats the filename-derived default server-side.
  if (audienceName.trim()) body.append("audience_name", audienceName.trim());
  const response = await fetch("/api/v1/imports/leads", {
    method: "POST",
    credentials: "include",
    body,
  });
  if (!response.ok) {
    let message = "The CSV could not be imported.";
    try {
      const payload = (await response.json()) as {
        error?: { detail?: string };
        detail?: string;
      };
      message = payload.error?.detail ?? payload.detail ?? message;
    } catch {
      // Preserve the concise fallback for a non-JSON proxy response.
    }
    throw new AudienceApiError(message, response.status);
  }
  return (await response.json()) as LeadImportResult;
}

export type SaveAudienceInput = {
  name: string;
  description: string;
  sourceProvider: string;
  discoveryFilters: AudienceFilters;
  leadIds: string[];
  providerRecordIds: string[];
};

function writeBody(input: SaveAudienceInput) {
  return JSON.stringify({
    name: input.name,
    description: input.description,
    source_provider: input.sourceProvider,
    discovery_filters: input.discoveryFilters,
    lead_ids: input.leadIds,
    provider_record_ids: input.providerRecordIds,
  });
}

export async function createAudience(input: SaveAudienceInput): Promise<Audience> {
  const body = await requestJson<RawAudience>("/api/v1/dashboard/audiences", {
    method: "POST",
    body: writeBody(input),
  });
  return mapAudience(body);
}

export async function findSimilarPeople(id: string): Promise<DiscoveryResult> {
  const body = await requestJson<{
    provider: string;
    provider_label: string;
    candidates: RawCandidate[];
  }>(`/api/v1/dashboard/audiences/${encodeURIComponent(id)}/similar`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  return {
    provider: body.provider,
    providerLabel: body.provider_label,
    candidates: body.candidates.map(mapCandidate),
  };
}

export async function growAudience(
  id: string,
  input: { providerRecordIds: string[]; leadIds: string[] },
): Promise<Audience> {
  const body = await requestJson<RawAudience>(
    `/api/v1/dashboard/audiences/${encodeURIComponent(id)}/grow`,
    {
      method: "POST",
      body: JSON.stringify({
        provider_record_ids: input.providerRecordIds,
        lead_ids: input.leadIds,
      }),
    },
  );
  return mapAudience(body);
}

export async function renameAudience(
  id: string,
  name: string,
): Promise<Audience> {
  const body = await requestJson<RawAudience>(
    `/api/v1/dashboard/audiences/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  return mapAudience(body);
}

export async function updateAudience(
  id: string,
  input: SaveAudienceInput,
): Promise<Audience> {
  const body = await requestJson<RawAudience>(
    `/api/v1/dashboard/audiences/${encodeURIComponent(id)}`,
    { method: "PUT", body: writeBody(input) },
  );
  return mapAudience(body);
}

export async function deleteAudience(id: string): Promise<void> {
  await requestJson<void>(`/api/v1/dashboard/audiences/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function saveAudienceTags(id: string, tags: string[]): Promise<Audience> {
  const raw = await requestJson<RawAudience>(`/api/v1/dashboard/audiences/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify({ tags }),
  });
  if (!raw.tags || JSON.stringify([...raw.tags].sort()) !== JSON.stringify([...tags].sort())) throw new Error("Tags were not saved. This backend needs the audience tags update.");
  return mapAudience(raw);
}
