/* Fetch + payload types for the admin drift endpoints. Same-origin relative
   paths (Vercel/Vite proxy make the backend first-party); raw payloads are
   passed to the pure model in model.ts. */

import type { DriftRun, FlowManifest, JudgmentLite } from "./model";

export type DriftAgentTally = {
  agent_id: string;
  states: Record<string, number>;
  total: number;
  in_flight: number;
};

export type DriftOverview = {
  refreshed_at: string;
  agents: DriftAgentTally[];
  flows: Record<string, FlowManifest>;
  tasks: string[];
};

export type DriftAgentRunsPage = {
  agent_id: string;
  refreshed_at: string;
  runs: DriftRun[];
};

export type JudgmentFull = JudgmentLite & {
  detail: Record<string, unknown> | null;
};

export type DriftRunDetail = Omit<DriftRun, "judgments"> & {
  judgments: JudgmentFull[];
};

export class WorkflowError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    ...init,
  });
  if (!res.ok) {
    let message = "This view could not load. Please try again.";
    let code = "request_failed";
    try {
      const body = await res.json();
      if (typeof body.error?.detail === "string") message = body.error.detail;
      if (typeof body.error?.code === "string") code = body.error.code;
    } catch {
      /* Keep an actionable proxy error. */
    }
    throw new WorkflowError(message, code);
  }
  return res.json() as Promise<T>;
}

export const fetchOverview = (signal?: AbortSignal) =>
  request<DriftOverview>("/api/v1/admin/drift/overview", { signal });

export const fetchAgentRuns = (
  agentId: string,
  limit = 25,
  signal?: AbortSignal,
) =>
  request<DriftAgentRunsPage>(
    `/api/v1/admin/drift/agents/${encodeURIComponent(agentId)}/runs?limit=${limit}`,
    { signal },
  );

export const fetchRunDetail = (runId: string, signal?: AbortSignal) =>
  request<DriftRunDetail>(
    `/api/v1/admin/drift/runs/${encodeURIComponent(runId)}`,
    { signal },
  );

export type PlanStage = {
  id: string;
  name: string;
  description: string;
  output: string;
  gate: boolean;
};
export type PlanField = {
  id: string;
  stage_id: string;
  label: string;
  placeholder: string;
  value: string;
  max_length: number;
};
export type WorkflowPlan = {
  task: string;
  title: string;
  description: string;
  version: string;
  editable: boolean;
  unavailable_reason: string | null;
  output: Record<string, string>;
  stages: PlanStage[];
  fields: PlanField[];
};
export const fetchPlans = (agentId: string, signal?: AbortSignal) =>
  request<{ plans: WorkflowPlan[] }>(
    `/api/v1/admin/drift/agents/${encodeURIComponent(agentId)}/plans`,
    { signal },
  );
export const savePlan = (
  agentId: string,
  plan: WorkflowPlan,
  changes: Record<string, string>,
) =>
  request<{ plan: WorkflowPlan; notification_delivered: boolean }>(
    `/api/v1/admin/drift/agents/${encodeURIComponent(agentId)}/plans/${encodeURIComponent(plan.task)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: plan.version, changes }),
    },
  );
