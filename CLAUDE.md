# CLAUDE.md — driftwood site

The driftwood marketing site + landing (`landing/`), deployed to **driftwood.sh**
on Vercel (project `driftwood-landing`, Vercel "Root Directory" = `landing/`).
React + Vite + Tailwind; serverless functions in `landing/api/`.

## Deployment — the one rule

**`main` is the source of truth, and production deploys come from `main` via
Vercel's git integration. Commit before you deploy.**

- **Never run `vercel --prod` (or `vercel`) against the working tree.** That
  ships whatever uncommitted local state you happen to have and makes `main`
  diverge from what's live. This already bit us once: a full landing redesign
  lived only in the working tree + Vercel's build while `main` still held the
  older version, so a clean deploy from `main` silently reverted production to
  the stale design.
- The fix and the habit: **commit every change to `main` and push.** Let Vercel
  deploy from the pushed commit. If you can see it on driftwood.sh, it must be a
  commit on `main` — no exceptions, nothing "just deployed locally."
- Keep `main` == production at all times. If they ever drift, reconcile by
  committing the live state to `main` first, before any new deploy.
- CLI (`vercel`) is for **preview** deploys / inspection only, never to promote
  the working tree to prod.

## Restoring production after a bad deploy

Promote a known-good prior deployment instead of guessing:
`vercel ls driftwood-landing --prod` to list them, then
`vercel promote <deployment-url>` (or the Vercel dashboard → Deployments →
⋯ → Promote to Production). Don't `vercel --prod` a fix from the working tree.

## Layout

- `landing/` — the Vite app (Vercel root). `src/App.tsx` is the page; CTAs route
  through `src/components/` (e.g. `BookDemo.tsx`, `WaitlistForm.tsx`).
- `landing/api/` — Vercel serverless functions (e.g. `waitlist.ts`).
- `landing/vercel.json` — rewrites (`/api/*`, `/auth/*`, `/d/*`, `/t/*` proxy
  to the backend; SPA catch-all to `index.html`). `/t/*` is the demo GIF and
  its player page, so it sits outside the site CSP and uses the backend's own.

## Design language

**Before any UI change (landing OR dashboard), read
`design/design-language.md`** — tokens, type, buttons, the ASCII sea rules,
motion gates, copy rules, and the baked-asset re-shoot rule. It is the
source of truth; if your change disagrees with it, update the doc in the
same commit or don't make the change.
