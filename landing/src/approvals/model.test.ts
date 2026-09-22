import assert from 'node:assert/strict';
import test from 'node:test';
import { isPolicyDirty, parsePolicy, reviewerFor, type ApprovalPolicy } from './model.ts';
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
