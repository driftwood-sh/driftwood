import { useEffect, useRef, useState, type ReactNode } from "react";
import { Wordmark } from "../components/Chrome";
import { VideoIcon } from "../assets/icons";
import {
  AgentsIcon,
  AssetsIcon,
  AudienceIcon,
  CampaignIcon,
  CloseIcon,
  FlowIcon,
  CompaniesIcon,
  LogoutIcon,
  MenuIcon,
  MetricsIcon,
  OverviewIcon,
  PeopleIcon,
  ReviewIcon,
  SearchVisibilityIcon,
  SettingsIcon,
  InboxIcon,
  FleetIcon,
  DriftIcon,
  TriggerIcon,
  type DashboardIconProps,
} from "./icons";
import {
  navigationGroups,
  type DashboardIconName,
  type DashboardSection,
  type NavigationMode,
} from "./navigation";
import { withMockMode } from "../mock-mode";
import "./app-shell.css";

export type { DashboardSection } from "./navigation";

type Identity = {
  name: string;
  workspace?: string | null;
  avatarUrl?: string | null;
};

type AppShellProps = {
  active: DashboardSection;
  children: ReactNode;
  identity?: Identity;
  onLogout?: () => void;
  adminControl?: ReactNode;
  notice?: ReactNode;
  workspace?: boolean;
  mode?: NavigationMode;
  mainClassName?: string;
  canWrite?: boolean;
  /* A number beside a nav item, for the sections that hold work: the count
     of demos waiting on the customer, or of demos scheduled to go out.
     Absent or null renders no badge, so a count that failed to load never
     shows as zero. */
  navCounts?: Partial<Record<DashboardSection, number | null>>;
};

const ICONS: Record<DashboardIconName, (props: DashboardIconProps) => ReactNode> = {
  overview: OverviewIcon,
  audience: AudienceIcon,
  campaign: CampaignIcon,
  flow: FlowIcon,
  demo: VideoIcon,
  trigger: TriggerIcon,
  metrics: MetricsIcon,
  people: PeopleIcon,
  companies: CompaniesIcon,
  assets: AssetsIcon,
  review: ReviewIcon,
  agents: AgentsIcon,
  search: SearchVisibilityIcon,
  fleet: FleetIcon,
  drift: DriftIcon,
  settings: SettingsIcon,
  inbox: InboxIcon,
};

type NavCounts = Partial<Record<DashboardSection, number | null>>;

function Navigation({ active, mode, counts }: { active: DashboardSection; mode: NavigationMode; counts: NavCounts }) {
  return (
    <nav className="app-sidebar-nav" aria-label={mode === "admin" ? "Admin panel" : "Dashboard"}>
      {navigationGroups(mode).map((group, index) => (
        <NavGroup key={group.label ?? index} label={group.label} items={group.items} active={active} counts={counts} />
      ))}
    </nav>
  );
}

function NavGroup({ label, items, active, counts }: { label?: string; items: ReturnType<typeof navigationGroups>[number]["items"]; active: DashboardSection; counts: NavCounts }) {
  return (
    <div className="app-sidebar-group">
      {label && <p className="app-sidebar-label">{label}</p>}
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const current = item.id === active;
        const count = counts[item.id];
        return (
          <a key={item.id} href={withMockMode(item.href)} className={`app-sidebar-link ${current ? "is-active" : ""}`} aria-current={current ? "page" : undefined}>
            <Icon size={17} />
            <span>{item.label}</span>
            {typeof count === "number" && count > 0 && (
              <span className="app-sidebar-count">{count.toLocaleString()}</span>
            )}
          </a>
        );
      })}
    </div>
  );
}

export default function AppShell({
  active,
  children,
  identity,
  onLogout,
  adminControl,
  notice,
  workspace = false,
  mode = "customer",
  mainClassName = "",
  canWrite = true,
  navCounts = {},
}: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileLayout, setMobileLayout] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const name = identity?.name || "Driftwood workspace";
  const workspaceName = identity?.workspace || (mode === "admin" ? "Admin workspace" : "Customer workspace");

  useEffect(() => {
    const media = window.matchMedia("(max-width: 959px)");
    const sync = () => {
      setMobileLayout(media.matches);
      if (!media.matches) setMenuOpen(false);
    };
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (!menuOpen || !mobileLayout) return;
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = sidebarRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen, mobileLayout]);

  function closeMenu() {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }

  return (
    <div className="dashboard-app-shell">
      <a className="dashboard-skip" href="#dashboard-main">Skip to content</a>
      <header className="app-mobile-masthead">
        <button ref={menuButtonRef} type="button" className="app-mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Open navigation" aria-expanded={menuOpen}>
          <MenuIcon size={19} />
        </button>
        <a href="/" className="app-mobile-brand" aria-label="Driftwood home"><Wordmark markSize="size-7" className="text-[17px]" /></a>
        <span className="app-mobile-avatar" aria-hidden="true">{name[0]?.toUpperCase()}</span>
      </header>

      <button type="button" className={`app-sidebar-scrim ${menuOpen ? "is-open" : ""}`} onClick={closeMenu} aria-label="Close navigation" tabIndex={menuOpen ? 0 : -1} />
      <aside
        ref={sidebarRef}
        className={`app-sidebar ${menuOpen ? "is-open" : ""}`}
        aria-label={mode === "admin" ? "Admin navigation" : "Workspace navigation"}
        aria-hidden={mobileLayout && !menuOpen ? true : undefined}
        inert={mobileLayout && !menuOpen ? true : undefined}
      >
        <div className="app-sidebar-brand-row">
          <a href="/" className="app-sidebar-brand" aria-label="Driftwood home"><Wordmark markSize="size-7" className="text-[17px]" /></a>
          <button ref={closeButtonRef} type="button" className="app-sidebar-close" onClick={closeMenu} aria-label="Close navigation"><CloseIcon size={18} /></button>
        </div>
        {mode === "admin" ? (
          <div className="app-sidebar-context"><span>Driftwood</span><strong>Admin panel</strong></div>
        ) : !canWrite ? (
          <div className="app-sidebar-context"><span>Workspace access</span><strong>Read only</strong></div>
        ) : null}
        <Navigation active={active} mode={mode} counts={navCounts} />
        <div className="app-sidebar-footer">
          {mode === "customer" && <a href={withMockMode("/dashboard/settings")} className={`app-sidebar-link ${active === "settings" ? "is-active" : ""}`} aria-current={active === "settings" ? "page" : undefined}><SettingsIcon size={17} /><span>Settings</span></a>}
          {adminControl && <div className="app-sidebar-admin">{adminControl}</div>}
          <div className="app-sidebar-identity">
            {identity?.avatarUrl ? (
              <img src={identity.avatarUrl} alt="" referrerPolicy="no-referrer" />
            ) : (
              <span aria-hidden="true">{name[0]?.toUpperCase()}</span>
            )}
            <div><strong>{name}</strong><small>{workspaceName}</small></div>
            {onLogout && <button type="button" onClick={onLogout} aria-label="Log out" title="Log out"><LogoutIcon size={16} /></button>}
          </div>
        </div>
      </aside>

      <div className="app-shell-stage">
        {notice && <div className="app-shell-notice" role="note">{notice}</div>}
        <main id="dashboard-main" className={`${workspace ? "app-shell-main is-workspace" : "app-shell-main"} ${mainClassName}`.trim()}>
          {children}
        </main>
      </div>
    </div>
  );
}
