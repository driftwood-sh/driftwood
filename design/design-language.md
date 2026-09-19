# driftwood design language

The source of truth for how driftwood looks, moves, and talks — landing page
AND dashboard. If a change disagrees with this file, either the change is
wrong or this file gets updated in the same commit. Never let them drift.

## 1. Tokens

Defined twice, deliberately in sync: `landing/src/index.css` `:root` vars
(landing scope) and the Tailwind `@theme` block (dashboard). If you touch a
value, change both.

| Token | Value | Use |
|---|---|---|
| ink | `#16181b` | headings, primary text |
| gray | `#6a737d` | body/support text |
| gray-light | `#9aa2ab` | labels, deemphasized |
| line | `#e9ebee` | all hairline borders |
| tide (accent) | `#15557e` | THE accent. Links-as-actions, primary buttons, voice italics, water |
| tide-deep | `#0d3c5b` | hover state of tide |
| tide-wash | `#eaf1f7` | tinted chips/fills |
| wash-a / wash-b | `#f4f8fb` / `#eaf1f7` | section sheet tints (sparingly) |
| ground | `#ffffff` | page background. White. Not off-white, not gradient |
| alert | `#b42318` | needs-attention dot on internal dashboard cards ONLY |

One accent. If a design wants a second accent color, the design is wrong.
(Exception: in-artifact brand colors — Brex orange inside a Brex demo — live
inside their artifact window and never leak into page chrome.) Sanctioned
exception, approved by Aayush 2026-07-26: `--alert` is reserved for the
needs-attention dot on internal/admin dashboard surfaces; it never appears
on marketing pages and is never a second brand accent.

## 2. Type

- **Body/UI**: Public Sans, weights 400–700. No mono for labels (mono reads
  "AI-generated" — it's banned from chrome; IBM Plex Mono survives only for
  functional bits inside the review queue).
- **Wordmark**: Source Serif 4, weight 600, next to the HelmMark tile.
  Everywhere: header, footer, dashboard, OG image.
- **Voice accent**: Georgia italic in tide blue, `em.voice`. One phrase per
  heading, the phrase that carries the meaning ("*AI slop*", "*whole job*").
  Never two voice phrases in the same block.
  **Every heading carries one** (2026-08-10, Aayush's call reversing the
  2026-07-28 "earn it or drop it" pullback): hero "Ship *tailored demos*",
  `#cases` "your leads *slop*", `#explore` "*book meetings*", the close
  "*your* prospects". The 07-28 worry was that the serif-blue word is the
  stock AI-website flourish; the ruling now is that it was also simply good
  design, and the page's identity lives in the sea and the artifacts, not
  in abstaining from the accent. Still one phrase per heading, never two,
  and it goes on the phrase that carries the meaning.
- **Section headings carry full weight** (2026-08-10, reversing the
  2026-07-28 thin-350 rule at Aayush's call): `#cases` and `#explore` sit at
  the shared scale's 600, matching the closing ask. The thin ground was
  built for long descriptive lines carrying a heavy accent figure
  ("...converts at `10%`" at 750); once the copy turned into short
  imperatives ("Don't send your leads *slop*") the light weight read frail,
  not elegant. The voice italic still separates by serif and color, and the
  hero still outranks sections by size and position, so nothing shouts.
- Headings share one scale: `clamp(2rem, 1.2rem + 2.8vw, 3.2rem)`, weight
  600, tracking −0.014em. H1 caps at 12 words.
- **The hero H1 is the one exception** (2026-07-28): it sits a step above the
  shared scale — `clamp(2.05rem, 1.15rem + 2.75vw, 3.15rem)`, weight **620**
  (Public Sans is variable, so this is a real notch above 600 and not a jump
  to semibold), tracking −0.028em, leading 1.1. It has to out-rank the sub
  under it; at the shared scale the two read as one block. Since 2026-08-10
  it carries "*tailored demos*" as its voice phrase, like every heading
  (see the voice-accent rule above).
- No em dashes in site copy. (Sole exception: the slop parody card — slop
  uses em dashes, that's the joke.)
- **Break lines on meaning, not on measure** (2026-07-28): `text-wrap: balance`
  evens the lines but has no idea which words belong together, and it split
  the hero sub as "Grow revenue with cold / outbound…". Bind the phrase with
  an `&nbsp;` (`cold&nbsp;outbound`) and give the block enough `max-width` for
  the bound phrase to fit one line — the turn then lands where the sense
  turns. Check any two-line block for this; a `<br>` is not the fix.

## 3. Surfaces

- **Windows** (`.app-window`, `.artifact`, `.email`, `.thread`): white,
  1px `line` border, radius `--r-win` (12px), shadow `--shadow-win`.
  Artifacts are pixel-real: real chrome, real screenshots, no illustration.
- **The hero fits the fold**: hero height comes from the viewport
  (clamped 38–64rem), never from the dashboard screenshot — the window
  crops from its bottom edge and the waterline lands at the fold. The
  stacked (phone) hero centers headline / sub / CTA on the page axis.
- **Buttons**: pills (`border-radius: 999px`). Primary action = tide
  background, white text, hover tide-deep. There are no black buttons.
  Secondary = outlined/ghost. This applies to the dashboard too.
  **Tertiary is quiet text** (2026-09-13, on "the on hover for the controls is
  terrible ui"): no border, no fill, `ink-soft` at the type size of the text
  around it, darkening to `ink` on hover with the standard focus ring. It is
  for a control that repeats down a list, where a pill per row is the loudest
  thing on the page. It is the answer to that noise; hiding the control until
  hover is not (see ux-principles.md rule 20).
- **The backed-by line** (2026-08-09, placed by Aayush after one round):
  investor provenance is two words and the mark — "Backed by" + the ink
  alpha lockup at 1.8rem, opacity 0.82 — riding the open water *under the
  proof island*, centred on the island's axis. Two placements were tried
  and pulled the same day: under the CTA it collided with the island art,
  and between the sub and the CTA it crowded the ask. The line shares the
  below-island gap without moving the island itself. Spelling out
  "a16z speedrun" in the words was also cut — the lockup is the brand,
  two gray words are enough. Asset: `backed-alpha.webp`, the supplied
  black lockup trimmed, recolored to ink, 3× display height.
  **The sea parts around it** (same day, on "it looks muddy"): glyphs
  running under the mark read as mud, and a white halo strong enough to
  fix that read as fog. The canvas clears an ellipse measured off the
  line's *content* (first/last child union — the `<p>` box spans the
  island's full width) with a faint `~` lap at the ring: the island
  mechanism minus the coast. Only a whisper of halo remains for the
  sea-off fallback.
- **Labels** (`.compare-label`, `.artifact-bar`, `.label`): 0.85rem,
  **gray** (not gray-light — labels carry real information and gray-light
  on white is ~2.7:1, under the 4.5:1 AA floor at this size), sentence
  case, no pills, no uppercase, no mono. Gray-light survives only for
  truly decorative deemphasis.
- **Redaction language**: identity we withhold = `.redact` gray bar
  (`#d4d9de`, 2px radius). Used consistently: names, companies, addresses.
- **Cast shadows are stacked, never one layer** (2026-07-28): a single
  large-blur/negative-spread shadow stops dead at its edge and bands — it
  reads choppy against white. Build depth from 4–5 layers, each roughly
  doubling the blur and shedding alpha (`.case-video`, `.gif-shell` are the
  reference recipes). Contact layer tight and faint; deepest layer wide and
  under 0.09 alpha.
- **The thin-sheet edge** (2026-07-28): things cut from the page's "material"
  — the case clips — carry a little thickness: a lit rim along the top
  (`inset 0 1px 0 rgba(255,255,255,.5)`), then three *hard* 1px offsets
  stepping down in tide-blue (0.26 → 0.17 → 0.10) that read as the cut edge
  catching light, and only then the soft cast. Blur on those three steps kills
  the effect — they must stay hard.
  **It is for objects, not type** (reverted 2026-07-28): the same recipe was
  tried on the `#cases` heading as a `text-shadow` and pulled back out — a
  letterpressed headline reads as a second physical object competing with the
  clips it introduces. Section headings stay flat: thin ground (weight 350) so
  the one accent-colored number carries the line.
- **A clipped cast is a hard line** (2026-07-28): `overflow-x: auto` clips the
  *vertical* axis too, so a scroll rail has to carry room for its cards'
  shadows or it slices them off flat — that's what the straight edge under the
  case deck was. Give the rail padding past the deepest layer's reach AND a
  bottom `mask-image` fade that takes the last of the falloff to zero. The fade
  may only ever cross padding; if it touches card content, the padding is too
  short.
- **The case-study card** (2026-07-28): three descending voices, left to
  right on desktop and top to bottom on phones —
  (1) the demo clip the client actually sent, 16:9, the biggest and only
  moving object, and **always the card's leading edge** so the card waiting
  off-rail teases its clip and never its logo; its title/sub lie over the
  clip's *head* on desktop (the foot belongs to burned-in subtitles) and
  drop below it in ink on phones, where a 342px frame can't carry a headline;
  (2) the client's testimonial, ink-weight, in the column beside it;
  (3) their lockup, under a hairline so it can be big (2.2–2.7rem) without
  competing — size is not weight.
  **The aside is bottom-anchored to the clip's foot** (2026-08-09): quotes
  differ in line count card to card, and a centred stack left every
  attribution row and hairline at its own height — anchored, hairline and
  lockup share one baseline across the deck and only the quote's top edge
  breathes.
  The aside is **hidden until the card faces you** and arrives on a delay:
  a waiting card is a clip and nothing else, so the deck reads as demos.
  Clips are `preload="none"` behind a poster frame of the demo itself, and
  only the centre card may play — scrolling on pauses it.
- **Every client lockup is a baked tile** (2026-07-28): rounded corners, alpha
  outside the radius, and generous room on all four sides — bake at 486px
  inner width, 64px side / 26px top-bottom padding, 44px radius, on a plate
  sampled from the source art's own corner pixel (a plate that is merely
  *close* leaves the original crop showing as an inner rectangle). Light
  plates take a 1px `#e3e8ed` hairline so a white chip still has an edge on a
  white sheet. Lift with stacked `drop-shadow()`, which follows alpha —
  `box-shadow` would cast a rectangle around the rounded tile. Never ship a
  hard-cut square.
- **The case rail is a coverflow** (2026-07-28): `perspective` on the rail,
  each waiting card turned `rotateY(±32deg)` away from a vanishing point
  fixed at the rail's middle — right-hand card shows its left edge, left-hand
  its right (JS writes `--side` per card as it scrolls). Cards hinge from the
  **near edge** (`transform-origin: calc(50% - var(--side) * 50%)`); hinging
  from the middle pulls the clip out of the gutter and leaves nothing to
  tease. Hover brings a waiting card round to the front and centres it after
  ~130ms of dwell — never while a clip is playing, and never on touch or
  reduced motion, where the deck stands square and still.
  The deck rests `--rail-shift` (4.5rem) **right** of the scrollport centre: a
  box-centred card reads left-heavy because its aside column runs out into
  whitespace. That's `scroll-padding-left: calc(shift * 2)` (a snapped card
  moves half the inset) plus the side padding rebalanced by the same amount,
  so the first card can still reach the shifted rest from `scrollLeft` 0. The
  rail JS reads `scroll-padding-left` back rather than repeating the number.
  **The deck settles under its own tween on wheel/trackpad** (2026-07-28):
  `scroll-snap-type: none` under `(pointer: fine)`, and 90ms after the
  scrolling stops the rail eases to a rest over 560ms (ease-out quint). Native
  snap keeps touch, where momentum and rubber-banding are the platform's job.
  Mandatory snap on a trackpad yanked short flicks back at its own speed and
  stuttered when a flick died mid-gap.
  **The reader always outranks the tween** (2026-07-28): a settle that keeps
  writing `scrollLeft` for 560ms will fight a second flick and feels like the
  deck is stuck. Every scroll event compares `scrollLeft` against the last
  value the tween wrote; a position we did not write is a fresh gesture, and
  it cancels the tween on the spot. Three more fixes in the same pass, each a
  real stutter: `glide()` bailing on a sub-1px span without clearing `tween`
  left a stale truthy id that **blocked every later settle for the rest of the
  session** (reachable by clicking a card mid-glide); `pointerenter` fires
  when the *deck* slides under a still cursor, so the hover pull has to be
  gated on the deck being at rest (plus a 400ms beat after) or it starts a
  second tween toward a card the reader never chose; and `update()` must
  measure all the cards before it writes any, or it forces a synchronous
  layout per card per frame.
  **The deck also drags under a mouse** (2026-08-10): grab anywhere on the
  rail and pull — pointer-fine only, a 6px dead zone so clicks stay clicks,
  scrollLeft written directly so the reader-outranks-tween rule treats it
  as any gesture, the settle held until release, and a real drag swallows
  the click it would otherwise fire on the card under the pointer.
  Cursor: grab/grabbing.
  **A light nudge is enough** (2026-07-28): the commit threshold is ~44px of
  travel (`min(cardStep / 10, 44)`), not a fraction of a card — the cards are
  ~1000px wide, so the old "past a sixth" rule meant a 170px shove to see the
  next demo and the deck felt stuck. Anything shorter eases back to where it
  started, measured from the card the gesture *began* on, not whichever is
  nearest; a hard fling still carries as far as it actually went.

- **The closing ask gets a beat before it** (2026-07-28): the dashboard is a
  dense object and the close is one line and a button, so the two need real
  air between them or the ask reads as a continuation of the section above.
  Deeper padding on both sides of that seam (`#explore .sect` bottom,
  `.close-sect .sect` top) — the mat's foot and the wave shoulder both live in
  that gap.
- **The dashboard section stands on a mat** (2026-07-28): `.explore-plate`, a
  **tide-wash (`#eaf1f7`) plate on a white sheet** (`#explore` is
  `sheet-white`), radius `--r-win + 0.9rem`, wrapping the **whole**
  `.explore-grid` — the dashboard window AND the panel that reads it. Two
  jobs: the white windows need something to sit against, and the mat, not a
  divider, is what separates this section from the closing ask. It holds both
  because they are one instrument; a plate around the dashboard alone left the
  panel reading as a loose card floating beside it. A deep-tide plate was
  tried first and reversed — the dark slab under a light page fought the
  hero's own water for weight. Light plate on white means the cast stays
  faint: it only has to lift the mat off the page, not carve it out. The
  panel's `position: sticky` is bounded by the grid, so it travels down the
  mat as you read and stops at its foot, never outside it.
  **On phones, scroll is the selector** (2026-08-10, replacing one day of a
  static card list): hover doesn't exist and invisible hotspots are a broken
  promise on touch, so the dashboard sticks under the header while the six
  explanations pass beneath it as cards, and the card crossing mid-viewport
  takes the tide ring and lights its widget's ring on the image
  (IntersectionObserver, armed under 52rem only; the grid dissolves to
  `display: contents` so the sticky can travel the whole plate). Same
  information as desktop hover, driven by the gesture a phone already has.
  Hotspots stay visible as rings but stop being tap targets.

## 4. The water

The signature. ASCII character sea on 2D canvas — never rendered 3D.

- Grid: `CELL_W 8`, `CELL_H 10.5`, chars `[' ', '·', '-', '~', '≈', '≋']` by
  wave height, ~15fps (terminal cadence), tide-blue rgba by depth.
- Placement: hero (bottom 62%, top-masked) + thin strips at section seams.
  Sheets dock onto water with filled-sine wave shoulders.
- Scenery is earned, not decorated: the driftwood log with its duck
  captain, one free-swimming duck, ships (never on phone-width strips —
  the sail blurs into a blob), islands (static while water moves),
  terracotta buoys bobbing on station, the odd fish arcing clear of the
  swell, and the proof island's palm. The log's lane clamps above the
  proof island (never runs aground, never hides behind it); the free
  swimmer may paddle behind it. Wide strips may hold two scenes.
- **Movers patrol, never wrap** (2026-07-14): ducks, ships, and the log
  cruise back and forth across the visible span (`patrol()` triangle
  wave) instead of sliding off one edge and teleporting in from the
  other — nothing disappears, it turns around. Sprites face their
  heading (duck head/beak mirror — beaks are the ▸/◂ triangle pair,
  never asymmetric glyphs; SAIL eastbound, SAILW westbound).
- **"Visible span" means visible water** (2026-07-15): the hero
  dashboard window overlays the sea's right side on desktop, so hero
  movers whose lane passes behind it turn around at the window's left
  edge, not the canvas edge — full-canvas patrols meant vanishing
  behind the window for most of every lap ("the duck swam off and never
  came back"). Falls back to the full span when the open water is under
  ~40 cells (stacked/phone hero, where the window doesn't occlude).
- **Every sea strip carries a yellow duck**, always — the ship/island
  silhouettes are company, not stand-ins for the duck.
- **Scenery palette is weathered-coast, not postcard** (settled 2026-07-14
  over two rounds of Aayush feedback): sand is warm ivory, not gold and not
  greige (`176,149,106` wet ▒ / `206,186,146` dry █ — the full-greige
  version "felt depressing", the gold original clashed); the palm is
  sea-glass (`101,125,106`); ONE terracotta (`178,94,66`) covers crab,
  buoys, and coconut. No tropical greens, no reds.
  **Protected exception: the ducks are rubber-duck yellow
  (`240,195,60` + `224,138,46` beak), always.** They are the debugging
  duck — the one deliberate CS in-joke on the page. A gray gull was tried
  2026-07-14 and rejected; never neutralize them for palette purity.
  **The castaway** (2026-07-28): a pixel figure kicked back in a terracotta
  beach chair on the proof island's dry sand, phone to his ear, over a white
  speech bubble reading "hold on, sending you the demo". He is drawn as a
  bitmap of 3px squares (the splash's unit), NOT as block glyphs — at a body
  ~90px tall glyphs read as noise and squares read as a person. He recreates
  the page's whole promise in one joke, so keep him legible: head thrown back
  on the headrest at the top left, spine parallel to the backrest, legs
  stretched down the seat to the right. An earlier upright/hunched pose read
  as someone *working*, which is exactly wrong.
  **He is a stick figure and stays one**: a hollow ring for a head and
  two-pixel lines for spine, arm and legs. The first pass filled the body in
  solid and it read as a seal on a rock — the open ring and the thin limbs are
  what make him a person. Body is tide-deep, chair is the one terracotta, the
  phone is splash-blue (`63,126,169`) so it separates from his head.
  A crab skitters sideways along the proof island's beach (v2 sprite,
  re-added 2026-07-14 on Aayush's ask: ∩ pincers + low ▄▄ body + ʌ leg
  ticks + lateral scuttle — v1's bare block read as a red staple; the
  round claws and sideways motion are what sell the shape).
- The proof island: drawn BY the sea from the `.hero-proof` rect — dithered
  `▒` beach, faint `█` interior, surf piling at the coast. Never a CSS shape.
  The rect is empty as of 2026-07-28 (testimonials moved to the case studies)
  and so carries its own width/height instead of taking one from contents —
  if it ever collapses to zero, the island goes with it.
  It lives on phones too: the stacked hero moves the proof below the window,
  onto the water. Only reduced-motion goes without it.
- **The dashboard and the closing ask are divided by open water**
  (2026-07-28, after a round trip): a `.sea-seam` band — 124px of the same
  ASCII sea the hero carries — stands between them. It was briefly cut and
  then asked back; the version that works is the one where the water has a
  *shore* to run onto, and that only became possible once `#explore` turned
  white. The band is white, so it runs straight out of the dashboard sheet
  with **no** top shoulder (a shoulder its own colour is invisible anyway),
  and the baby-blue close sheet docks onto its far edge with a single
  wave-cut shoulder. Water above, shore below — not a strip of sea boxed in
  by two identical scallops, which is what the first attempt was and why it
  read as ornament.
  Leave real air between the mat's foot and the band (`#explore .sect`
  padding-bottom): the water must not crowd the dashboard.
  The shoulder has to be **absolutely positioned** — see the collapse rule
  below.
- **A sheet shoulder between two sections must be absolutely positioned**
  (2026-07-28, learned the hard way twice): `.sheet::before` carries
  `margin-top: -28px`, which **collapses into its own section** — the section
  box moves up 28px and the shoulder paints *inside* it, over its own
  background. It survives against the footer only by accident (the footer is
  not positioned, so the close sheet's positioned background paints over its
  top strip and the shoulder shows against that). Between two *positioned*
  siblings — every `.landing section` and the `.sea-seam` band — both `position: relative`, so the later one's background wins
  the overlap — the shoulder draws its sheet's colour onto its own colour and
  vanishes. That's why `#explore → .close-sect` looked like a razor-straight
  cut. Fix: lift the shoulder out of flow (`position: absolute; top: -27px;
  margin: 0; z-index: 2`) so it lands on the band *above*, where it can be
  seen. Same move the `.sea-seam` waves always used, same reason.
- Canvases self-heal: every frame checks CSS size vs sized-for size
  (layout can grow after images/fonts load; a stale buffer stretches).

## 5. Motion

- Easing: `--ease-settle` (spring, ~3% overshoot) for transforms; things
  land-and-settle, then idle-bob 1–2px desynced. Buttons 240ms.
- Scroll-scrubs are 1:1 and reversible, only on `min-width: 52rem` AND
  `pointer: fine`. Phones get: the compact pinned how-deck (fits one
  screen), and un-pinned scroll-linked choreography for everything taller
  than a viewport. `prefers-reduced-motion` gets a fully static page.
- Pins measure the pin element, not `innerHeight` (iOS toolbar collapse).
  Pin heights in `svh` on mobile.
- One choreography per pin. If a pin has two payoffs, cut one.

## 6. Copy & universe

- One universe per page: real artifacts from the same story (currently the
  Brex ask → build → review → the anonymized-CTO thread). No fictional
  examples mixed with real ones in the same flow.
- Agent voice in artifacts is lowercase, concrete, short. Marketing voice
  is sentence case, plain verbs, no "supercharge/unlock/effortless".
- Numbers stated as observed fact with attribution ("week one at Autosana"),
  never rounded up.
- Real people/companies only with consent; otherwise redaction bars, and
  scrub the asset filename too. **Testimonials live with the case studies,
  one per client, never invented** — a case ships the moment its clip is
  cleared and the quote slot stays empty until the client sends one. Same
  rule for the *prospect* a demo was built for: unless they've agreed to be
  named, the copy says "the prospect", not the brand.

## 7. Process

- UI changes go through the staging branch (`redesign`-style) with tagged,
  minimal deltas; Aayush reviews on the Vercel preview before prod.
- QA any visibility-gated animation with scrolled screenshots (fullPage
  renders them blank). QA mobile with WebKit + iPhone descriptor, not
  chromium-mobile emulation.
- Baked assets (hero, review-queue, slack-trace, OG) are screenshots of the
  mocked dashboard (`?mock=1`). If the mock or dashboard styling changes,
  RE-SHOOT them in the same commit — a stale bake is a style bug (see the
  black "View all leads" that outlived the button restyle).
- The compare clip is a Remotion project (`compare-gif/`), rendered with
  `npx remotion render CompareGif out/compare.mp4 --scale=2 --codec=h264` and
  copied into `landing/public/`. Its LinkedIn chrome is **measured** off
  `References for Gif/pop up*.png`, not eyeballed — those are 2× screenshots,
  so halve every figure (÷2.2 once their slightly larger message type is
  matched to ours). Eyeballing produced emoji half again too big, near-pill
  corners and menu rows at half height. Whenever a popup's size or position
  changes, **re-measure the cursor's stops off a fresh `remotion still`** —
  the path is hardcoded scene coordinates, and it will silently go on
  clicking where the row used to be. Weight is measurable too: compare ink
  density on the same word (the reference menu is 0.360, regular weight gives
  0.279 — LinkedIn sets its dropdown items semibold).
  The clip's foot is masked away on the site, so **nothing that has to be read
  may play out below the thread** — the compose beat (click, caret, paste,
  Send) was cut for exactly that reason.
- Baked assets ship as WebP (`cwebp -q 85 -m 6 -sharp_yuv`, keep ~2× display
  size for retina); only the OG card stays PNG (link-preview compatibility).
  Below-the-fold `<img>`s get `loading="lazy" decoding="async"`; the hero
  window image gets `fetchPriority="high"`.
- When adding a token/pattern, add it here; when deviating, say why in the
  commit message.
- Dashboard *behavior* (loading states, action feedback, consistency) has its
  own testable bar: `design/ux-principles.md`. Audit and fix against that
  file; tokens and voice stay here.

## 8. Pricing

- The homepage pricing section sits between the dashboard and the existing
  open-water seam before booking. `/pricing` uses the same component and the
  same marketing header/footer content, with neutral page chrome and a straight
  footer border.
- All three plans share one quiet, bordered comparison with equal-width
  columns and aligned names, prices, CTAs, and allowances. Enterprise has the
  same visual weight as Startup. Growth has a subtle #f7f7f7 neutral background
  to give the comparison a focal point. No unsupported popularity badge.
  This replaces the two-card/Enterprise-band draft after the pricing reference
  review on 2026-09-18. Familiar comparison structure is intentional.
- Prices use Public Sans with tabular numbers. State USD and the monthly
  cadence next to every price. Keep "From" attached to Enterprise pricing.
- Plan names lead directly into their prices. Omit buyer-description
  subheadings; the allowances and features carry the plan differences.
- Startup includes 1,000 personalized contacts and up to 250 demos per month;
  Growth includes 5,000 personalized contacts and up to 1,000 demos per month.
  Show contacts and demos as separate feature rows, with the number first.
  Use “/mo” on contact rows so the allowance stays on one line. Stack plans
  below 900px, with narrower phone padding to retain readable type.
  Label the demo cap with a trailing “maximum” so the count leads the row.
  The three allowance rows use inline semibold figures at the same size as
  their labels, without checkmarks;
  feature rows retain their checks. Enterprise volumes are set on a call.
- Keep the header short with billing terms immediately beneath it. Each plan
  lists its own allowances and shared benefits explicitly, so it can be read
  independently. No inheritance text (“Everything in…”), list-introduction
  label, separate shared benefits block, or “One prospect. One demo.” block.
  All content is readable without JavaScript.
- Keep the cards concise: show contact, demo, and inbox counts first. Channels
  and founder Slack are repeated in all three plans.
  Lead sourcing and domain purchasing remain included but their separate
  feature rows are omitted from the cards.
- **Pricing is a user-directed exception to the global voice/color rules**
  (2026-09-18): plain Public Sans, no italics, no colored heading accents. A
  simple “Pricing” heading, 500-weight plan names, 600-weight prices, regular
  0.9375rem feature text with 0.75rem row gaps, and 1px #e8e8e8 borders. The brand wordmark
  remains unchanged. All pricing CTAs and the pricing header booking button use
  #15557e blue with a 6px radius and #0d3c5b hover feedback.
- All three pricing CTAs say “Book a demo”, link to /#book, and track their
  respective tier placement, including pricing-enterprise.
- Pricing adds no scroll animation. Links retain visible focus. No chromatic
  tier accents, shadows, or decorative badges. The comparison has 12px outer
  corners and slightly roomier column padding.
- On narrow phones the header prioritizes Pricing and Book a demo; Log in is
  hidden below 40rem to keep the controls from colliding with the wordmark.
