import { useCallback, useEffect, useState } from "react";
import { withMockMode } from "../mock-mode";
import DemoApprovals, { type ApprovalCounts, type ApprovalView } from "./DemoApprovals";
import DemoLibrary from "./DemoLibrary";
import { demosNavCount } from "./nav-count";
import { approvalPolicy } from "./staging-api";
import "./demos-page.css";

/* /dashboard/demos: the demos themselves, first and for everyone. A team
   that approves its own outreach (manual or hybrid review) also gets two
   views of what waits on it; on auto approval there is nothing to approve,
   so the page is the library alone. The queue lives on Flow and the sent
   history in Inbox. */

type View = "library" | ApprovalView;

const VIEWS: Array<[View, string]> = [
  ["library", "All demos"],
  ["demos", "Demos to approve"],
  ["emails", "Emails to approve"],
];

/* What the address asks for. The four-segment page's old ?seg= links keep
   working: its approval segments open the matching view, and its Queue and
   Sent segments now live on other pages. */
function viewFromUrl(): View {
  const params = new URLSearchParams(window.location.search);
  const view = params.get("view");
  if (view === "approve-demos") return "demos";
  if (view === "approve-emails") return "emails";
  const seg = params.get("seg");
  if (seg === "review" || params.has("send_list")) return "emails";
  if (seg === "staging") return "demos";
  return "library";
}

function redirectRetiredSegment(): boolean {
  const seg = new URLSearchParams(window.location.search).get("seg");
  if (seg === "queue") {
    window.location.replace(withMockMode("/dashboard/flow"));
    return true;
  }
  if (seg === "sent") {
    window.location.replace(withMockMode("/dashboard/inbox?tab=sent"));
    return true;
  }
  return false;
}

export default function DemosPage() {
  const [redirecting] = useState(redirectRetiredSegment);
  const [view, setView] = useState<View>(viewFromUrl);
  /* null until the policy lands. Until then the page is the library, which
     every workspace has; the approval views join once the policy says the
     team approves. */
  const [customerApproves, setCustomerApproves] = useState<boolean | null>(null);
  const [counts, setCounts] = useState<ApprovalCounts>({ demos: null, emails: null });

  useEffect(() => {
    let live = true;
    approvalPolicy().then(
      (policy) => {
        if (!live) return;
        setCustomerApproves(policy.mode !== "auto");
        if (policy.mode === "auto") return;
        /* The sidebar's number, so the switch and the badge agree before an
           approval view has loaded its own lists. */
        demosNavCount().then(
          (emails) => live && setCounts((prev) => (prev.emails === null ? { ...prev, emails } : prev)),
          () => {},
        );
      },
      () => live && setCustomerApproves(false),
    );
    return () => {
      live = false;
    };
  }, []);

  /* A view reports null while its lists are still arriving; the last known
     number stands until a whole one replaces it. */
  const onCounts = useCallback(
    (next: ApprovalCounts) =>
      setCounts((prev) => ({ demos: next.demos ?? prev.demos, emails: next.emails ?? prev.emails })),
    [],
  );

  function choose(next: View) {
    setView(next);
    const params = new URLSearchParams(window.location.search);
    params.delete("seg");
    if (next === "library") params.delete("view");
    else params.set("view", next === "demos" ? "approve-demos" : "approve-emails");
    if (next !== "emails") params.delete("send_list");
    const search = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
  }

  if (redirecting) return null;
  const shown: View = customerApproves ? view : "library";

  return (
    <section className="demos-page" aria-labelledby="demos-heading">
      <div className="dp-head">
        <h1 id="demos-heading">Demos</h1>
      </div>
      {customerApproves && (
        <div className="dp-segments" role="group" aria-label="Demos view">
          {VIEWS.map(([id, label]) => {
            const count = id === "library" ? null : counts[id];
            return (
              <button key={id} type="button" aria-pressed={shown === id} onClick={() => choose(id)}>
                {label}
                {count !== null && count > 0 && <span className="dp-count">{count.toLocaleString()}</span>}
              </button>
            );
          })}
        </div>
      )}
      {shown === "library" ? (
        <DemoLibrary />
      ) : (
        <DemoApprovals key={shown} view={shown} onCounts={onCounts} />
      )}
    </section>
  );
}
