/* The number beside Demos in the customer sidebar.

   Only a number that asks for an action earns a badge. When the customer's
   own team approves, the count is what is waiting for them. When Driftwood
   approves, nothing waits on them, so there is no badge at all: the queue
   is Flow's business, and a four-figure count beside Demos read as work
   that was not there.

   The policy read is tiny and comes first, so the reviews list is only
   fetched for a team that approves; the Demos page shares that promise, so
   opening the page costs no extra request. */

import { useEffect, useState } from "react";
import { approvalPolicy, fetchReviewsPage, firstReviewsPage } from "./staging-api";
import { groupStagedDemos, readyForYou } from "./staging-model";

/* The Demos page fires this after a decision, so the badge beside it never
   disagrees with the list the customer is looking at. */
export const DEMOS_COUNT_CHANGED = "driftwood:demos-count-changed";

export function announceDemosCountChanged() {
  window.dispatchEvent(new Event(DEMOS_COUNT_CHANGED));
}

export async function demosNavCount(fresh = false): Promise<number> {
  const policy = await approvalPolicy();
  if (policy.mode === "auto") return 0;
  const page = await (fresh ? fetchReviewsPage(0) : firstReviewsPage());
  return readyForYou(groupStagedDemos(page.pending)).length;
}

/* null until the count is known, and it stays null when the read fails —
   a wrong number beside a nav item is worse than no number. */
export function useDemosNavCount(active: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    let live = true;
    const read = (fresh: boolean) =>
      demosNavCount(fresh).then(
        (value) => {
          if (live) setCount(value);
        },
        () => {},
      );
    void read(false);
    const again = () => void read(true);
    window.addEventListener(DEMOS_COUNT_CHANGED, again);
    return () => {
      live = false;
      window.removeEventListener(DEMOS_COUNT_CHANGED, again);
    };
  }, [active]);

  return count;
}
