import type { DemoApproval } from "./staging-model";

export type { DemoApproval };

export type Demo = {
  demo_id: string;
  lead_id: string | null;
  lead_name: string | null;
  company_name: string;
  description: string | null;
  artifact_id: string;
  name: string;
  content_type: string;
  content_url: string;
  preview_url?: string | null;
  created_at: string;
  updated_at: string;
  /* What the customer decided about this demo. Optional: the field is being
     added to the list response, so a client that ships first reads nothing
     and every card offers Approve. */
  approval?: DemoApproval | null;
};

export type DemosPage = { demos: Demo[]; total: number; limit: number; offset: number };
export type Sentiment = "general" | "looks_good" | "needs_changes";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: "include", ...init });
  if (!response.ok) {
    let message = `Request failed (${response.status}). Please try again.`;
    try {
      const body = await response.json();
      if (typeof body.error?.detail === "string") message = body.error.detail;
    } catch { /* Keep the status when the proxy returns a non-JSON error. */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function listDemos(query: string, offset: number, signal: AbortSignal): Promise<DemosPage> {
  // Deploy this client before the additive backend change. Older responses
  // contain only lead_id; normalize once so UI state always has a demo identity.
  const page = await request<DemosPage>(`/api/v1/dashboard/demos?${new URLSearchParams({ q: query, offset: String(offset), limit: "12" })}`, { signal });
  return { ...page, demos: page.demos.map((demo) => {
    const demoId = demo.demo_id ?? demo.lead_id;
    if (!demoId) throw new Error("This demo could not be loaded. Please refresh and try again.");
    return { ...demo, demo_id: demoId };
  }) };
}

/* The whole library, for Staging. A demo with no email yet has no review item
   and no send, so this read is the only place it exists.

   The endpoint caps limit at 50, so a big library arrives as pages.
   staging-api.ts memoizes the first page, the way it does the other firsts. */
export const LIBRARY_CHUNK = 50;

export async function fetchLibraryPage(offset: number): Promise<DemosPage> {
  return request<DemosPage>(
    `/api/v1/dashboard/demos?${new URLSearchParams({ q: "", offset: String(offset), limit: String(LIBRARY_CHUNK) })}`,
  );
}

export async function sendFeedback(demo: Demo, message: string, sentiment: Sentiment): Promise<void> {
  const result = await request<{ delivered: boolean }>(`/api/v1/dashboard/demos/${encodeURIComponent(demo.demo_id)}/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, sentiment, artifact_id: demo.artifact_id, artifact_updated_at: demo.updated_at }),
  });
  if (!result.delivered) throw new Error("Your feedback could not be delivered. Please try again.");
}
