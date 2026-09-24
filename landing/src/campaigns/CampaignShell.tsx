import type { ReactNode } from "react";
import { type DashboardSection } from "../dashboard/AppShell";
import WorkspacePage from "../dashboard/WorkspacePage";
import "./campaigns.css";

type CampaignShellProps = {
  active: "home" | "campaigns" | "people" | "review";
  children: ReactNode;
  workspace?: boolean;
};

export default function CampaignShell({
  active,
  children,
  workspace = false,
}: CampaignShellProps) {
  /* The builder survives for links from Triggers and older bookmarks; it
     sits under Flow in the sidebar, which is what replaced Campaigns. */
  const shellSection: DashboardSection =
    active === "people" ? "leads" : active === "campaigns" ? "flow" : active;
  return (
    <WorkspacePage
      active={shellSection}
      workspace={workspace}
    >
      {children}
    </WorkspacePage>
  );
}
