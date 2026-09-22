import { lazy, Suspense } from "react";
import SettingsTabs from "./SettingsTabs";
import "../team/team.css";
const SendScheduleSettings = lazy(() => import("./SendScheduleSettings"));
const ApprovalSettings = lazy(() => import("../approvals/ApprovalSettings"));
const SendingAccountSettings = lazy(() => import("../Dashboard").then((module) => ({ default: module.SendingAccountSettings })));
export default function Settings() {
 const tab = new URLSearchParams(window.location.search).get("tab");
 const active = tab === "approvals" ? "Approvals" : tab === "accounts" ? "Sending accounts" : "Send schedule";
 /* The heading belongs to the page, not to one tab, so every view gets it above the tab strip. */
 return <><header className="team-heading"><h1 id="settings-heading">Settings</h1><p>Workspace-wide preferences. Only owners and admins can change them.</p></header><SettingsTabs active={active} /><Suspense fallback={<p role="status">Loading settings…</p>}>{tab === "approvals" ? <ApprovalSettings /> : tab === "accounts" ? <SendingAccountSettings /> : <SendScheduleSettings />}</Suspense></>;
}
