import assert from "node:assert/strict";
import test from "node:test";
import { pendingListItems, sendListBlock, type DemoSendListDetail } from "./send-list-model.ts";

function fixture(): DemoSendListDetail {
  return { id: "today", name: "Today", created_at: "2026-09-22", email_count: 2, pending_count: 1, changed_item_ids: [], items: ["pending", "approved"].map((status, i) => ({
    id: String(i), kind: "send_email", title: "A demo", body: "Exact copy", subject: "Demo", status,
    can_decide: true, approval_policy_version: 3, created_at: "2026-09-22", attachment_slug: null, evidence: null,
    lead: {lead_id: String(i), name: "Test", email: `test${i}@example.test`, company: "Test", title: "CTO", linkedin_url: null, stage: "new", prior_sends: 0, last_sent_at: null},
  })) };
}

test("only undecided items in the saved list are offered for approval", () => {
  const list = fixture();
  assert.deepEqual(pendingListItems(list).map((item) => item.id), ["0"]);
  assert.equal(sendListBlock(list), undefined);
  list.items[0].status = "superseded";
  assert.match(sendListBlock(list)!, /no emails left/);
});

test("changed recipients, reviewer assignments and policy versions block bulk approval", () => {
  const list = fixture();
  list.changed_item_ids = ["0"];
  assert.match(sendListBlock(list)!, /changed/);
  list.changed_item_ids = [];
  list.items[0].can_decide = false;
  assert.match(sendListBlock(list)!, /another reviewer/);
  list.items[0].can_decide = true;
  list.items[1].status = "pending";
  list.items[1].approval_policy_version = 4;
  assert.match(sendListBlock(list)!, /settings changed/);
});
