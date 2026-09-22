import type { ReviewItem } from "./staging-model";

export type DemoSendList = {
  id: string;
  name: string;
  created_at: string;
  email_count: number;
  pending_count: number;
};

export type DemoSendListDetail = DemoSendList & {
  items: ReviewItem[];
  changed_item_ids: string[];
};

export function pendingListItems(list: DemoSendListDetail): ReviewItem[] {
  return list.items.filter((item) => item.status === "pending");
}

export function sendListBlock(list: DemoSendListDetail): string | undefined {
  const pending = pendingListItems(list);
  if (list.changed_item_ids.length) return "A recipient or draft changed. Ask your agent to prepare a new list.";
  if (!pending.length) return "This list has no emails left to approve.";
  if (pending.some((item) => !item.can_decide)) return "Some emails need approval from another reviewer.";
  if (pending.some((item) => !item.lead?.email || item.kind !== "send_email")) return "Every item needs a complete email and recipient.";
  if (new Set(pending.map((item) => item.approval_policy_version)).size !== 1) return "Review settings changed. Refresh this list.";
  return undefined;
}
