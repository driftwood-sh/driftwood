# Driftwood site and customer dashboard

React 19, TypeScript, and Vite power the marketing site and the authenticated
customer dashboard deployed on Vercel. The FastAPI/Neon control plane lives in
the separate `driftwood-sh/driftwood-backend` repository.

## Local development

```bash
npm install
npm run dev
```

The dashboard can run against deterministic browser-only fixtures without a
login or external write:

```text
http://127.0.0.1:4174/dashboard?mock=1
```

`?mock=1` intercepts the dashboard API in `src/mock.ts`. It does not call
Orange Slice, Neon, GCS, Cardinal, Autosana, or any outreach provider. Never
use mock mode as evidence that a backend migration works; use the isolated
Neon procedure in the backend review guide for that.

## Dashboard architecture

- `dashboard.html` is the lean customer-dashboard entry document.
- `admin.html` and `src/admin-main.tsx` are the separate internal admin entry,
  avoiding the customer bundle's route chain for Agents and Search visibility.
- `src/dashboard/AppShell.tsx` owns the responsive left sidebar, mobile focus
  trap, identity footer, and customer/admin navigation modes.
- `src/dashboard/WorkspacePage.tsx` owns auth/workspace resolution for the new
  customer pages.
- `src/audiences/` is the lead discovery and reusable audience library.
- `src/campaigns/` is the persisted, versioned sequence builder.
- `src/demos/` previews completed lead demos and sends attributed feedback to
  the Driftwood team's Slack channel. Owners/admins submit; members view.
- `src/assets/` is the private image/video/link library.
- `src/analytics/` is the channel funnel and exact-person drilldown.
- Existing Leads, Companies, Review, Agents, and Search visibility pages are
  wrapped in the same shell without changing their backend contracts beyond
  the documented lead-audience field.

The route table is explicit in `src/main.tsx`. Customer navigation contains
Overview, Audiences, Campaigns, Demos, Metrics, All leads, Companies, Assets, and
Review queue. Agents and Search visibility exist only in the admin shell.
Internal dashboard destinations stay in the current browser tab; external
evidence, LinkedIn profiles, and asset URLs may open separately.

## Backend contracts

Vercel proxies `/api/*` and auth/provider paths to the backend so the signed
session cookie remains first-party. The new UI uses:

| UI | Backend contract |
| --- | --- |
| Audiences | `/api/v1/dashboard/audiences*` |
| Campaigns | `/api/v1/dashboard/campaigns*` |
| Demos | `GET /api/v1/dashboard/demos`, `POST /api/v1/dashboard/demos/{demo_id}/feedback` |
| Assets | `/api/v1/dashboard/assets*` |
| Metrics | `/api/v1/dashboard/channel-metrics` |
| Leads | existing `/api/v1/dashboard/leads`, now including `audiences` |

The campaign activation dialog is intentionally explicit: activation freezes a
version and initializes planning ledgers, but does not queue or send outreach.
Open/click metrics render as unavailable because the current backend has no
defensible event source for them.

The Demos page lists hosted artifacts attached through `leads.demo_artifact_id`
and successful company-only private runs. Rows use the API's `demo_id` for
selection and feedback; company-only rows have no lead. The backend selects the
latest successful private package per normalized company, deduplicating retries.
Legacy media uses `/d/{public_slug}`; private video uses authenticated
`/api/v1/dashboard/demos/{demo_id}/video` with byte-range playback. “Open demo”
opens the optional `preview_url` for a private run. Its backend wrapper isolates
generated scripts in an opaque-origin, network-blocked iframe; legacy HTML
continues to use a script-free sandbox. Vite and Vercel proxy these API paths.
Roll out this site client before the backend: it normalizes older lead-only API
responses to `demo_id` until the additive backend response is deployed.
Feedback includes the viewed artifact ID and version timestamp so replaced demos
must be reviewed again. “Looks good” sends a quick reaction without a written
note; “Request changes” expands the note composer. Video notes can attach the
current playback time, pausing the video and including that moment in the internal
Slack message. Notes remain editable after a failed send; drafts, timestamps,
pending sends and confirmations survive switching between demos, scoped to the
exact artifact version. Timestamp context counts toward the 2,000-character limit.
After sending, customers can optionally add another note. Success
means Slack accepted the notification; successful feedback also enters the
backend audit trail. No send/approval action occurs on this page.

Preview `/dashboard/demos?mock=1`; use `mock=member`, `mock=demos-empty`,
`mock=demos-error`, or `mock=demos-feedback-error` to inspect those states.

Run `npm run test:demos` against a built preview on port 5181 (or set
`DEMO_TEST_BASE_URL`). It uses sample data and mocked feedback responses in
Chromium and iPhone WebKit. `DEMO_TEST_SCREENSHOTS` optionally captures the
feedback states; `DEMO_TEST_WEBKIT_PATH` selects an installed WebKit executable.
Mock feedback never sends a Slack message.

## Admin demo workflows

`/dashboard/admin/drift` is the platform-admin-only workflow editor. Photon’s
plan shows six ordered steps and the output of each one, with creative
direction controls for research, story, artwork and presentation. The story
outline describes the planned structure; it is not a generated demo preview.
The script and base prompts stay on the server. Saves apply to future runs
in the selected agent’s workspace and do not generate a demo immediately.

Run history uses the same ordered layout with review results and corrections.
Unrecorded steps stay explicitly unrecorded. Other agents keep their existing
process maps; the first editable plan is Photon only.

Drafts survive tab changes and failed saves. Switching agents asks before
discarding edits. Version conflicts offer an explicit discard-and-reload path;
the editor never silently overwrites another admin’s changes.

Preview `/dashboard/admin/drift?mock=admin`. Run `npm run test:drift` against
a built preview on port 5182 (`DRIFT_TEST_BASE_URL` overrides it). The script
checks Chromium and iPhone WebKit, saves, conflicts, drafts, access, keyboard
navigation and accessibility. `DRIFT_TEST_SCREENSHOTS` captures evidence;
`DRIFT_TEST_WEBKIT_EXECUTABLE` selects an installed WebKit binary. Mock saves
stay in memory and never call the backend or Slack.

## Quality gate

```bash
npm test
npm run lint
npm run build
```

Browser QA covers desktop and mobile navigation, audiences, lead filtering,
campaign editing/activation, assets, metric drilldowns, admin gating, and the
same-tab review-queue transition. The full implementation rationale, visual
decisions, risks, and recorded evidence are in
`../plans/2026-08-21-cardinal-campaign-workbench/plan.md`.

## Switchfrog

The production build installs the asynchronous Switchfrog SDK in every HTML
document via `scripts/prerender.mjs`, including static articles and dashboard
entries. `vercel.json` allows its script and activity requests through the CSP.
Only the publishable key is used; no secret key is needed for anonymous activity.
The snippet is added during build, so use a production build/preview to verify it.
