/* eslint-disable react-refresh/only-export-components -- entry file, never hot-refreshed */
import './mock'
import { installFetchRetry } from './fetch-retry'
import ReconnectingNotice from './components/ReconnectingNotice'
import { StrictMode, Suspense, lazy } from 'react'
import { withMockMode } from './mock-mode'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import './index.css'
// dashboard pages are code-split: landing visitors only download the landing
const App = lazy(() => import('./App.tsx'))
const OgCard = lazy(() => import('./OgCard.tsx'))
const Dashboard = lazy(() => import('./Dashboard.tsx'))
const Leads = lazy(() => import('./Leads.tsx'))
const Companies = lazy(() => import('./Companies.tsx'))
const Review = lazy(() => import('./Review.tsx'))
const SeoGeo = lazy(() => import('./SeoGeo.tsx'))
const Agents = lazy(() => import('./Agents.tsx'))
const Conversation = lazy(() => import('./Conversation.tsx'))
const Fleet = lazy(() => import('./fleet/Fleet.tsx'))
const Drift = lazy(() => import('./drift/Drift.tsx'))
const Flow = lazy(() => import('./flow/Flow.tsx'))
const CampaignBuilder = lazy(() => import('./campaigns/CampaignBuilder.tsx'))
const Audiences = lazy(() => import('./audiences/Audiences.tsx'))
const DemosPage = lazy(() => import('./demos/DemosPage.tsx'))
const Triggers = lazy(() => import('./triggers/Triggers.tsx'))
const TriggerDetail = lazy(() => import('./triggers/TriggerDetail.tsx'))
const FaceCloning = lazy(() => import('./face-cloning/FaceCloning.tsx'))
const Assets = lazy(() => import('./assets/Assets.tsx'))
const AnalyticsDashboard = lazy(() => import('./analytics/AnalyticsDashboard.tsx'))
const WorkspacePage = lazy(() => import('./dashboard/WorkspacePage.tsx'))
const Integrations = lazy(() => import('./dashboard/Integrations.tsx'))
const Team = lazy(() => import('./team/Team.tsx'))
const Inbox = lazy(() => import('./inbox/Inbox.tsx'))
const SettingsTabs = lazy(() => import('./settings/SettingsTabs.tsx'))
const Settings = lazy(() => import('./settings/Settings.tsx'))
const Pricing = lazy(() => import('./Pricing.tsx'))

const requestedPath = window.location.pathname.replace(/\/+$/, '')
// Vercel rewrites every /dashboard route to the lean dashboard document while
// preserving the public URL. Opening that document directly should still land
// on the workspace overview instead of rendering the marketing page.
const path = requestedPath === '/dashboard.html' ? '/dashboard'
  : requestedPath === '/pricing/index.html' ? '/pricing' : requestedPath
// /dashboard/demos/library was the demo library's own page. The Demos page
// opens on the library now, so a link already shared lands there.
const isLibraryPath = path === '/dashboard/demos/library'
if (isLibraryPath) {
  window.history.replaceState(null, '', withMockMode('/dashboard/demos'))
}
// Campaigns became Flow (2026-09-24). The list page's address opens Flow, so
// a bookmark lands somewhere real; one campaign's builder keeps its own page.
const isCampaignsPath = path === '/dashboard/campaigns'
if (isCampaignsPath) {
  window.history.replaceState(null, '', withMockMode('/dashboard/flow'))
}
const campaignPathMatch = path.match(/^\/dashboard\/campaigns\/([^/]+)$/)
const triggerPathMatch = path.match(/^\/dashboard\/triggers\/([^/]+)$/)
// /og renders the social card; screenshot it at 1200x630 (dpr 2) to refresh public/og-5.png
const page =
  path === '/pricing' ? (
    <Pricing />
  ) : path === '/og' ? (
    <OgCard />
  ) : path === '/dashboard/audiences' || path === '/dashboard/lead-lists' ? (
    <WorkspacePage active="audiences"><Audiences /></WorkspacePage>
  ) : path === '/dashboard/face-cloning' ? (
    <WorkspacePage active="face-cloning"><FaceCloning /></WorkspacePage>
  ) : path === '/dashboard/assets' ? (
    <WorkspacePage active="settings"><SettingsTabs active="Product & brand assets" /><Assets /></WorkspacePage>
  ) : path === '/dashboard/demos' || isLibraryPath ? (
    <WorkspacePage active="demos"><DemosPage /></WorkspacePage>
  ) : path === '/dashboard/metrics' || path === '/dashboard/analytics' ? (
    <WorkspacePage active="metrics"><AnalyticsDashboard /></WorkspacePage>
  ) : path === '/dashboard/flow' || isCampaignsPath ? (
    <WorkspacePage active="flow"><Flow /></WorkspacePage>
  ) : campaignPathMatch ? (
    <CampaignBuilder campaignId={decodeURIComponent(campaignPathMatch[1])} />
  ) : path === '/dashboard/triggers' || path === '/dashboard/triggers/new' ? (
    // /new is the new-trigger box's own address, so it can be linked and
    // refreshed; without this it fell through to the id route and asked the
    // API for a trigger called "new".
    <WorkspacePage active="triggers"><Triggers /></WorkspacePage>
  ) : triggerPathMatch ? (
    <WorkspacePage active="triggers"><TriggerDetail triggerId={decodeURIComponent(triggerPathMatch[1])} /></WorkspacePage>
  ) : path === '/dashboard/integrations' ? (
    <WorkspacePage active="settings"><SettingsTabs active="Integrations" /><Integrations /></WorkspacePage>
  ) : path === '/dashboard/team' ? (
    <WorkspacePage active="settings"><SettingsTabs active="Team" /><Team /></WorkspacePage>
  ) : path === '/dashboard/inbox' ? (
    <WorkspacePage active="inbox"><Inbox /></WorkspacePage>
  ) : path === '/dashboard/settings' ? (
    <WorkspacePage active="settings"><Settings /></WorkspacePage>
  ) : path === '/dashboard/leads' ? (
    <Leads />
  ) : path === '/dashboard/companies' ? (
    <Companies />
  ) : path === '/dashboard/review' || path === '/dashboard/reviews' ? (
    // /reviews (plural) is aliased — it's a natural guess for the URL and
    // falling through to the landing page reads as "the queue is gone".
    <Review />
  ) : path === '/dashboard/admin/search-visibility' || path === '/dashboard/seo-geo' ? (
    <SeoGeo />
  ) : path === '/dashboard/admin/fleet' ? (
    <Fleet />
  ) : path === '/dashboard/admin/drift' ? (
    <Drift />
  ) : path === '/dashboard/admin' || path === '/dashboard/admin/agents' || path === '/dashboard/agents' ? (
    <Agents />
  ) : path.startsWith('/dashboard/admin/agents/') || path.startsWith('/dashboard/agents/') ? (
    <Conversation />
  ) : path === '/dashboard' ? (
    <Dashboard />
  ) : (
    <App />
  )

const isLanding = !(path === '/og' || path === '/dashboard' || path.startsWith('/dashboard/'))

// Dashboard GETs ride out the backend's short 429/503 windows (a Cloud Run
// instance swap) instead of failing; see fetch-retry.ts. Installed after
// mock.ts so it wraps the mock fetch too, and before any page chunk loads.
if (!isLanding) installFetchRetry(window)

// PostHog: landing pages only (dashboard is internal use — keep prospect
// analytics clean). Ingestion rides the first-party /ingest proxy in
// vercel.json, so ad-blockers don't eat events and the CSP stays 'self'.
// The project key is public by design (client-side token).
if (isLanding) {
  void import('posthog-js').then(({ default: posthog }) => {
    posthog.init('phc_zJTpnFWJ5h9YAE3y55jmXEbSCcffw96EYPnLRhMtGJGm', {
      api_host: '/ingest',
      ui_host: 'https://us.posthog.com',
      defaults: '2025-05-24',
      person_profiles: 'identified_only',
    })
  })
}

const root = document.getElementById('root')!
const tree = (
  <StrictMode>
    <Suspense fallback={null}>{page}</Suspense>
    {isLanding ? <Analytics /> : <ReconnectingNotice />}
  </StrictMode>
)

// Marketing documents ship with their page prerendered into #root (AI crawlers
// don't run JS — scripts/prerender.mjs puts the real content in the HTML).
// The landing hydrates it; app pages clear it and mount fresh. Dev serves an
// empty #root and falls through to a plain client render.
if (isLanding && root.firstElementChild) {
  hydrateRoot(root, tree)
} else {
  if (root.firstElementChild) root.innerHTML = ''
  createRoot(root).render(tree)
}
