import assert from 'node:assert/strict';
import test from 'node:test';
import { driftwoodApproves, isPolicyDirty, modeOptions, parsePolicy, reviewerFor, type ApprovalPolicy } from './model.ts';
const policy: ApprovalPolicy = {mode:'hybrid',campaign_reviewers:{a:'customer',b:'driftwood'},version:1};
test('hybrid assigns by campaign and defaults unassigned messages to Driftwood', () => {
 assert.equal(reviewerFor(policy,'a'),'customer');
 for (const id of ['b','new',null]) assert.equal(reviewerFor(policy,id),'driftwood');
});
test('auto and manual override campaign assignments without bypassing review', () => {
 assert.equal(reviewerFor({...policy,mode:'auto'},'a'),'driftwood');
 assert.equal(reviewerFor({...policy,mode:'manual'},'b'),'customer');
 assert.equal(reviewerFor({...policy,mode:'manual'},null),'customer');
});
test('autopilot is reviewed by Driftwood and never waits on the customer', () => {
 assert.equal(reviewerFor({...policy,mode:'autopilot'},'a'),'driftwood');
 assert.equal(driftwoodApproves('autopilot'),true);
 assert.equal(driftwoodApproves('auto'),true);
 assert.equal(driftwoodApproves('manual'),false);
 assert.equal(driftwoodApproves('hybrid'),false);
});
test('autopilot is offered only to Driftwood or a workspace already on it', () => {
 assert.deepEqual(modeOptions(policy),['auto','manual','hybrid']);
 assert.deepEqual(modeOptions({...policy,can_set_autopilot:false}),['auto','manual','hybrid']);
 assert.deepEqual(modeOptions({...policy,can_set_autopilot:true}),['auto','manual','hybrid','autopilot']);
 assert.deepEqual(modeOptions({...policy,mode:'autopilot'}),['auto','manual','hybrid','autopilot']);
 assert.deepEqual(parsePolicy({...policy,mode:'autopilot',can_set_autopilot:false}).mode,'autopilot');
});
test('save is offered only when the mode or a campaign reviewer changed', () => {
 assert.equal(isPolicyDirty(policy,{...policy}),false);
 assert.equal(isPolicyDirty(policy,{...policy,mode:'auto'}),true);
 assert.equal(isPolicyDirty(policy,{...policy,campaign_reviewers:{a:'driftwood',b:'driftwood'}}),true);
 assert.equal(isPolicyDirty(policy,{...policy,campaign_reviewers:{a:'customer'}}),false);
 assert.equal(isPolicyDirty(policy,{...policy,campaign_reviewers:{...policy.campaign_reviewers,c:'driftwood'}}),false);
});
test('unavailable or malformed policy is rejected', () => {
 for (const value of [null,{}, {...policy,version:0}, {...policy,mode:'skip'}, {...policy,campaign_reviewers:[]}, {...policy,campaign_reviewers:{a:'anyone'}}]) assert.throws(() => parsePolicy(value));
 assert.deepEqual(parsePolicy(policy),policy);
});
