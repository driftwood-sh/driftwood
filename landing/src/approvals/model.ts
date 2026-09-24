export type ApprovalMode = 'auto' | 'manual' | 'hybrid' | 'autopilot';
export type Reviewer = 'customer' | 'driftwood';
export type ApprovalPolicy = { mode: ApprovalMode; campaign_reviewers: Record<string, Reviewer>; version: number; can_set_autopilot?: boolean };
export const MODE_LABELS: Record<ApprovalMode,string> = { auto:'Auto approval', manual:'Manual approval', hybrid:'Hybrid approval', autopilot:'Autopilot' };
export const MODE_DESCRIPTIONS: Record<ApprovalMode,string> = { auto:'Driftwood reviews and approves messages in our dashboard before they enter the sending queue.', manual:'Your workspace owners and admins review and approve messages in Pending before they enter the sending queue.', hybrid:'Choose who approves each campaign. Driftwood reviews messages from campaigns without an override.', autopilot:'Driftwood finds contacts, builds demos and prepares emails automatically, then reviews and approves them before they enter the sending queue. Only Driftwood can turn this on.' };
/* Autopilot is staff-only to turn on, so it is offered to Driftwood and to a
   workspace already on it (which can always switch back out), never otherwise.
   Decide from the loaded policy so switching away in the form keeps it listed. */
export function modeOptions(loaded: ApprovalPolicy): ApprovalMode[] {
 const modes: ApprovalMode[] = ['auto','manual','hybrid'];
 return loaded.mode === 'autopilot' || loaded.can_set_autopilot ? [...modes,'autopilot'] : modes;
}
/* Auto and Autopilot never wait on the customer's own team: Driftwood approves.
   Every "is there anything for the customer to approve?" check asks this. */
export function driftwoodApproves(mode: ApprovalMode): boolean {
 return mode === 'auto' || mode === 'autopilot';
}
/* Save stays disabled until the draft differs from what was loaded. A campaign
   with no override and one set to Driftwood are the same policy, so campaigns
   compare by the reviewer they resolve to, not by whether the key is present. */
export function isPolicyDirty(saved: ApprovalPolicy, draft: ApprovalPolicy): boolean {
 if (saved.mode !== draft.mode) return true;
 const ids = new Set([...Object.keys(saved.campaign_reviewers), ...Object.keys(draft.campaign_reviewers)]);
 for (const id of ids) if ((saved.campaign_reviewers[id] ?? 'driftwood') !== (draft.campaign_reviewers[id] ?? 'driftwood')) return true;
 return false;
}
export function reviewerFor(policy: ApprovalPolicy, campaignId: string | null): Reviewer {
 if (policy.mode === 'manual') return 'customer';
 if (driftwoodApproves(policy.mode)) return 'driftwood';
 return campaignId ? policy.campaign_reviewers[campaignId] ?? 'driftwood' : 'driftwood';
}
export function parsePolicy(value: unknown): ApprovalPolicy {
 if (!value || typeof value !== 'object') throw new Error('Approval settings are unavailable.');
 const row = value as Partial<ApprovalPolicy>;
 if (!row.mode || !Object.hasOwn(MODE_LABELS,row.mode) || (!Number.isInteger(row.version) || (row.version ?? 0) < 1) || !row.campaign_reviewers || typeof row.campaign_reviewers !== 'object' || Array.isArray(row.campaign_reviewers) || Object.values(row.campaign_reviewers).some((v) => v !== 'customer' && v !== 'driftwood')) throw new Error('Approval settings are unavailable.');
 return row as ApprovalPolicy;
}
