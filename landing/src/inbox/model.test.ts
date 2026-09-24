import assert from 'node:assert/strict';
import test from 'node:test';
import { fromSend, fromApproval, filterMessages, rowStatusLabel, type SendRecord } from './model.ts';
const send: SendRecord = { id:'s1',kind:'email',status:'pending',note:'A demo for your team',subject:'Your demo',created_at:'2026-09-01T12:00:00Z',due_at:'2026-09-02T12:00:00Z',sent_at:null,projected_date:'2026-09-03',lead:{name:'Sam',company:'Example',title:'Founder'},error:null };
test('pending messages stay queued and retain their projected delivery date', () => {
 const row = fromSend(send)!;
 assert.equal(row.status,'queued');assert.equal(row.projectedDate,'2026-09-03');assert.equal(row.body,send.note);
 assert.equal(fromSend({...send,status:'canceled'}),null);
});
test('sent rows use the actual send timestamp, not scheduled or creation time', () => {
 const row = fromSend({...send,status:'sent',sent_at:'2026-09-04T12:00:00Z'})!;
 assert.equal(row.status,'sent');assert.equal(row.at,'2026-09-04T12:00:00Z');
});
test('Queued excludes pending approvals, sent messages and replies', () => {
 const rows = ['pending','sending','failed','sent'].map((status) => fromSend({...send,id:status,status})!);
 rows.push(fromApproval({id:'approval',kind:'send_email',status:'pending',subject:'Hello',body:'Draft',created_at:send.created_at,lead:send.lead})!);
 rows.push({...rows[0],id:'reply',status:'reply'});
 assert.deepEqual(new Set(filterMessages(rows,'queued','','all','all').map((row) => row.status)),new Set(['queued','sending','failed']));
 assert.deepEqual(filterMessages(rows,'pending','','all','all').map((row) => row.status),['approval']);
 assert.equal(filterMessages(rows,'sent','Example','Email','all').length,1);
 assert.equal(filterMessages(rows,'sent','','LinkedIn','all').length,0);
});
test("drafts in Driftwood review read as queued; only the team's own approvals are pending", () => {
 const base = {kind:'send_email',status:'pending',subject:'Hello',body:'Draft',created_at:send.created_at,lead:send.lead};
 const scheduled = fromSend(send)!;
 const checking = fromApproval({...base,id:'d',reviewer:'driftwood'})!;
 const yours = fromApproval({...base,id:'c',reviewer:'customer',can_decide:true})!;
 const unassigned = fromApproval({...base,id:'u'})!;
 const rows = [checking,yours,unassigned,scheduled];
 assert.deepEqual(filterMessages(rows,'queued','','all','all').map((row) => row.id),['send:s1','approval:d']);
 assert.deepEqual(filterMessages(rows,'pending','','all','all').map((row) => row.id).sort(),['approval:c','approval:u']);
 assert.equal(rowStatusLabel(checking),'Final check');
 assert.equal(rowStatusLabel(yours),'Needs your approval');
 assert.equal(rowStatusLabel(scheduled),'Scheduled');
});
test('approval feed includes only pending outreach, excluding internal system reviews', () => {
 const row = {id:'a',kind:'send_email',status:'pending',subject:'Hello',body:'Draft',created_at:send.created_at,lead:send.lead};
 assert.equal(fromApproval(row)?.status,'approval');
 assert.equal(fromApproval({...row,kind:'drift_task_install'}),null);
 assert.equal(fromApproval({...row,status:'approved'}),null);
});
test('missing review permissions never grant customer approval', () => {
 const row = {id:'a',kind:'send_email',status:'pending',subject:'Hello',body:'Draft',created_at:send.created_at,lead:send.lead};
 assert.equal(fromApproval(row)?.canDecide,false);
 assert.equal(fromApproval({...row,reviewer:'customer',can_decide:true,approval_policy_version:3})?.approvalVersion,3);
});
