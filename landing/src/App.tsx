import CustomerStories from "./components/CustomerStories";
/* Landing page — production port of design/landing-draft-v7.html.
   The markup, CSS (scoped under .landing in index.css), scroll scrubs, and
   the 2D-canvas ASCII sea are ported 1:1 from the approved draft. */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { trackCta } from "./track";
import { CAL_URL } from "./components/BookDemo";
import { MarketingNav, MarketingFooter } from "./components/MarketingChrome";
import PricingSection from "./components/PricingSection";
import InlineBooking from "./components/InlineBooking";


/* The hero waterline: a band of monospace wave characters, sparse at the top
   and denser toward the bottom, that the gif card appears to rise out of.
   Generated deterministically (no Math.random) so the prerender and the
   client render byte-for-byte the same grid — a mismatch here would hydrate
   into a flicker. Two identical copies are laid side by side and the strip
   drifts one copy's width sideways on a loop, so the surface reads as alive. */
const WAVE_CHARS = [" ", "·", "∼", "~", "≈"]; // (space) · ∼ ~ ≈
function waveBand(cols: number, rows: number): string {
  const lines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const density = 0.32 + (r / (rows - 1)) * 0.68; // rows deepen toward the bottom
    let line = "";
    for (let c = 0; c < cols; c++) {
      const v =
        (Math.sin(c * 0.5 + r * 0.9) + Math.sin(c * 0.21 - r * 0.5) + Math.sin(c * 0.11)) / 3; // -1..1 swell
      const lvl = Math.round(((v + 1) / 2) * density * (WAVE_CHARS.length - 1));
      line += WAVE_CHARS[Math.max(0, Math.min(WAVE_CHARS.length - 1, lvl))];
    }
    lines.push(line);
  }
  return lines.join("\n");
}
const WATERBAND = waveBand(480, 16);

/* The hero card plops into the sea on load and throws a little pixel splash.
   Droplets are generated deterministically (index-based, no Math.random) so
   the prerender and the client agree; each carries its own throw (--dx),
   apex (--peak), landing (--fall) and stagger (--delay) as CSS custom props
   that one keyframe reads. Center droplets fly highest; edges fan wider. */
const SPLASH: CSSProperties[] = Array.from({ length: 30 }, (_, i) => {
  const n = 30;
  const dir = i / (n - 1) - 0.5; // -0.5 (left) .. 0.5 (right)
  const dx = dir * 480 + ((i % 2) - 0.5) * 30; // horizontal throw, jittered
  const peak = -(80 + (0.5 - Math.abs(dir)) * 140 + (i % 3) * 12); // center highest
  const fall = 44 + Math.abs(dir) * 34;
  const size = 5 + ((i * 7) % 5); // 5..9px pixels
  const delay = Math.abs(dir) * 0.05 + (i % 2) * 0.015;
  return {
    "--dx": `${dx.toFixed(1)}px`,
    "--peak": `${peak.toFixed(1)}px`,
    "--fall": `${fall.toFixed(1)}px`,
    "--size": `${size}px`,
    "--delay": `${delay.toFixed(3)}s`,
  } as CSSProperties;
});

/* the interactive dashboard section: hotspots over the baked dashboard image
   (positions are % of the image so they scale with it). Hovering one lights it
   up and fills the info panel; nothing hovered shows the prompt. The image and regions are captured from the current overview with
   scripts/refresh-dashboard-shot.mjs; coordinates are percentages of that image. */
type Widget = { id: string; l: number; t: number; w: number; h: number; title: string; body: string };
const WIDGETS: Widget[] = [
  { id: "linkedin", l: 0.00, t: 8.56, w: 66.00, h: 16.28,
    title: "See today’s outbound at a glance",
    body: "Track email volume, remaining capacity, queued outreach, and the messages waiting for review." },
  { id: "results", l: 0.00, t: 25.99, w: 100.00, h: 23.26,
    title: "Track your conversion rates",
    body: "Meetings booked, replies, and reply rate, updated the moment each one lands." },
  { id: "pipeline", l: 0.00, t: 60.87, w: 100.00, h: 18.18,
    title: "Keep campaigns moving",
    body: "Open a campaign to see its audience, outreach sequence, and current status." },
  { id: "latest", l: 68.07, t: 13.75, w: 30.11, h: 9.61,
    title: "Daily movement across your accounts",
    body: "See recent sends at a glance, then open Inbox for sent messages and replies." },
  { id: "leads", l: 0.00, t: 50.39, w: 100.00, h: 9.33,
    title: "Find leads that fit your ICP",
    body: "Bring a CSV or let us source them. We match and enrich every lead either way." },
  { id: "blacklist", l: 0.00, t: 80.21, w: 100.00, h: 19.79,
    title: "We keep track so you don't have to",
    body: "We exclude do-not-contact emails, domains, and URLs from every send." },
];

/* The demo, as a crisp 2x video (the old 484x591 gif was 256-colour and
   dithered — it blurred the moment it scaled). One shell wraps it with a
   bezel + layered shadow so it reads as a physical, lit object. Mounted
   inline in both the hero and the compare slot. */
function GifMedia() {
  return (
    <div className="gif-shell">
      <div className="gif-reveal">
        <video
          className="gif-media"
          src="/compare.mp4"
          poster="/compare-poster.png"
          width={484}
          height={591}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-label="A generic AI cold email is selected, deleted, and replaced by a driftwood message with a custom demo video. The CTO replies and a call is booked."
        />
      </div>
    </div>
  );
}

export default function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const seaRef = useRef<HTMLCanvasElement>(null);
  const howWrapRef = useRef<HTMLDivElement>(null);
  const cmpSectRef = useRef<HTMLElement>(null);
  const washRef = useRef<HTMLDivElement>(null);
  // wash-in progress (0..1), shared with the sea draw so the hero pixels
  // densify in step with the arriving water instead of on a fixed gradient
  const washPRef = useRef(0);
  // sea state: null = trying, true = live (strips shown), false = fallback (canvases removed)
  const [seaLive, setSeaLive] = useState<boolean | null>(null);
  // interactive dashboard: id of the hovered/selected widget, or null
  const [sel, setSel] = useState<string | null>(null);

  /* the how-stage pinned scrub (the slop-vs-real section is now a
     self-animating gif — no choreography needed) */
  useEffect(() => {
    const root = rootRef.current;
    const pinWrap = howWrapRef.current;
    if (!root || !pinWrap) return;

    const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cleanups: (() => void)[] = [];

    // pinned scrub: scroll cycles the stage while the rail highlights.
    // This one fits a phone screen, so it scrubs everywhere motion is on.
    const cards = [...root.querySelectorAll(".stage-card")];
    const items = [...root.querySelectorAll(".rail-list li")];
    const howPin = pinWrap.querySelector(".pin") as HTMLElement | null;
    if (!reduceMotion) {
      let raf = 0;
      const update = () => {
        raf = 0;
        // measure the pin, not innerHeight — iOS toolbar collapse changes
        // innerHeight mid-scroll and would make the scrub jump
        const total = pinWrap.offsetHeight - (howPin?.offsetHeight ?? innerHeight);
        if (total <= 0) return;
        const p = Math.min(0.999, Math.max(0, -pinWrap.getBoundingClientRect().top / total));
        // one artifact at a time: a scrubbed crossfade, each photo fully visible
        const prog = p * (cards.length - 1) * 1.18 - 0.09; // small dwell at both ends
        cards.forEach((c, i) => {
          const el = c as HTMLElement;
          const d = i - Math.min(cards.length - 1, Math.max(0, prog));
          const a = Math.max(0, 1 - Math.abs(d));
          el.style.opacity = `${a}`;
          el.style.transform = `translateY(${d * 46}px) scale(${1 - Math.abs(d) * 0.015})`;
          el.style.zIndex = `${10 + Math.round(a * 10)}`;
          el.style.pointerEvents = a > 0.5 ? "auto" : "none";
        });
        const step = Math.min(cards.length - 1, Math.max(0, Math.round(prog)));
        items.forEach((li, i) => {
          const el = li as HTMLElement;
          const d = Math.min(1, Math.abs(i - prog));
          el.style.transform = `translateX(${(1 - d) * 10}px) scale(${1 + (1 - d) * 0.14})`;
          el.style.opacity = `${1 - d * 0.55}`;
          li.classList.toggle("active", i === step);
        });
      };
      const onScroll = () => {
        if (!raf) raf = requestAnimationFrame(update);
      };
      addEventListener("scroll", onScroll, { passive: true });
      cleanups.push(() => {
        removeEventListener("scroll", onScroll);
        if (raf) cancelAnimationFrame(raf);
      });
      update();
    } else {
      /* static stack on mobile / reduced motion via CSS */
    }

    // compare wash: the sea's dark water washes down over the section as it
    // arrives, then pulls back up like a retreating wave as the next sheet
    // takes over. Scroll-linked 1:1; reduced motion keeps the sheet white.
    const cmpSect = cmpSectRef.current;
    const wash = washRef.current;
    // the wash choreography (dark water washing over, retreating onto the
    // sand, wiping the gif) is a desktop scroll effect. On phones the compare
    // section is tall and stacked, so a single washed-state layer smears white
    // text over uncovered rows — there we keep the section plainly white and
    // let the sand testimonial simply follow (design-language §5).
    if (cmpSect && wash && !reduceMotion && matchMedia("(min-width: 52rem)").matches) {
      // the compare gif is masked crisply by the waterline as the wave pulls
      // back on scroll-down — nothing left below the retreating edge
      const gifEl = cmpSect.querySelector(".compare-gif .gif-shell") as HTMLElement | null;
      // the lowest checkpoint sinks away with the gif on the pull-back
      const lastPoint = cmpSect.querySelector(".compare-points li:last-child") as HTMLElement | null;
      let rafW = 0;
      const updateW = () => {
        rafW = 0;
        const vh = innerHeight;
        const r = cmpSect.getBoundingClientRect();
        // pIn tracks the section's arrival — used only to deepen the hero sea
        // into the water below as you approach (the wash itself doesn't animate
        // in; it's simply already down)
        const pIn = Math.min(1, Math.max(0, (vh - r.top) / (vh * 0.85)));
        washPRef.current = pIn;
        // the water is already blue when you enter the section and only moves on
        // the way out: the wave retreats up as the section exits
        const pOut = Math.min(1, Math.max(0, (vh * 0.95 - r.bottom) / (vh * 1.1)));
        const ty = Math.max(-101, Math.min(0, -pOut * 101));
        wash.style.transform = `translateY(${ty}%)`;
        // fully parked away → hide, so the crest can't peek over the seam
        wash.style.opacity = ty <= -100.5 ? "0" : "1";
        // the crest drifts sideways with the scroll itself — still water
        // when the reader is still, alive while they move
        wash.style.setProperty("--wave-x", `${-(scrollY * 0.35) % 180}px`);

        // on retreat, the waterline wipes the gif as the wave pulls back:
        // the mask edge tracks the wash's bottom so the gif dissolves at the
        // exact water surface, nothing left below it. Off-retreat it's whole.
        if (gifEl) {
          const gr = gifEl.getBoundingClientRect();
          let mask = "none";
          if (pOut > 0) {
            const washBottom = r.height * (1 + ty / 101); // px from sheet top
            const cut = washBottom - (gr.top - r.top); // waterline within the gif
            if (cut < gr.height + 4) {
              mask = `linear-gradient(180deg, #000 ${cut - 4}px, transparent ${cut + 6}px)`;
            }
          }
          gifEl.style.maskImage = mask;
          gifEl.style.webkitMaskImage = mask;
        }
        // "Higher conversion…" is wiped off by the waterline just like the gif —
        // the same mask edge tracks the wash's bottom so the wave sweeps it away
        if (lastPoint) {
          const pr = lastPoint.getBoundingClientRect();
          let pmask = "none";
          if (pOut > 0) {
            const washBottom = r.height * (1 + ty / 101);
            const cut = washBottom - (pr.top - r.top);
            if (cut < pr.height + 6) {
              pmask = `linear-gradient(180deg, #000 ${cut - 2}px, transparent ${cut + 5}px)`;
            }
          }
          lastPoint.style.maskImage = pmask;
          lastPoint.style.webkitMaskImage = pmask;
        }

        // section 3 eases into focus as the wave uncovers it: soft and dim
        // while underwater, sharpening as it surfaces
        const howGrid = pinWrap.querySelector(".how-grid") as HTMLElement | null;
        if (howGrid) {
          const wt = pinWrap.getBoundingClientRect().top;
          const p3 = Math.min(1, Math.max(0, (vh - wt) / (vh * 0.55)));
          howGrid.style.filter = p3 >= 1 ? "none" : `blur(${(1 - p3) * 7}px)`;
          howGrid.style.opacity = `${0.3 + 0.7 * p3}`;
        }
        // flip the type light as soon as the water's leading edge passes the
        // heading — it sits in the sheet's top quarter, which is covered once
        // the wash hangs ~28% down (ty above -72)
        cmpSect.classList.toggle("washed", ty > -72);
      };
      const onScrollW = () => {
        if (!rafW) rafW = requestAnimationFrame(updateW);
      };
      addEventListener("scroll", onScrollW, { passive: true });
      cleanups.push(() => {
        removeEventListener("scroll", onScrollW);
        if (rafW) cancelAnimationFrame(rafW);
      });
      updateW();
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  /* one body of water, drawn as ASCII: the hero sea and the thin divider
     strips are character grids animated by a shared wave field, phase-seeded
     by document position. A lone piece of driftwood bobs across the hero.
     Static wave-cut seams remain the fallback on mobile / reduced motion. */
  useEffect(() => {
    const root = rootRef.current;
    const heroCanvas = seaRef.current;
    const motionOk = matchMedia("(prefers-reduced-motion: no-preference)").matches;
    if (!root || !heroCanvas || !motionOk) {
      setSeaLive(false);
      return;
    }

    const cleanups: (() => void)[] = [];
    const proofEl = root.querySelector(".hero-proof") as HTMLElement | null;
    const backedEl = root.querySelector(".hero-backed") as HTMLElement | null;
    const winEl = root.querySelector(".app-window") as HTMLElement | null;
    const CHARS = [" ", "\u00b7", "-", "~", "\u2248", "\u224b"]; // · - ~ ≈ ≋ by wave height
    const CELL_W = 8;
    const CELL_H = 10.5;
    const WOOD = "\u2597\u2584\u2584\u2584\u2584\u2584\u2584\u2596"; // ▗▄▄▄▄▄▄▖ a drifting log
    const SAIL = "\u259f\u258c"; // ▟▌
    const SAILW = "\u2590\u2599"; // ▐▙ westbound (mirrored)
    const HULL = "\u2580\u2580\u2580\u2580"; // ▀▀▀▀
    const ISLE = "\u2581\u2582\u2583\u2584\u2583\u2582\u2581"; // ▁▂▃▄▃▂▁

    type Mount = {
      canvas: HTMLCanvasElement;
      ctx: CanvasRenderingContext2D;
      strip: boolean;
      phase: number;
      cols: number;
      rows: number;
      w: number;
      h: number;
      visible: boolean;
    };
    const mounts: Mount[] = [];

    function mountSea(canvas: HTMLCanvasElement, strip: boolean) {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const m: Mount = {
        canvas,
        ctx,
        strip,
        phase: (canvas.getBoundingClientRect().top + scrollY) * 0.02,
        cols: 0,
        rows: 0,
        w: 0,
        h: 0,
        visible: false,
      };
      const io = new IntersectionObserver((es) => {
        for (const e of es) m.visible = e.isIntersecting;
      });
      io.observe(canvas);
      cleanups.push(() => io.disconnect());
      mounts.push(m);
    }

    mountSea(heroCanvas, false);
    root
      .querySelectorAll<HTMLCanvasElement>(".sea-strip")
      .forEach((c) => mountSea(c, true));
    setSeaLive(true);

    const dpr = Math.min(devicePixelRatio, 2);
    const sizeMount = (m: Mount) => {
      const w = m.canvas.clientWidth,
        h = m.canvas.clientHeight;
      if (!w || !h) return;
      m.canvas.width = w * dpr;
      m.canvas.height = h * dpr;
      m.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // strips run a size down: their 112px bands read denser that way
      m.ctx.font = `${m.strip ? 11 : 12}px ui-monospace, "SF Mono", Menlo, monospace`;
      m.ctx.textBaseline = "middle";
      m.cols = Math.ceil(w / CELL_W);
      m.rows = Math.ceil(h / CELL_H);
      m.w = w;
      m.h = h;
      m.phase = (m.canvas.getBoundingClientRect().top + scrollY) * 0.02;
    };
    const resize = () => mounts.forEach(sizeMount);
    addEventListener("resize", resize);
    cleanups.push(() => removeEventListener("resize", resize));
    resize();

    const wave = (x: number, y: number, t: number, phase: number) =>
      Math.sin(x * 0.42 + t * 1.05 + phase) * 0.42 +
      Math.sin(y * 0.9 + t * 0.7 + phase) * 0.24 +
      Math.sin((x + y) * 0.23 + t * 1.3 + phase * 0.6) * 0.16 +
      Math.sin(x * 0.07 - t * 1.1 + phase) * 0.34; // the rolling swell

    // patrol: movers cruise back and forth across the visible span instead
    // of sliding off one edge and teleporting in from the other — nothing
    // in the scene ever disappears, it just turns around
    const patrol = (tt: number, speed: number, seed: number, min: number, max: number) => {
      const L = Math.max(4, max - min);
      const c = (((tt * speed + seed) % (2 * L)) + 2 * L) % (2 * L);
      return c < L ? { x: min + c, dir: 1 } : { x: min + 2 * L - c, dir: -1 };
    };

    let last = 0;
    let rafId = 0;
    const tick = (ms: number) => {
      rafId = requestAnimationFrame(tick);
      if (ms - last < 66) return; // ~15fps: water at terminal cadence
      last = ms;
      const tBase = ms / 1000;
      for (const m of mounts) {
        if (!m.visible) continue;
        if (!m.cols) sizeMount(m); // strips are display:none until sea-live commits
        if (!m.cols) continue;
        if (m.canvas.clientWidth !== m.w || m.canvas.clientHeight !== m.h) sizeMount(m);
        const { ctx, cols, rows, strip, phase } = m;
        // the hero sea runs at a calmer tempo than the seam strips — the big
        // body of water reads better slow; everything (swell + movers) scales
        // off this one clock
        const t = strip ? tBase : tBase * 0.5;
        ctx.clearRect(0, 0, m.canvas.clientWidth, m.canvas.clientHeight);
        // the proof island: the hero sea reserves ground under the quote and
        // draws it in the same character grid, waves lapping at the coast
        let isl: { cx: number; cy: number; rx: number; ry: number } | null = null;
        if (!strip && proofEl) {
          const pr = proofEl.getBoundingClientRect();
          const cr = m.canvas.getBoundingClientRect();
          if (pr.width > 0 && pr.bottom > cr.top + 6 && pr.top < cr.bottom) {
            isl = {
              cx: (pr.left + pr.width / 2 - cr.left) / CELL_W,
              cy: (pr.top + pr.height / 2 - cr.top) / CELL_H,
              rx: pr.width / 2 / CELL_W + 4.5,
              ry: pr.height / 2 / CELL_H + 2,
            };
          }
        }
        const islE = (c: number, r: number) =>
          isl ? ((c - isl.cx) / isl.rx) ** 2 + ((r - isl.cy) / isl.ry) ** 2 : 99;
        // the backed-by line floats on this water, and glyphs running under
        // the lockup read as mud — so the sea parts around it: an ellipse of
        // calm measured off the line's CONTENT (first/last child union — the
        // <p> box itself spans the island's full width), water skipped
        // inside, a faint lap ring at the edge. Same trick as the island,
        // minus the coast: a calm patch, not dry land.
        let bk: { cx: number; cy: number; rx: number; ry: number } | null = null;
        if (!strip && backedEl && backedEl.firstElementChild && backedEl.lastElementChild) {
          const fr = backedEl.firstElementChild.getBoundingClientRect();
          const lr = backedEl.lastElementChild.getBoundingClientRect();
          const cr = m.canvas.getBoundingClientRect();
          const left = Math.min(fr.left, lr.left);
          const right = Math.max(fr.right, lr.right);
          const top = Math.min(fr.top, lr.top);
          const bottom = Math.max(fr.bottom, lr.bottom);
          if (right > left && bottom > cr.top + 6 && top < cr.bottom) {
            bk = {
              cx: (left + (right - left) / 2 - cr.left) / CELL_W,
              cy: (top + (bottom - top) / 2 - cr.top) / CELL_H,
              rx: (right - left) / 2 / CELL_W + 3,
              ry: (bottom - top) / 2 / CELL_H + 1.4,
            };
          }
        }
        const bkE = (c: number, r: number) =>
          bk ? ((c - bk.cx) / bk.rx) ** 2 + ((r - bk.cy) / bk.ry) ** 2 : 99;
        // the dashboard window sails over the sea's right side on desktop.
        // A mover whose lane passes behind it must turn around at the
        // window's edge, not the canvas edge — patrolling the full width
        // means vanishing behind the window for most of every lap
        let openCols = cols;
        let winBottomRow = -1;
        if (!strip && winEl) {
          const wr2 = winEl.getBoundingClientRect();
          const cr2 = m.canvas.getBoundingClientRect();
          if (wr2.bottom > cr2.top + CELL_H && wr2.left > cr2.left && wr2.left < cr2.right) {
            const leftCols = (wr2.left - cr2.left) / CELL_W - 1;
            if (leftCols > 40) {
              // enough open water to be worth confining the patrol to
              openCols = leftCols;
              winBottomRow = (wr2.bottom - cr2.top) / CELL_H;
            }
          }
        }
        const laneMax = (laneRow: number, span: number) =>
          Math.max(6, (laneRow < winBottomRow ? openCols : cols) - span);
        for (let r = 0; r < rows; r++) {
          // hero: sparse at the horizon, denser toward the bottom
          const depth = strip ? 0.85 : 0.5 + (r / rows) * 0.45;
          // the last rows densify and deepen toward the dark sheet below, so
          // the pixels dissolve into the compare wash instead of stopping
          const deepen = strip
            ? 0
            : Math.min(1, Math.max(0, (r / rows - 0.62) / 0.3)) * washPRef.current;
          const baseFill = `rgba(21, 85, 126, ${Math.min(1, depth * 0.88 + deepen * 0.6)})`;
          if (deepen > 0) {
            // the water column fills in behind the chars in the same accent
            // blue the chars are drawn in, reaching full alpha a few rows
            // early — the last rows ARE the wash's top color, chars and all
            ctx.fillStyle = `rgba(21, 85, 126, ${Math.min(1, Math.pow(deepen, 1.5))})`;
            ctx.fillRect(0, r * CELL_H, m.w, CELL_H + 1);
          }
          ctx.fillStyle = baseFill;
          const y = r * CELL_H + CELL_H / 2;
          for (let c = 0; c < cols; c++) {
            const e = islE(c, r);
            if (e <= 1) continue; // dry land: the island is drawn below
            const eb = bkE(c, r);
            if (eb <= 1) continue; // the calm patch the backed-by line floats in
            const v = wave(c, r, t, phase); // -1..1
            if (eb <= 1.5) {
              // the lap at the calm patch's edge: only the taller swell
              // registers, dimmer than open water — a ring, not a coast
              if (v > 0.45) {
                ctx.fillStyle = `rgba(21, 85, 126, ${Math.min(0.5, depth * 0.5)})`;
                ctx.fillText(CHARS[3], c * CELL_W, y);
                ctx.fillStyle = baseFill;
              }
              continue;
            }
            if (e <= 1.5) {
              // surf: water piles up against the coastline
              if (v > -0.2) {
                ctx.fillStyle = `rgba(21, 85, 126, ${Math.min(0.9, depth * (0.7 + v * 0.4))}`.concat(")");
                ctx.fillText(v > 0.5 ? CHARS[5] : CHARS[4], c * CELL_W, y);
                ctx.fillStyle = baseFill;
              }
              continue;
            }
            const idx = Math.max(
              0,
              Math.min(CHARS.length - 1, Math.round((v + 1.16) * 0.5 * (CHARS.length - 2) + (strip ? 0.85 : (r / rows) * 1.7 + 0.1) + deepen * 2.4 - 0.35)),
            );
            if (idx === 0) continue;
            if (v > 0.82) {
              ctx.fillStyle = `rgba(21, 85, 126, ${Math.min(0.95, depth * 1.15)})`;
              ctx.fillText(CHARS[5], c * CELL_W, y);
              ctx.fillStyle = baseFill;
            } else {
              ctx.fillText(CHARS[idx], c * CELL_W, y);
            }
          }
        }
        if (isl) {
          // dry land in the same grid: solid blocks inland, dithered beach
          const r0 = Math.max(0, Math.floor(isl.cy - isl.ry)),
            r1 = Math.min(rows, Math.ceil(isl.cy + isl.ry) + 1);
          const c0 = Math.max(0, Math.floor(isl.cx - isl.rx)),
            c1 = Math.min(cols, Math.ceil(isl.cx + isl.rx) + 1);
          for (let r = r0; r < r1; r++) {
            const y = r * CELL_H + CELL_H / 2;
            for (let c = c0; c < c1; c++) {
              const e = islE(c, r);
              if (e > 1) continue;
              if (e > 0.62) {
                ctx.fillStyle = "rgba(176, 149, 106, 0.5)";
                ctx.fillText("▒", c * CELL_W, y); // ▒ beach, wet sand — warm, not gold
              } else {
                ctx.fillStyle = "rgba(206, 186, 146, 0.32)";
                ctx.fillText("█", c * CELL_W, y); // █ dry sand, soft ivory under the text
              }
            }
          }
          // A small grove replaces the castaway. It uses the same character
          // grid and restrained sea-glass green as the original palm so the
          // island feels fuller without turning into a separate illustration.
          const drawPalm = (x: number, y: number, scale: number, lean: number) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.scale(scale, scale);
            ctx.rotate(lean);
            ctx.font = "15px ui-monospace, Menlo, monospace";
            ctx.fillStyle = "rgba(101, 125, 106, 0.92)";
            ctx.fillText("▂", -3, -52);
            ctx.fillText("▚", -16, -46);
            ctx.fillText("▞", 8, -46);
            ctx.fillText("▄", -26, -40);
            ctx.fillText("▄", 20, -40);
            ctx.fillText("▖", -30, -32);
            ctx.fillText("▗", 26, -32);
            ctx.fillStyle = "rgba(178, 94, 66, 0.92)";
            ctx.font = "10px ui-monospace, Menlo, monospace";
            ctx.fillText("●", -4, -36);
            ctx.fillStyle = "rgba(121, 85, 52, 0.95)";
            ctx.font = "15px ui-monospace, Menlo, monospace";
            ctx.fillText("▐", -4, -26);
            ctx.fillText("▐", -1, -14);
            ctx.fillText("▌", 2, -2);
            ctx.restore();
          };

          // All three trunks meet the island's upper ridge, leaving the open
          // sand below them clear rather than planting the grove mid-island.
          drawPalm((isl.cx - isl.rx * 0.54) * CELL_W, (isl.cy - isl.ry * 0.54) * CELL_H, 0.62, -0.08);
          drawPalm((isl.cx + isl.rx * 0.02) * CELL_W, (isl.cy - isl.ry * 0.58) * CELL_H, 0.78, 0.05);
          drawPalm((isl.cx + isl.rx * 0.62) * CELL_W, (isl.cy - isl.ry * 0.62) * CELL_H, 1, -0.025);

          // A large pixel inscription makes the island itself the handoff to
          // the proof below. It owns the open sand between grove and wreck,
          // with a block-built arrow rather than an icon glyph.
          const hintX = (isl.cx - isl.rx * 0.34) * CELL_W;
          const hintY = (isl.cy + isl.ry * 0.02) * CELL_H;
          ctx.save();
          ctx.translate(hintX, hintY);
          ctx.rotate(-0.014);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "rgba(255, 255, 255, 0.72)";
          ctx.font = "700 14px ui-monospace, Menlo, monospace";
          ctx.fillText("scroll to see", 1, -4);
          ctx.font = "800 16px ui-monospace, Menlo, monospace";
          ctx.fillText("testimonials", 1, 13);
          ctx.fillStyle = "rgba(13, 60, 91, 0.96)";
          ctx.font = "700 14px ui-monospace, Menlo, monospace";
          ctx.fillText("scroll to see", 0, -5);
          ctx.font = "800 16px ui-monospace, Menlo, monospace";
          ctx.fillText("testimonials", 0, 12);
          ctx.fillStyle = "rgba(178, 94, 66, 0.94)";
          ctx.fillRect(-1.5, 25, 3, 15);
          ctx.fillRect(-10, 36, 6, 3);
          ctx.fillRect(4, 36, 6, 3);
          ctx.fillRect(-7, 39, 6, 3);
          ctx.fillRect(1, 39, 6, 3);
          ctx.fillRect(-4, 42, 8, 3);
          ctx.fillRect(-1.5, 45, 3, 4);
          ctx.restore();

          // A beached, old-world galleon sits crooked beside the surf. The
          // raised stern, square sails and two bare masts suggest a pirate-era
          // ship without adding a flag, crest or other pirate symbol.
          const drawWreck = (x: number, y: number, scale: number) => {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(-0.12);
            ctx.scale(scale, scale);

            const pixel = (px: number, py: number, pw: number, ph: number, ink: string) => {
              ctx.fillStyle = ink;
              ctx.fillRect(px, py, pw, ph);
            };
            const hull = "rgba(13, 60, 91, 0.95)";
            const warm = "rgba(178, 94, 66, 0.94)";
            const timber = "rgba(121, 85, 52, 0.95)";
            const sail = "rgba(101, 125, 106, 0.88)";
            const sailSoft = "rgba(126, 145, 119, 0.72)";
            const rope = "rgba(121, 85, 52, 0.58)";

            // High stern, long gunwale and a stepped keel give the hull a
            // heavier galleon profile. Tiny pale ports and warm planking keep
            // the detail legible without turning into pirate iconography.
            pixel(-43, -24, 3, 15, timber); // stern rail
            pixel(-43, -24, 16, 3, timber);
            pixel(-40, -20, 13, 11, hull); // raised sterncastle
            pixel(-35, -17, 67, 5, hull);
            pixel(-38, -12, 78, 5, timber);
            pixel(-35, -7, 72, 6, hull);
            pixel(-29, -1, 60, 5, hull);
            pixel(-21, 4, 43, 4, hull);
            pixel(37, -10, 9, 3, hull); // pointed bow
            pixel(43, -13, 6, 3, timber); // bowsprit
            pixel(-31, -10, 15, 3, warm);
            pixel(-12, -10, 15, 3, warm);
            pixel(7, -10, 15, 3, warm);
            pixel(26, -10, 8, 3, warm);
            pixel(-25, -5, 3, 3, sailSoft);
            pixel(-7, -5, 3, 3, sailSoft);
            pixel(11, -5, 3, 3, sailSoft);
            pixel(25, -5, 3, 3, sailSoft);
            pixel(-2, -3, 3, 10, "rgba(255, 255, 255, 0.68)"); // split keel

            // Two bare-topped masts carry broad, stepped square sails. The
            // irregular lower edges make the ship feel weathered and wrecked.
            pixel(-12, -70, 3, 57, timber);
            pixel(18, -58, 3, 45, timber);
            pixel(-30, -59, 38, 3, timber);
            pixel(-28, -37, 35, 3, timber);
            pixel(7, -49, 31, 3, timber);
            pixel(9, -30, 29, 3, timber);

            pixel(-27, -55, 32, 4, sail);
            pixel(-29, -51, 34, 10, sail);
            pixel(-27, -41, 31, 3, sail);
            pixel(-25, -33, 29, 4, sailSoft);
            pixel(-27, -29, 31, 10, sailSoft);
            pixel(-22, -19, 25, 3, sailSoft);

            pixel(10, -45, 25, 4, sailSoft);
            pixel(8, -41, 27, 9, sailSoft);
            pixel(11, -32, 24, 3, sailSoft);
            pixel(12, -26, 23, 4, sail);
            pixel(10, -22, 25, 8, sail);
            pixel(14, -14, 20, 3, sail);

            // Block-stepped rigging and a little torn jib add old-world detail
            // while preserving the intentionally low-resolution illustration.
            pixel(-38, -22, 2, 4, rope);
            pixel(-34, -29, 2, 5, rope);
            pixel(-30, -36, 2, 5, rope);
            pixel(-26, -43, 2, 5, rope);
            pixel(38, -15, 2, 4, rope);
            pixel(34, -22, 2, 4, rope);
            pixel(30, -29, 2, 4, rope);
            pixel(26, -36, 2, 4, rope);
            pixel(24, -43, 2, 4, rope);
            pixel(39, -36, 3, 4, sailSoft);
            pixel(39, -32, 7, 4, sailSoft);
            pixel(39, -28, 11, 4, sailSoft);
            pixel(39, -24, 7, 3, sailSoft);

            // Washed-up spars make the crash read as a wreck rather than a
            // ship deliberately parked on the beach.
            pixel(45, 4, 15, 3, timber);
            pixel(52, 10, 11, 3, warm);
            ctx.restore();
          };

          drawWreck((isl.cx + isl.rx * 0.36) * CELL_W, (isl.cy + isl.ry * 0.62) * CELL_H, 1.4);
          // the crab, v2 (v1's bare block read as a red staple): round ∩
          // pincers over a low body, skittering along the opposite beach
          const scut = -isl.rx * 0.35 + Math.sin(t * 0.45 + 1.3) * isl.rx * 0.16 + Math.sin(t * 5.2) * 0.22;
          const crx = (isl.cx + scut) * CELL_W;
          const cry = (isl.cy + isl.ry * 0.74) * CELL_H;
          ctx.fillStyle = "rgba(178, 94, 66, 0.95)"; // terracotta, the one warm accent
          ctx.font = "bold 9px ui-monospace, Menlo, monospace";
          ctx.fillText("∩", crx - 6.5, cry - 7.5);
          ctx.fillText("∩", crx + 3, cry - 7.5);
          ctx.font = "bold 11px ui-monospace, Menlo, monospace";
          ctx.fillText("▄▄", crx - 6, cry - 3);
          ctx.font = "7px ui-monospace, Menlo, monospace";
          ctx.fillText("ʌʌʌ", crx - 4.5, cry + 2); // legs, tucked under the body
        }
        const duck = (seed: number, rowF: number, max = cols - 3.5) => {
          // the rubber duck stays rubber-duck yellow \u2014 it's the debugging
          // duck, the one deliberate in-joke; a gray gull was tried and
          // rejected (the yellow IS the point)
          const { x: dx, dir } = patrol(t, 1.15, seed, 1, max);
          const dy = rowF * rows + wave(dx, rowF * rows, t, phase) * 1.9;
          if (islE(dx + 0.8, dy) <= 1.3) return; // ducks paddle behind the island
          const y = dy * CELL_H + CELL_H / 2;
          ctx.fillStyle = "rgba(240, 195, 60, 0.95)";
          ctx.fillText("\u2586\u2586", dx * CELL_W, y); // body
          ctx.fillText(dir > 0 ? "\u259d" : "\u2598", (dir > 0 ? dx + 1.55 : dx - 0.55) * CELL_W, y - CELL_H * 0.52); // head
          ctx.fillStyle = "rgba(224, 138, 46, 0.95)";
          // mirrored solid triangles \u2014 the old \u2023/\u2039 pair gave the
          // eastbound duck a filled beak and the westbound one a thin chevron
          ctx.fillText(dir > 0 ? "\u25b8" : "\u25c2", (dir > 0 ? dx + 2.3 : dx - 1.3) * CELL_W, y - CELL_H * 0.45); // beak
        };
        const ship = (speed: number, seed: number, rowF: number, alpha: number, amp: number, max = cols - 6) => {
          const { x: sx, dir } = patrol(t, speed, seed, 1, max);
          const sy = rowF * rows + wave(sx, rowF * rows, t, phase) * amp;
          ctx.fillStyle = `rgba(13, 60, 91, ${alpha})`;
          // the sail flips to face the way she's headed
          ctx.fillText(dir > 0 ? SAIL : SAILW, (sx + 1) * CELL_W, (sy - 1) * CELL_H + CELL_H / 2);
          ctx.fillText(HULL, sx * CELL_W, sy * CELL_H + CELL_H / 2);
        };
        if (strip) {
          // every strip keeps a yellow duck on patrol — the silhouettes
          // (ship, island) are company, not stand-ins
          duck(Math.abs(Math.round(phase * 7)), 0.36);
          // scenes vary per strip; phone-width strips skip the ship — at
          // that scale the near-opaque sail reads as an ink blob
          const raw = Math.round(phase * 10) % 3;
          const sceneKind = cols < 70 && raw === 0 ? 2 : raw;
          if (sceneKind === 0) {
            // a small ship tacking back and forth along the horizon
            ship(2.2, phase * 8 + 60, 0.58, 0.95, 0.7);
          } else if (sceneKind === 1) {
            // an island, holding still while the water moves
            const ix = 6 + (Math.abs(Math.round(phase * 53)) % Math.max(8, cols - 20));
            const iy = rows * 0.55;
            ctx.fillStyle = "rgba(110, 100, 80, 0.9)";
            ctx.fillText(ISLE, ix * CELL_W, iy * CELL_H + CELL_H / 2);
          }
          // wide strips hold a second scene: an island for the ship to pass,
          // or a ship for the island to watch
          if (cols >= 110) {
            if (sceneKind === 1) {
              ship(1.8, phase * 5 + 20, 0.5, 0.95, 0.7);
            } else {
              const ix = 6 + (Math.abs(Math.round(phase * 29)) % Math.max(8, cols - 20));
              ctx.fillStyle = "rgba(110, 100, 80, 0.9)";
              ctx.fillText(ISLE, ix * CELL_W, rows * 0.5 * CELL_H + CELL_H / 2);
            }
          }
          // a terracotta buoy holds station while the water moves under it
          const bx = 4 + (Math.abs(Math.round(phase * 37)) % Math.max(6, cols - 8));
          const by = rows * 0.5 + wave(bx, rows * 0.5, t, phase) * 1.6;
          ctx.fillStyle = "rgba(178, 94, 66, 0.9)";
          ctx.fillText("▀", bx * CELL_W, by * CELL_H + CELL_H / 2);
          ctx.fillText("▘", (bx + 0.18) * CELL_W, (by - 0.75) * CELL_H + CELL_H / 2);
          // now and then a fish arcs clear of the swell
          const cyc = (t * 0.9 + phase * 5) % 9;
          if (cyc < 1.1) {
            const fp = cyc / 1.1;
            const fx = cols * 0.25 + (Math.abs(Math.round(phase * 23)) % Math.max(4, Math.floor(cols * 0.5))) + fp * 4;
            const fy = rows * 0.62 - Math.sin(fp * Math.PI) * 2.4;
            ctx.fillStyle = "rgba(90, 130, 160, 0.9)";
            ctx.fillText(fp < 0.5 ? "▞" : "▚", fx * CELL_W, fy * CELL_H + CELL_H / 2);
          }
        }
        if (!strip) {
          // a distant ship on the horizon, half in the haze
          ship(1.1, 30, 0.2, 0.45, 0.4, laneMax(rows * 0.2, 6));
          // one free swimmer, keeping its distance from the log's lane
          duck(70, 0.8, laneMax(rows * 0.8, 3.5));
          // the driftwood: adrift, riding the swell, tacking back and forth.
          // Its lane stays clear of the island \u2014 clamped above the beach so
          // log and captain never run aground (or vanish behind it)
          const lane = isl ? Math.max(3, Math.min(rows * 0.45, isl.cy - isl.ry - 3.2)) : rows * 0.45;
          const { x: wx, dir: wdir } = patrol(t, 1.7, 6, 1, laneMax(lane, WOOD.length + 1));
          const wr = lane + wave(wx, lane, t, phase) * 1.6;
          ctx.fillStyle = "rgba(121, 85, 52, 0.95)"; // driftwood-brown
          ctx.font = 'bold 13px ui-monospace, "SF Mono", Menlo, monospace';
          ctx.fillText(WOOD, wx * CELL_W, wr * CELL_H + CELL_H / 2);
          // and its captain: the debugging duck rides the driftwood, facing
          // wherever the log is headed
          const bx = wx + 2.7;
          const cy = (wr - 0.72) * CELL_H + CELL_H / 2;
          ctx.fillStyle = "rgba(240, 195, 60, 0.98)";
          ctx.fillText("\u2586\u2586", bx * CELL_W, cy);
          ctx.fillText(wdir > 0 ? "\u259d" : "\u2598", (wdir > 0 ? bx + 1.55 : bx - 0.55) * CELL_W, cy - CELL_H * 0.52);
          ctx.fillStyle = "rgba(224, 138, 46, 0.98)";
          ctx.fillText(wdir > 0 ? "\u25b8" : "\u25c2", (wdir > 0 ? bx + 2.3 : bx - 1.3) * CELL_W, cy - CELL_H * 0.45);
          ctx.font = '12px ui-monospace, "SF Mono", Menlo, monospace';
        }
      }
    };
    rafId = requestAnimationFrame(tick);
    cleanups.push(() => cancelAnimationFrame(rafId));

    return () => cleanups.forEach((fn) => fn());
  }, []);

  /* reduced motion gets a static page (design-language §5): freeze the demo
     videos on their poster (the "call booked" payoff) instead of looping */
  useEffect(() => {
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const vids = rootRef.current?.querySelectorAll<HTMLVideoElement>("video.gif-media");
    vids?.forEach((v) => {
      v.autoplay = false;
      v.pause();
      const stop = () => v.pause();
      v.addEventListener("play", stop);
    });
  }, []);

  /* the hero card sinks back under the sea as you scroll down (and rises again
     scrolling up), splashing the moment it goes under. The load-in rise is a
     CSS animation on .gif-reveal; this drives the scroll sink on the shell. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const shell = root.querySelector(".hero-card .gif-shell") as HTMLElement | null;
    const splash = root.querySelector(".hero-splash") as HTMLElement | null;
    if (!shell) return;
    const SINK = 300; // px it travels before it's fully under
    let armed = false; // don't splash on the initial settle, only on a real sink
    let raf = 0;
    const fire = () => {
      if (!splash) return;
      splash.classList.remove("go");
      void splash.offsetWidth; // force reflow so the animation restarts
      splash.classList.add("go");
    };
    const update = () => {
      raf = 0;
      const p = Math.min(1, Math.max(0, scrollY / (innerHeight * 0.5)));
      shell.style.transform = `translateY(${p * SINK}px)`;
      shell.style.opacity = `${Math.max(0, 1 - p * 1.15)}`;
      if (p > 0.24 && armed) {
        fire();
        armed = false;
      }
      if (p < 0.1) armed = true; // re-arm once it's back up near the surface
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  /* mobile explore: scroll is the selector. The dashboard sticks under the
     header while the cards pass beneath it, and the card crossing the middle
     of the viewport lights its widget's ring on the image — the same
     information hover carries on desktop, driven by the gesture a phone
     already has. Armed only under 52rem; desktop keeps hover. */
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const mq = matchMedia("(max-width: 52rem)");
    let obs: IntersectionObserver | null = null;
    const arm = () => {
      obs?.disconnect();
      obs = null;
      if (!mq.matches) return;
      const items = [...root.querySelectorAll(".explore-item")];
      obs = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            const i = items.indexOf(e.target);
            if (i >= 0) setSel(WIDGETS[i].id);
          }
        },
        // the active band is the stripe just under the stuck dashboard
        { rootMargin: "-45% 0px -45% 0px" },
      );
      items.forEach((el) => obs?.observe(el));
    };
    arm();
    mq.addEventListener("change", arm);
    return () => {
      obs?.disconnect();
      mq.removeEventListener("change", arm);
    };
  }, []);

  const seaGone = seaLive === false;
  const selectedWidget = WIDGETS.find((w) => w.id === sel) ?? null;

  return (
    <div ref={rootRef} className={`landing${seaLive ? " sea-live" : ""}`}>
      <MarketingNav />

      <main id="top">
        {/* hero */}
        <div className="hero">
          <div className="wrap hero-grid">
            <div>
              <h1>
                Ship <em className="voice">tailored demos</em>
                <br className="h1-br" /> to every prospect
              </h1>
              {/* "cold outbound" is one idea and must never break across the
                  two lines — the nbsp forces the turn after it instead */}
              <p className="hero-sub">Grow revenue with cold&nbsp;outbound that feels handcrafted.</p>
              <div className="hero-actions">
                <a
                  className="btn btn-primary"
                  href="#book"
                  onClick={() => trackCta("hero")}
                >
                  Book a demo
                </a>
              </div>
              {/* the island the sea draws stands on this rect (see the canvas
                  code). Yuvan's quote used to stand on it; the testimonials
                  now live with the case studies, so the ground stays and the
                  words are gone — the box keeps its size for the sea to read. */}
              <div className="hero-proof">
                <a
                  className="hero-proof-scroll"
                  href="#cases"
                  aria-label="Scroll to testimonials"
                />
              </div>
              {/* provenance, not a second CTA: two words and the mark, riding
                  the open water in the hero's bottom-left corner (Aayush
                  08-09, placement round three — absolute on desktop, in flow
                  under the island on phones) */}
              <p className="hero-backed">
                <span>Backed by</span>
                <img
                  src="/backed-alpha.webp"
                  alt="alpha, the a16z speedrun fund"
                  width={393}
                  height={132}
                  decoding="async"
                />
              </p>
            </div>
            {/* TODO: dashboard preserved for later — the original hero dashboard
                window now lives in components/_HeroDashboard.legacy.tsx. Import it
                and drop <HeroDashboard /> back in here to restore it. */}
            <div className="hero-card gif-anchor">
              <div className="hero-story-callout">
                <span>Real customer story</span>
                {/* the arrow leaves the label, banks right, and dives DOWN at
                    the card below — the tip must land on the card's face, not
                    sail past its corner */}
                <svg viewBox="0 0 120 64" aria-hidden="true">
                  <path d="M4 12 C 42 2, 76 10, 86 48" />
                  <path d="M89 35 L 86 48 L 77 43" />
                </svg>
              </div>
              <GifMedia />
              {/* the pixel splash the card kicks up as it plops into the sea */}
              <div className="hero-splash" aria-hidden="true">
                {SPLASH.map((s, i) => (
                  <span key={i} className="drop" style={s} />
                ))}
              </div>
            </div>
          </div>
          {!seaGone && <canvas id="sea" ref={seaRef} aria-hidden="true" />}
          {/* the surface the card rises out of: two copies of the wave grid,
              drifting sideways on a loop (see waveBand / WATERBAND above) */}
          <div className="hero-waterband" aria-hidden="true">
            <div className="waterband-scroll">
              <pre className="waterband-col">{WATERBAND}</pre>
              <pre className="waterband-col">{WATERBAND}</pre>
            </div>
          </div>
        </div>

        <CustomerStories />

        {/* interactive dashboard: hover a widget to see what it does */}
        <section id="explore" className="sheet sheet-white">
          <div className="wrap sect">
            <div className="explore-head">
              <h2>
                Watch your outbound <em className="voice">book meetings</em>
              </h2>
            </div>
            {/* the whole section stands on a baby-blue mat — a bounding box
                holding the dashboard AND the panel that reads it, so the two
                are one object on the white sheet */}
            <div className="explore-plate">
            <div className="explore-grid">
              <div
                className="explore-dash"
                onMouseLeave={() => setSel(null)}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) setSel(null);
                }}
              >
                <img
                  src="/dw-demo-dashboard-hero.webp"
                  width="2048"
                  height="2506"
                  loading="lazy"
                  decoding="async"
                  alt="The Driftwood dashboard: daily email volume, pipeline metrics, campaigns, and audience controls"
                />
                {WIDGETS.map((w) => (
                  <button
                    key={w.id}
                    type="button"
                    className={`hot${sel === w.id ? " on" : ""}`}
                    style={{ left: `${w.l}%`, top: `${w.t}%`, width: `${w.w}%`, height: `${w.h}%` }}
                    onMouseEnter={() => setSel(w.id)}
                    onFocus={() => setSel(w.id)}
                    onClick={() => setSel(w.id)}
                    aria-label={w.title}
                  />
                ))}
              </div>
              <aside className="explore-info" aria-live="polite">
                {selectedWidget ? (
                  <div key={selectedWidget.id} className="explore-card">
                    <h3>{selectedWidget.title}</h3>
                    <p>{selectedWidget.body}</p>
                  </div>
                ) : (
                  <p className="explore-prompt">Select a widget to learn more</p>
                )}
              </aside>
            </div>
            {/* phones: the cards scroll under the stuck dashboard and the
                mid-viewport one lights its widget (see the observer effect).
                Hidden on desktop (CSS). */}
            <div className="explore-list">
              {WIDGETS.map((w) => (
                <div key={w.id} className={`explore-item${sel === w.id ? " on" : ""}`}>
                  <h3>{w.title}</h3>
                  <p>{w.body}</p>
                </div>
              ))}
            </div>
            </div>
          </div>
        </section>

        <PricingSection />

        {/* the seam: open water between the pricing section and the closing
            ask, the same ASCII sea the hero carries. The band is white — it
            runs straight out of the white dashboard sheet with no shoulder
            (a shoulder its own colour would be invisible anyway) — and the
            close sheet docks onto its far edge with a baby-blue wave, so the
            water reads as running up onto a shore.
            The band always stands, but it holds still water (no canvas) when
            the sea is off for reduced motion. */}
        <div className="sea-seam" aria-hidden="true">
          {!seaGone && <canvas className="sea-strip" />}
        </div>

        {/* close → the booking section: the Cal.com calendar lives inline
            here, and the booking CTAs resolve to it */}
        <section id="book" className="close-sect sheet wash-b">
          <div className="wrap sect">
            <h2>
              See what we'd send <em className="voice">your</em> prospects
            </h2>
            <p className="book-sub">Pick a time below. 30 minutes with Aayush, the founder.</p>
            <div className="cal-window">
              <InlineBooking />
            </div>
            {/* the old link survives as the fallback path (embed blocked or slow) */}
            <p className="cal-fallback">
              If the calendar does not load, book at{" "}
              <a href={CAL_URL}>cal.com/aayush-gupta-qyilz6/30min</a> or email{" "}
              <a href="mailto:aayush@driftwood.sh">aayush@driftwood.sh</a>.
            </p>
          </div>
        </section>
      </main>

      {/* the footer reads as three quiet columns — the brand and what it is
          on the left, then two titled link lists — over one hairline bottom
          line. The old shape (two wrapping link ROWS at clashing alignments,
          the definition marooned at the foot) read as a pile. */}
      <MarketingFooter />
    </div>
  );
}
