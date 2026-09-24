import type { ReactNode, SVGProps } from "react";

export type DashboardIconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 18, children, ...props }: DashboardIconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

export function OverviewIcon(props: DashboardIconProps) {
  return <Icon {...props}><path d="M4 4h6v6H4zM14 4h6v10h-6zM4 14h6v6H4zM14 18h6v2h-6z" /></Icon>;
}

export function AudienceIcon(props: DashboardIconProps) {
  return <Icon {...props}><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.35-3.35 2.15-5 5.5-5s5.15 1.65 5.5 5M16 7h4M18 5v4M16.5 14.5c2.35.45 3.65 1.95 4 4.5" /></Icon>;
}

export function CampaignIcon(props: DashboardIconProps) {
  return <Icon {...props}><path d="M5 5.5h14M5 12h14M5 18.5h9" /><circle cx="3.5" cy="5.5" r=".75" fill="currentColor" stroke="none" /><circle cx="3.5" cy="12" r=".75" fill="currentColor" stroke="none" /><circle cx="3.5" cy="18.5" r=".75" fill="currentColor" stroke="none" /><path d="m17 16 3 2.5-3 2.5z" /></Icon>;
}

/* The daily flow: three stations joined by one line, left to right. */
export function FlowIcon(props: DashboardIconProps) {
  return <Icon {...props}><circle cx="5" cy="7" r="2.25" /><circle cx="12" cy="17" r="2.25" /><circle cx="19" cy="7" r="2.25" /><path d="M6.3 8.9 10.7 15M13.3 15l4.4-6.1" /></Icon>;
}

/* A standing watch: one point with rings radiating out (design/triggers.html). */
export function TriggerIcon(props: DashboardIconProps) {
  return <Icon {...props}><circle cx="12" cy="12" r="2.25" /><path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" /></Icon>;
}

export function MetricsIcon(props: DashboardIconProps) {
  return <Icon {...props}><path d="M4 19V9M10 19V5M16 19v-7M22 19V3" /></Icon>;
}

export function PeopleIcon(props: DashboardIconProps) {
  return <Icon {...props}><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.35-3.35 2.15-5 5.5-5s5.15 1.65 5.5 5M16 6.5a2.5 2.5 0 0 1 0 5M16 14c2.7.25 4.15 1.9 4.5 5" /></Icon>;
}

export function CompaniesIcon(props: DashboardIconProps) {
  return <Icon {...props}><path d="M4 21V6l8-3v18M12 9h8v12M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2" /></Icon>;
}

export function AssetsIcon(props: DashboardIconProps) {
  return <Icon {...props}><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="1.5" /><path d="m5.5 17 4-4 3 3 2.5-2.5 3.5 3.5" /></Icon>;
}

export function ReviewIcon(props: DashboardIconProps) {
  return <Icon {...props}><path d="M7 3h10v4H7zM5 5H4v16h16V5h-1" /><path d="m8 14 2.5 2.5L16 11" /></Icon>;
}

/* Three sliders: one knob per row, in the same 24-box as the rest of the set. */
export function SettingsIcon(props: DashboardIconProps) {
  return <Icon {...props}><path d="M4 7h8M18 7h2M10 12h10M4 17h10" /><circle cx="15" cy="7" r="2.25" /><circle cx="7" cy="12" r="2.25" /><circle cx="17" cy="17" r="2.25" /></Icon>;
}

export function AgentsIcon(props: DashboardIconProps) {
  return <Icon {...props}><rect x="4" y="7" width="16" height="13" rx="3" /><path d="M9 3h6M12 3v4M8 12h.01M16 12h.01M8.5 16h7" /></Icon>;
}

export function SearchVisibilityIcon(props: DashboardIconProps) {
  return <Icon {...props}><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5M7.5 11h6M10.5 8v6" /></Icon>;
}

export function AdminIcon(props: DashboardIconProps) {
  return <Icon {...props}><path d="M4 5.5h6v5H4zM14 5.5h6v5h-6zM4 14.5h6v4H4zM14 14.5h6v4h-6z" /><path d="M7 3v2.5M17 3v2.5M7 18.5V21M17 18.5V21" /></Icon>;
}

export function PlusIcon(props: DashboardIconProps) {
  return <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>;
}

export function MenuIcon(props: DashboardIconProps) {
  return <Icon {...props}><path d="M4 7h16M4 12h16M4 17h16" /></Icon>;
}

export function CloseIcon(props: DashboardIconProps) {
  return <Icon {...props}><path d="m6 6 12 12M18 6 6 18" /></Icon>;
}

export function LogoutIcon(props: DashboardIconProps) {
  return <Icon {...props}><path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10" /></Icon>;
}

export function FleetIcon(props: DashboardIconProps) {
  return <Icon {...props}><circle cx="7" cy="7" r="2.5" /><circle cx="17" cy="7" r="2.5" /><circle cx="7" cy="17" r="2.5" /><circle cx="17" cy="17" r="2.5" /><path d="M9.5 7h5M7 9.5v5M17 9.5v5M9.5 17h5" /></Icon>;
}

export function DriftIcon(props: DashboardIconProps) {
  return <Icon {...props}><circle cx="6" cy="12" r="2.5" /><circle cx="15.5" cy="6" r="2" /><circle cx="16.5" cy="17" r="2" /><path d="M8.2 10.6 13.7 7M8.3 13.3l6.3 3M17 8l-0.5 7" /></Icon>;
}

export function InboxIcon(props: DashboardIconProps) {
 return <Icon {...props}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 6 9 7 9-7" /></Icon>;
}
