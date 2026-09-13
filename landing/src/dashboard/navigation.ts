export type DashboardSection =
  | "inbox"
  | "home"
  | "audiences"
  | "campaigns"
  | "demos"
  | "triggers"
  | "metrics"
  | "leads"
  | "companies"
  | "assets"
  | "review"
  | "face-cloning"
  | "team"
  | "settings"
  | "admin-agents"
  | "admin-search"
  | "admin-fleet"
  | "admin-drift";

export type NavigationMode = "customer" | "admin";

export type DashboardIconName =
  | "inbox"
  | "overview"
  | "audience"
  | "campaign"
  | "demo"
  | "trigger"
  | "metrics"
  | "people"
  | "companies"
  | "assets"
  | "review"
  | "agents"
  | "search"
  | "fleet"
  | "drift"
  | "settings";

export type NavItem = {
  id: DashboardSection;
  label: string;
  href: string;
  icon: DashboardIconName;
};

export type NavGroup = { label?: string; items: NavItem[] };

const CUSTOMER_PRIMARY: NavItem[] = [
  { id: "home", label: "Overview", href: "/dashboard", icon: "overview" },
  { id: "campaigns", label: "Campaigns", href: "/dashboard/campaigns", icon: "campaign" },
  { id: "audiences", label: "Audiences", href: "/dashboard/audiences", icon: "audience" },
  { id: "demos", label: "Demos", href: "/dashboard/demos", icon: "demo" },
  { id: "triggers", label: "Triggers", href: "/dashboard/triggers", icon: "trigger" },
  { id: "face-cloning", label: "Face Cloning", href: "/dashboard/face-cloning", icon: "people" },
  { id: "inbox", label: "Inbox", href: "/dashboard/inbox", icon: "inbox" },
];

const ADMIN_INTERNAL: NavItem[] = [
  { id: "review", label: "Review queue", href: "/dashboard/review", icon: "review" },
  { id: "admin-fleet", label: "Fleet", href: "/dashboard/admin/fleet", icon: "fleet" },
  { id: "admin-agents", label: "Agents", href: "/dashboard/admin/agents", icon: "agents" },
  { id: "admin-drift", label: "Demo workflows", href: "/dashboard/admin/drift", icon: "drift" },
  // Dropped 2026-08-23 (Aayush/Dheer call), re-added 2026-08-31 on Aayush's ask.
  { id: "admin-search", label: "Search visibility", href: "/dashboard/admin/search-visibility", icon: "search" },
];

export function navigationGroups(mode: NavigationMode): NavGroup[] {
  return mode === "admin"
    ? [{ label: "Internal tools", items: ADMIN_INTERNAL }]
    : [
        { items: CUSTOMER_PRIMARY },
      ];
}
