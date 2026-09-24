# dashboard UX principles

The usability bar for every `/dashboard/*` page. Companion to
`design-language.md`, which owns tokens, type, and voice — this file owns how
the dashboard *behaves*: loading, feedback, and consistency. Audit against
this list, fix what fails, and when a rule earns an exception, write the why
here in the same commit. Testable rules only; taste lives in the other file.

## Loading

1. **No blank stares.** Every page renders its real layout on first paint:
   the AppShell chrome immediately, skeleton placeholders where content will
   land. A lone centered spinner on a white page is a failure; a spinner is
   acceptable only inside an already-painted region.
2. **Skeletons mirror the final layout.** Table rows for tables, cards for
   cards, matching heights — when data lands nothing jumps. (Skeleton blocks
   use `line`/`wash-a` tones, a slow pulse, `prefers-reduced-motion` gets
   static blocks.)
3. **Paint what you have.** Long lists show the first page immediately and
   stream the rest (the Review-queue pattern: parallel fetches, quiet
   "Loading the rest…" line, honest N-of-M counts, whole-set actions parked
   until complete). Never hold first paint for a full load.
4. **Long operations narrate.** Anything that can exceed ~2s (lead discovery,
   CSV import, campaign creation) shows staged progress in place — what it is
   doing now, not just that it is busy. Anything that can exceed ~10s must
   also survive a tab switch: state lives server-side and the page re-polls.
5. **Slow is a bug.** Before adding a spinner to cover a wait, check whether
   the wait itself can go away (serial fetches, missing cache, oversized
   payload).

## Feedback on actions

6. **Every press acknowledges instantly.** Buttons get pressed/hover states
   and, for async work, an in-button busy state (spinner or label swap,
   "Saving…") with the button disabled while in flight. No double-submits,
   no dead clicks.
7. **Outcomes are visible where the action happened.** Success: the UI state
   visibly changes in place (row leaves the queue, count ticks) or a toast
   confirms. Failure: the error renders next to the control that failed, in
   plain sentence-case words, with the failed action re-enabled for retry.
   Silent failure is the worst bug in this file.
8. **Disabled controls explain themselves.** Every disabled interactive
   element has a `title` (or visible hint) saying why and what unlocks it
   ("Available once the full queue loads"). No mystery-gray buttons.
9. **Destructive or bulk actions arm-then-confirm.** First press arms
   ("Delete audience? Confirm"), second executes; armed state self-disarms
   after ~5s. Reuse the Review-queue idiom, including mutual exclusivity
   when two bulk actions sit together.
10. **Optimistic where safe, pending where not.** Local state may update
    ahead of the server only when the server call reconciles visibly on
    failure (the decide pattern). Anything money-, send-, or delete-shaped
    waits for the server.

## Consistency

11. **One button system.** Primary (tide), secondary (outline), danger —
    shared radius, height, focus ring, disabled treatment. A page inventing
    its own button style is a bug; extract, don't fork.
12. **One term per concept, everywhere.** queued/sent/failed, lead/company,
    audience/campaign — the same word in nav, headings, counts, and toasts.
    Sentence case everywhere; no all-lowercase stylized labels in chrome
    (agent voice inside artifacts is the one exception, per
    design-language.md).
13. **Counts are honest and typographically stable.** `tabular-nums`,
    `toLocaleString()` for thousands, loaded-of-total while a list streams.
    A number that silently means "what happened to load" is a lie.
14. **Empty is a designed state.** Every list/table/panel has an empty state
    that says what this is and offers the one next action (upload, create,
    connect). "No data" alone is a failure. Empty ≠ loading ≠ error: three
    distinct renders, never one ambiguous blank.
15. **Keyboard and screen-reader parity.** Everything clickable is a real
    `button`/`a` with `focus-visible` ring; icon-only buttons carry
    `aria-label`; async regions announce via `role="status"`/`aria-live`;
    modals trap focus and close on Escape (AppShell's menu is the reference).
16. **Type and spacing come from the system.** Public Sans at established
    sizes, mono only for the sanctioned functional bits; spacing steps from
    the existing scale, page max-widths matching the shell. No page-local
    font sizes invented to make something fit.
17. **Motion is settle, not show.** `--ease-settle`, ~240ms on controls,
    nothing bouncing for attention; `prefers-reduced-motion` disables all of
    it. Layout shift after first paint is a bug (reserve space; see rule 2).
18. **Never name our vendors in customer-facing copy.** OrangeSlice, Unipile,
    Composio, Kernel, Exa, InboxKit and friends are plumbing we can swap;
    naming them leaks architecture, means nothing to the customer, and makes
    errors unactionable ("Orange Slice connected", "Unipile 422
    unprocessable_entity"). Say what the product can do — "Lead search
    ready", "Couldn't send this invite: LinkedIn allows a new invite three
    weeks after the last one was withdrawn" — or say nothing (a working
    capability rarely needs a status chip at all). The allowed brand names
    are the accounts the CUSTOMER connects and owns: Google, LinkedIn,
    Gmail/Outlook, X. This applies to every string a customer can see,
    including backend-originated ones (error fields, provider labels) — a
    raw vendor error belongs in logs and traces; the UI translates it into
    what happened and what happens next, and a backend that ships vendor
    strings to a customer-visible field is a bug on the backend.

19. **A line of text earns its place only if it changes what the user does
    next.** Delete the rest, then cut half the words from what survives.
    Explanations of our own mechanism, bounds and rules that are not switched
    on, and labels that repeat the heading above them are all text the reader
    pays for and gets nothing back. A tooltip is optional context only: never
    put a rule, a limit, or anything a task depends on inside one.

20. **A control is always visible.** Row actions and every other primary
    control render whether or not a pointer is near them. Hover may change a
    control's emphasis; it may never be what reveals it. A control that
    appears on hover is undiscoverable, absent on touch, and tells a
    first-time reader that the row does nothing. When repeated controls read
    as noise, make them quieter (design-language.md §3, tertiary), not hidden.

## Process

- Audit → findings ranked by user pain → fix in minimal, tagged deltas.
- Behavioral fixes (loading, feedback, a11y) ship like code. Anything that
  changes how a page *looks* beyond established idioms rides a branch and a
  Vercel preview for Aayush's review first (design-language.md §7).
- QA every finding and fix against the mocked dashboard (`?mock=1`) — it
  intercepts the API surface, so flows are drivable end-to-end offline. If
  the mock can't express a state (error, empty, slow), extend the mock in
  the same commit.
- Re-shoot baked assets when dashboard styling changes (design-language.md §7).


## The daily flow: Overview, Flow, Audiences, Demos, Inbox (2026-09-24)

A workspace runs one daily flow, not a list of campaigns: find the right
people, make each of them a demo, write the email that carries it, queue it.
Each page owns one part of that, and no two pages show the same list.

- **Overview** reports, it does not manage. Today's sending shows Outreach
  queued, Emails sent today and Status. Status is the workspace's approval
  setting in the Settings page's own words (Auto, Manual or Hybrid approval)
  with a Change link. **Awaiting approval** appears only where the customer's
  own team approves; on auto approval nothing waits on them, so the number is
  not shown at all. Email capacity is not an overview number.
- **Flow** replaced Campaigns in the sidebar (`/dashboard/campaigns` opens
  Flow; one campaign's builder keeps its own page for links from Triggers).
  Four stations in run order (Audience, Demo, Email, Queue) each state where
  things stand in one line and link to the page that changes them. Under them,
  **Going out** lists the next send day's people (the next day with sends, so
  a Friday shows Monday), grouped by due time in the workspace's time zone,
  never by `projected_date`, which is deliberately a day pessimistic. Choosing
  a person shows exactly what they get: their demo and their email. Remove
  (per row, or a selection) arms then confirms and posts `sends/cancel`, which
  also tells the agent not to queue them again. Pause all sends lives here.
- **Audiences** is a list of audiences; opening one is a full page of its
  people (`?audience=<id>`, so Back and refresh work). Each person carries
  **Found by**: Lead search, CSV upload, Driftwood or Added by hand. Lead
  search is the discovery search (rule 18: never the vendor's name). Chips
  filter by source; a row opens everything on file; **Export CSV** exports
  exactly the rows shown and never writes a spreadsheet formula.
- **Demos** opens on **All demos** for everyone: the library, one demo at a
  time, with Ask for a change. Where the team approves (manual or hybrid),
  **Demos to approve** and **Emails to approve** sit beside it; on auto
  approval they are not there. The queue is Flow's and the sent history is
  Inbox's, so neither is repeated here. Old `?seg=` links still resolve.
  The sidebar badge counts only what waits on the customer: none on auto.
- **Inbox** tabs are Queued, Sent, Replies, plus **Needs approval** only
  where the team approves. A draft in Driftwood's own final check is not the
  customer's to act on, so it is listed under Queued as "Final check", after
  the scheduled rows, never as a second queue-shaped tab.

## Demo and email approvals

- Where the team approves, the Demos page has two approval views beside the
  library: **Demos to approve** holds demos awaiting approval and approved
  demos whose recipients and drafts are being prepared; **Emails to approve**
  holds drafts. Queue counts only scheduled sends and lives on Flow.
- **Approve demo** authorizes recipient discovery and drafting. **Approve all
  demos** has the same limited scope, with the existing two-press confirmation.
  It must never also approve pending email reviews.
- **Emails to approve** groups drafts by company and shows the recipient name,
  title, email address, subject, full copy, and the linked preview image.
  **Approve email & queue** acts on that displayed email only. After all of a
  company’s full drafts, **Approve N emails & queue** requires confirmation and
  acts only on that company’s displayed, reviewable emails. Multiple drafts
  for one recipient remain separate; unseen copy cannot ride along in a decision.
- Agent-prepared **send lists** freeze exact email drafts from an explicitly
  requested generation batch or set of review IDs. In Emails to approve, choosing
  a list shows only its recipients, videos, GIFs and full copy. **Approve this
  list** uses the existing two-press confirmation and queues only those pending
  IDs. Older drafts and later generations cannot join the selection. Changed
  recipients/copy, incomplete data, or a different assigned reviewer block the
  batch action. A missing list never falls back to approving the whole queue.
  `?mock=photon-review-multi&view=approve-emails&send_list=today` demonstrates a two-email
  list within a six-email workspace; approval leaves the four other drafts alone.
- A missing recipient email disables queueing with an explanation. Asking for
  changes and skipping a recipient remain available. Review settings determine
  the authorized reviewer; the page does not bypass that policy.
- Contact progress refreshes while the page is visible and when the user
  returns. Blocked discovery keeps its reason and the Add a name action.
- Offline QA (add `&approval=auto` or `&approval=manual` to pin the policy):
  `?mock=photon-review` has five reviewable emails for one company,
  another demo awaiting approval, and a discovery in progress. All addresses
  are fixtures at example.test. `scripts/demos-approve-qa.mjs` proves that demo
  approvals queue no email and a later email approval queues exactly that copy,
  plus company approval excludes drafts for other companies. It runs on
  desktop Chromium and iPhone WebKit. Existing marketing dashboard assets
  do not capture this page; no baked marketing asset changes are needed.

- Existing portrait players reserve a 16:9 frame before metadata supplies the
  actual ratio. Separating demo approval from email review brings this single resize
  into the viewport; clip QA now measures it honestly, requiring the same exact
  ratio, one resize, and incremental CLS below 0.05. Changing the renderer or
  adding dimensions to the media API is outside this approval-flow change.

- Media in long demo lists is deferred: video elements receive their source
  only within 200px of the viewport (or keyboard focus), then keep their loaded
  state and playhead while scrolled away. A changed source remounts metadata,
  duration, error, and frame state. Inline email previews use native lazy image
  loading and asynchronous decoding. This avoids opening every authenticated
  stream when an 80-company library or 400-email review list loads.
  `scripts/demos-lazy-media-qa.mjs` verifies bounded initial requests, new media
  on scrolling, and source replacement on desktop Chromium and iPhone WebKit.
