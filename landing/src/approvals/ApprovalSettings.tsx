import { useEffect, useState } from 'react';
import { useWorkspacePermissions } from '../dashboard/workspace-permissions-context';
import { listCampaigns } from '../campaigns/api';
import type { CampaignSummary } from '../campaigns/model';
import { getPolicy, savePolicy } from './api';
import { MODE_LABELS, MODE_DESCRIPTIONS, isPolicyDirty, type ApprovalMode, type ApprovalPolicy, type Reviewer } from './model';
import { withMockMode } from '../mock-mode';
import './approvals.css';
export default function ApprovalSettings() {
 const {canWrite} = useWorkspacePermissions();
 const [policy,setPolicy] = useState<ApprovalPolicy | null>(null);
 /* What the server holds; the form edits `policy` and Save waits until the two differ. */
 const [loaded,setLoaded] = useState<ApprovalPolicy | null>(null);
 const [campaigns,setCampaigns] = useState<CampaignSummary[] | null>(null);
 const [error,setError] = useState<string | null>(null);
 const [campaignError,setCampaignError] = useState(false);
 const [busy,setBusy] = useState(false);
 const [saved,setSaved] = useState(false);
 const [attempt,setAttempt] = useState(0);
 useEffect(() => {
  const controller = new AbortController();
  getPolicy(controller.signal).then((p) => {if (!controller.signal.aborted) {setPolicy(p);setLoaded(p);setError(null);}}).catch((e) => {if (!controller.signal.aborted) setError(e.message);});
  listCampaigns().then((rows) => {if (!controller.signal.aborted) {setCampaigns(rows);setCampaignError(false);}}).catch(() => {if (!controller.signal.aborted) setCampaignError(true);});
  return () => controller.abort();
 },[attempt]);
 const dirty = policy !== null && loaded !== null && isPolicyDirty(loaded,policy);
 return <section className="approval-settings"><header><h2>Who approves your outreach?</h2><p>Choose who reviews messages before they can be scheduled.</p></header>
 {error && <p role="alert">{error} <button onClick={() => {setAttempt((n) => n+1);setSaved(false);}}>Reload settings</button></p>}
 {!policy && !error && <p role="status">Loading approval settings…</p>}
 {policy && <form onSubmit={async (event) => {event.preventDefault();if (!canWrite || busy || !dirty) return;setBusy(true);setError(null);setSaved(false);try {const next = await savePolicy(policy);setPolicy(next);setLoaded(next);setSaved(true);}catch(e){setError(e instanceof Error ? e.message : 'Could not save settings.');}finally{setBusy(false);}}}>
  <fieldset disabled={!canWrite || busy}><legend className="sr-only">Approval mode</legend><div className="approval-options">{(['auto','manual','hybrid'] as ApprovalMode[]).map((mode) => <label className={policy.mode === mode ? 'is-selected' : ''} key={mode}><input type="radio" name="approval-mode" checked={policy.mode === mode} onChange={() => {setPolicy({...policy,mode});setSaved(false);}} /><strong>{MODE_LABELS[mode]}</strong><span>{MODE_DESCRIPTIONS[mode]}</span></label>)}</div>
  {policy.mode === 'hybrid' && <div className="approval-campaigns"><h3>Campaign reviewers</h3><p>Campaigns without an override, new campaigns, and messages outside a campaign are reviewed by Driftwood.</p>{campaignError ? <p role="alert">Campaigns could not load. Reload settings to try again.</p> : !campaigns ? <p role="status">Loading campaigns…</p> : campaigns.length === 0 ? <p>No campaigns yet. New campaigns will use Driftwood review.</p> : campaigns.map((c) => <label key={c.id}><span>{c.name}</span><select aria-label={`Reviewer for ${c.name}`} value={policy.campaign_reviewers[c.id] ?? 'driftwood'} onChange={(e) => {setPolicy({...policy,campaign_reviewers:{...policy.campaign_reviewers,[c.id]:e.target.value as Reviewer}});setSaved(false);}}><option value="driftwood">Driftwood</option><option value="customer">My team</option></select></label>)}</div>}
  </fieldset><p className="approval-note">Auto approval still includes a Driftwood review. Changes apply to pending and future messages; already approved messages stay in Queued.</p>
  <div className="approval-settings-footer">{canWrite ? <button className="approval-primary" disabled={busy || !dirty || (policy.mode === 'hybrid' && (!campaigns || campaignError))} title={busy ? 'Saving…' : !dirty ? 'Nothing changed' : undefined}>{busy ? 'Saving…' : 'Save approval settings'}</button> : <p>Only workspace owners and admins can change approval settings.</p>}<a href={withMockMode('/dashboard/inbox')}>Back to Inbox →</a>{saved && <span role="status">Approval settings saved.</span>}</div>
 </form>}
 </section>;
}
