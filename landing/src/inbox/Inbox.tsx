import { getPolicy, approveItems } from '../approvals/api';
import { driftwoodApproves, type ApprovalPolicy } from '../approvals/model';
import { useWorkspacePermissions } from '../dashboard/workspace-permissions-context';
import '../approvals/approvals.css';
import { useEffect, useState } from 'react';
import { analyticsWindow, formatObservedAt, formatReplyBody } from '../analytics/model';
import { EmailPreview } from '../EmailPreview';
import { withMockMode } from '../mock-mode';
import { FEEDS, feedLabels, loadFeed, type Feed, type FeedPage } from './api';
import { filterMessages, rowStatusLabel, waitsOnDriftwood, type InboxFilter } from './model';
import './inbox.css';
/* "Needs approval" exists only where the customer's own team approves. On
   auto approval nothing waits on them, and drafts in Driftwood's final check
   are listed under Queued, so a second queue-shaped tab would only confuse. */
const ALL_FILTERS: ReadonlyArray<readonly [InboxFilter, string]> = [['queued','Queued'],['pending','Needs approval'],['sent','Sent'],['reply','Replies']];
function filterFromUrl(): InboxFilter {
 const tab = new URLSearchParams(window.location.search).get('tab');
 return tab === 'sent' ? 'sent' : tab === 'pending' ? 'pending' : tab === 'replies' ? 'reply' : 'queued';
}
type Snapshot = { pages: Partial<Record<Feed,FeedPage>>; errors: Partial<Record<Feed,string>> };
export default function Inbox() {
 const {canWrite} = useWorkspacePermissions();
 const [policy,setPolicy] = useState<ApprovalPolicy | null>(null);
 const [policyError,setPolicyError] = useState<string | null>(null);
 const [decisionBusy,setDecisionBusy] = useState(false);
 const [decisionNotice,setDecisionNotice] = useState<string | null>(null);
 const [armed,setArmed] = useState<string | null>(null);
 const [range, setRange] = useState(() => analyticsWindow(30));
 const [data, setData] = useState<Snapshot>({pages:{},errors:{}});
 const [busy,setBusy] = useState(true);
 const [request,setRequest] = useState({offsets:Object.fromEntries(FEEDS.map((f) => [f,0])) as Partial<Record<Feed,number>>, append:false, revision:0});
 const [chosenFilter,setFilter] = useState<InboxFilter>(filterFromUrl);
 const [query,setQuery] = useState('');
 const [channel,setChannel] = useState('all');
 const [replyKind,setReplyKind] = useState('all');
 const [selected,setSelected] = useState<string | null>(null);
 useEffect(() => {
  const controller = new AbortController();
  getPolicy(controller.signal).then((p) => {if (!controller.signal.aborted) {setPolicy(p);setPolicyError(null);}}).catch((e) => {if (!controller.signal.aborted) {setPolicy(null);setPolicyError(e.message);}});
  const feeds = FEEDS.filter((feed) => request.offsets[feed] !== undefined);
  void Promise.allSettled(feeds.map((feed) => loadFeed(feed,request.offsets[feed]!,range,controller.signal))).then((results) => {
   if (controller.signal.aborted) return;
   setData((previous) => {
    const next: Snapshot = request.append ? {pages:{...previous.pages},errors:{...previous.errors}} : {pages:{},errors:{}};
    results.forEach((result,i) => {
     const feed = feeds[i];
     if (result.status === 'rejected') { next.errors[feed] = result.reason instanceof Error ? result.reason.message : 'Could not load'; return; }
     delete next.errors[feed];
     const combined = request.append ? [...(previous.pages[feed]?.rows ?? []),...result.value.rows] : result.value.rows;
     next.pages[feed] = {rows:[...new Map(combined.map((row) => [row.id,row])).values()],next:result.value.next};
    });
    return next;
   });
   setBusy(false);
  });
  return () => controller.abort();
 },[range,request]);
 const customerApproves = policy !== null && !driftwoodApproves(policy.mode);
 const FILTERS = ALL_FILTERS.filter(([value]) => value !== 'pending' || customerApproves);
 /* A link to Needs approval on a workspace without it lands on Queued. */
 const filter: InboxFilter = chosenFilter === 'pending' && !customerApproves ? 'queued' : chosenFilter;
 const rows = [...new Map(Object.values(data.pages).flatMap((page) => page.rows).map((row) => [row.id,row])).values()];
 const filtered = filterMessages(rows,filter,query,channel,replyKind);
 const canApprove = (row: typeof rows[number]) => canWrite && !busy && !policyError && policy && row.status === 'approval' && row.reviewer === 'customer' && row.canDecide && row.approvalVersion === policy.version;
 const approvable = filtered.filter(canApprove);
 const current = filtered.find((row) => row.id === selected) ?? filtered[0];
 const more = Object.entries(data.pages).filter(([,page]) => page.next !== null);
 function refresh() { setBusy(true);setRange(analyticsWindow(30));setRequest((r) => ({offsets:Object.fromEntries(FEEDS.map((f) => [f,0])),append:false,revision:r.revision+1})); }
 async function approve(ids: string[]) {
  if (!policy || decisionBusy || !ids.length) return;
  const signature = JSON.stringify(ids);
  if (armed !== signature) {setArmed(signature);return;}
  setDecisionBusy(true);setDecisionNotice(null);
  try {const result = await approveItems(ids,policy.version);setDecisionNotice(`${result.approved} approved and moved to Queued.${result.skipped.length ? ` ${result.skipped.length} could not be approved; the list has been refreshed.` : ''}`);refresh();}
  catch(e) {setDecisionNotice(e instanceof Error ? e.message : 'Could not approve messages.');refresh();}
  finally {setDecisionBusy(false);setArmed(null);}
 }
 return <section className="inbox-page">
  <header className="inbox-heading"><div><h1>Inbox</h1><p>Sent messages, upcoming outreach, and replies in one place.</p></div><button onClick={refresh} disabled={busy}>Refresh</button></header>
  {policyError && <p className="inbox-feed-error" role="alert">Approval settings did not load, so drafts waiting on your team are not shown. <button onClick={refresh} disabled={busy}>Retry</button></p>}
  <nav className="inbox-status-tabs" aria-label="Message status">{FILTERS.map(([value,label]) => <button key={value} aria-pressed={filter === value} onClick={() => {setFilter(value);setSelected(null);setArmed(null);}}>{label}</button>)}</nav>
  <div className="inbox-toolbar"><input type="search" aria-label="Search messages" placeholder="Search people, companies, or messages" value={query} onChange={(e) => setQuery(e.target.value)} /><select aria-label="Message channel" value={channel} onChange={(e) => setChannel(e.target.value)}>{['all','Email','LinkedIn','X'].map((c) => <option key={c} value={c}>{c === 'all' ? 'All channels' : c}</option>)}</select>{filter === 'reply' && <div aria-label="Reply type">{[['all','All replies'],['human','People'],['automatic','Automatic']].map(([value,label]) => <button key={value} aria-pressed={replyKind === value} onClick={() => setReplyKind(value)}>{label}</button>)}</div>}</div>
  {filter === 'pending' && <div className="inbox-pending-actions"><p>Your team approves these before they get a send time. <a href={withMockMode('/dashboard/settings?tab=approvals')}>{canWrite ? 'Change who approves' : 'See who approves'}</a></p>{approvable.length > 0 && <button className="approval-primary" disabled={decisionBusy || busy} onClick={() => void approve(approvable.map((row) => row.reviewId!))}>{armed === JSON.stringify(approvable.map((row) => row.reviewId!)) ? `Confirm approval of ${approvable.length} messages` : `Approve ${approvable.length} visible messages`}</button>}{armed && <button onClick={() => setArmed(null)}>Cancel</button>}</div>}
  {decisionNotice && <p role="status">{decisionNotice}</p>}
  <p className="inbox-count">{filtered.length} matching {filtered.length === 1 ? "message" : "messages"} loaded · replies from the last 30 days{more.length ? ' · more activity available below' : ''}</p>
  {Object.entries(data.errors).map(([feed,error]) => <p className="inbox-feed-error" role="alert" key={feed}>{feedLabels[feed as Feed]} could not load: {error} <button onClick={refresh} disabled={busy}>Retry</button></p>)}
  {busy && <p role="status">Loading activity…</p>}
  {!busy || rows.length > 0 ? <div className="inbox-layout">
   <div className="inbox-list" aria-label="Messages">{filtered.length === 0 ? <div className="inbox-empty"><h2>No matching messages</h2><p>{Object.keys(data.errors).length ? 'Some activity is unavailable. Retry the failed sources above.' : more.length ? 'Load more activity or change the filters.' : 'Sent and queued outreach will appear here alongside replies.'}</p><a href={withMockMode('/dashboard/flow')}>Open flow →</a></div> : filtered.map((row) => <button key={row.id} className={current === row ? 'is-active' : ''} onClick={() => {setSelected(row.id);setArmed(null);}} aria-pressed={current === row}><span className="inbox-avatar">{row.name.slice(0,1)}</span><span><strong>{row.name}</strong><small>{row.company ?? 'Company unavailable'} · {row.channel}</small><p>{row.subject ?? row.body ?? 'Message content unavailable'}</p><span className={`inbox-status is-${waitsOnDriftwood(row) ? 'queued' : row.status}`}>{rowStatusLabel(row)}</span></span></button>)}</div>
   {current ? <article className="inbox-message"><header><span>{current.channel} · {rowStatusLabel(current)}</span><h2>{current.subject || (current.status === 'reply' ? 'Reply from your prospect' : 'Outbound message')}</h2><p>{current.status === 'reply' ? 'From' : 'To'} {current.name} · {formatObservedAt(current.at)}</p></header>
    {(current.status === 'queued' || current.status === 'sending') && <aside>{current.status === 'sending' ? 'Sending is in progress.' : `Scheduled for ${current.projectedDate ?? (current.dueAt ? formatObservedAt(current.dueAt) : 'the next available send window')}. Delivery may move to respect sending limits.`}</aside>}
    {current.status === 'approval' && <aside>{waitsOnDriftwood(current) ? 'Driftwood checks every message before it gets a send time.' : 'Waiting for your team to approve.'} Nothing has been sent.</aside>}
    {current.status === 'failed' && <aside className="inbox-failure">Not delivered. {current.reason || 'No failure reason was recorded.'}</aside>}
    {current.automatic && <aside>Automatic response{current.reason ? `: ${current.reason}` : ''}</aside>}
    {current.channel === 'Email' && current.status !== 'reply' && current.body ? <div className="inbox-outbound-body"><EmailPreview subject={null} body={current.body} /></div> : <div className="inbox-body">{current.body ? formatReplyBody(current.body) : 'Message content is unavailable for this record.'}</div>}
    <footer>{canApprove(current) && <button className="approval-primary" disabled={decisionBusy || busy} onClick={() => void approve([current.reviewId!])}>{armed === JSON.stringify([current.reviewId!]) ? 'Confirm approval' : 'Approve message'}</button>}{(current.status === 'reply' || current.status === 'sent') && <p>{current.status === 'reply' ? 'Continue the full conversation in your sending account.' : 'This is the message recorded by the sending system as sent.'}</p>}{current.status === 'reply' && current.channel === 'Email' && current.email && <a href={`mailto:${encodeURIComponent(current.email)}?subject=${encodeURIComponent(`Re: ${current.subject ?? ''}`)}`}>Compose in email app ↗</a>}</footer>
   </article> : <div className="inbox-empty">Choose a message to see its content and delivery status.</div>}
   {current && <aside className="inbox-context"><h2>Prospect</h2><strong>{current.name}</strong><p>{current.title}</p><p>{current.company}</p><p>{current.email}</p><a href={withMockMode('/dashboard/leads')}>View contacts →</a><hr /><h2>Delivery status</h2><strong>{rowStatusLabel(current)}</strong><p>{current.channel}</p><a href={withMockMode('/dashboard/flow')}>See the flow →</a></aside>}
  </div> : null}
  {more.length > 0 && <div className="inbox-pagination"><button disabled={busy} onClick={() => {setBusy(true);setRequest((r) => ({offsets:Object.fromEntries(more.map(([feed,page]) => [feed,page.next!])),append:true,revision:r.revision+1}));}}>Load more activity</button></div>}
 </section>;
}
