import { getChannelAnalytics } from '../analytics/api.ts';
import { fromApproval, fromReply, fromSend, type Message, type SendRecord, type ApprovalRecord } from './model.ts';
export type Feed = 'sent' | 'queue' | 'replies' | 'approvals';
export type FeedPage = { rows: Message[]; next: number | null };
export const FEEDS: Feed[] = ['queue', 'sent', 'replies', 'approvals'];
export const feedLabels: Record<Feed,string> = { queue:'Queued messages', sent:'Sent history', replies:'Replies', approvals:'Drafts in review' };
async function json<T>(path: string, signal: AbortSignal): Promise<T> {
 const res = await fetch(path, {credentials:'include', signal});
 if (!res.ok) throw new Error(`Unavailable (${res.status})`);
 return res.json() as Promise<T>;
}
export async function loadFeed(feed: Feed, offset: number, range: {start:string;end:string}, signal: AbortSignal): Promise<FeedPage> {
 if (feed === 'replies') {
  const page = await getChannelAnalytics({...range,status:'replied',channel:null,offset,limit:100,signal});
  return {rows:page.people.map(fromReply), next:page.people.length && offset + page.people.length < page.peopleTotal ? offset + page.people.length : null};
 }
 if (feed === 'approvals') {
  const page = await json<{pending:ApprovalRecord[];total_pending:number}>(`/api/v1/dashboard/reviews?limit=100&offset=${offset}`,signal);
  return {rows:page.pending.map(fromApproval).filter((r):r is Message => r !== null), next:page.pending.length && offset + page.pending.length < page.total_pending ? offset + page.pending.length : null};
 }
 const page = await json<{sends:SendRecord[];total:number}>(`/api/v1/dashboard/sends?${feed === 'sent' ? 'view=sent&' : ''}limit=100&offset=${offset}`,signal);
 if (feed === 'sent' && page.sends.some((row) => row.status !== 'sent')) throw new Error('This backend does not expose sent history yet.');
 return {rows:page.sends.map(fromSend).filter((r):r is Message => r !== null), next:page.sends.length && offset + page.sends.length < page.total ? offset + page.sends.length : null};
}
