import { useEffect, useRef } from "react";
import { CASE_STUDIES } from "./customer-stories";

export default function CustomerStories({ title }: { title?: string }) {
  const casesRef = useRef<HTMLDivElement>(null);
  /* case studies are a centre-focus rail: the card nearest the middle scales
     up (zooms into place) while the neighbours sit back, dimmed and smaller.
     A clip only runs while its card holds the centre — scroll on and it
     pauses, so two demos never talk over each other. */
  useEffect(() => {
    const rail = casesRef.current;
    if (!rail) return;
    const cards = [...rail.querySelectorAll<HTMLElement>(".case")];
    if (!cards.length) return;
    const cleanups: (() => void)[] = [];
    // .playing swaps the card out of poster state (copy + play button go, the
    // native controls come in); the video's own events are the source of truth
    cards.forEach((c) => {
      const v = c.querySelector("video");
      if (!v) return;
      const sync = () => {
        const on = !v.paused && !v.ended;
        c.classList.toggle("playing", on);
        v.controls = on;
      };
      (["play", "pause", "ended"] as const).forEach((e) => v.addEventListener(e, sync));
      cleanups.push(() => (["play", "pause", "ended"] as const).forEach((e) => v.removeEventListener(e, sync)));
    });
    // The deck settles under our own tween rather than the browser's snap.
    // Mandatory snap fought short trackpad flicks — it would yank the card
    // back at whatever speed it felt like, and a flick that ran out of force
    // mid-gap stuttered between two snap targets. Here a light nudge (see
    // COMMIT_PX below) commits to the next card in the direction of travel,
    // and anything shorter eases back; either way it's the same 560ms curve.
    // the snapport is inset from the left (see .cases-rail scroll-padding-left),
    // which puts a snapped card half that inset right of the scrollport centre.
    // Read it rather than repeat it, so the two can't drift apart — but read it
    // ONCE per layout, not per scroll frame: getComputedStyle in the scroll
    // handler forces a style recalc every frame.
    let inset = 0;
    const readInset = () => {
      inset = parseFloat(getComputedStyle(rail).scrollPaddingLeft) || 0;
    };
    readInset();
    const restFor = (c: HTMLElement) =>
      c.offsetLeft + c.clientWidth / 2 - rail.clientWidth / 2 - inset / 2;
    // native snap still handles touch, where momentum and rubber-banding are
    // the platform's job; the tween takes over for wheel and trackpad
    const settleGesture = matchMedia("(pointer: fine)").matches;
    // where the deck was resting before this gesture began; the settle is
    // measured from here, not from whichever card happens to be nearest
    let anchor = 0;
    let tween = 0;
    // a mouse drag in progress: the settle must not fire while the reader is
    // still holding the deck, even if the pointer rests mid-drag
    let dragActive = false;
    // the last scrollLeft the tween itself wrote. Every scroll event compares
    // against it: a position we didn't write is the reader's own wheel, and
    // that always outranks the tween (see onScroll).
    let written = -1;
    let lastScrollAt = 0;
    const glide = (to: number) => {
      if (tween) cancelAnimationFrame(tween);
      tween = 0;
      const from = rail.scrollLeft;
      const span = to - from;
      if (Math.abs(span) < 1) return;
      const t0 = performance.now();
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / 560);
        // ease-out quint: leaves fast, lands without a bump
        rail.scrollLeft = from + span * (1 - Math.pow(1 - p, 5));
        written = rail.scrollLeft; // read back: the browser may clamp or round
        tween = p < 1 ? requestAnimationFrame(step) : 0;
      };
      tween = requestAnimationFrame(step);
    };
    const centre = (c: HTMLElement) => {
      anchor = Math.max(0, cards.indexOf(c));
      glide(restFor(c));
    };
    // clicking a card brings it round — bound here, not in JSX, so it shares
    // the same tween and anchor as the hover and the settle
    cards.forEach((c) => {
      const onClick = () => centre(c);
      c.addEventListener("click", onClick);
      cleanups.push(() => c.removeEventListener("click", onClick));
    });
    let raf = 0;
    const update = () => {
      raf = 0;
      const mid = rail.scrollLeft + rail.clientWidth / 2 + inset / 2;
      // measure every card first, then write. Interleaving offsetLeft reads
      // with class/style writes in one loop forces a synchronous layout per
      // card, on every frame of every scroll.
      const centres = cards.map((c) => c.offsetLeft + c.clientWidth / 2);
      let best = 0, bd = Infinity;
      centres.forEach((cx, i) => {
        const d = Math.abs(cx - mid);
        if (d < bd) { bd = d; best = i; }
      });
      cards.forEach((c, i) => {
        const on = i === best;
        c.classList.toggle("active", on);
        // which way a waiting card turns away: the one to the right shows you
        // its left edge, the one to the left shows its right (see the coverflow
        // rules in the stylesheet — CSS reads this as --side)
        c.style.setProperty("--side", centres[i] < mid ? "-1" : "1");
        if (!on) c.querySelector("video")?.pause();
      });
    };
    let settleT: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      if (dragActive) return; // the reader is still holding the deck
      if (rail.querySelector(".case.playing")) return; // don't move a running clip
      const step = cards.length > 1 ? restFor(cards[1]) - restFor(cards[0]) : 0;
      if (!step) return;
      const px = rail.scrollLeft - restFor(cards[anchor]);
      const drift = px / step;
      // a light nudge is enough: the deck is a deck, not a page, so ~44px of
      // travel (or a tenth of a card, whichever is shorter — the cards are
      // ~1000px wide, so it's always the 44) already commits to the next one.
      // A hard fling still carries as far as it actually went.
      const commit = Math.min(step / 10, 44);
      const moved =
        Math.abs(px) > commit
          ? Math.sign(drift) * Math.max(1, Math.round(Math.abs(drift)))
          : 0;
      anchor = Math.min(cards.length - 1, Math.max(0, anchor + moved));
      glide(restFor(cards[anchor]));
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
      lastScrollAt = performance.now();
      if (!settleGesture) return;
      // The reader always wins. A scroll event carrying a position the tween
      // did not write is a fresh wheel gesture on top of the running settle —
      // without this the tween kept overwriting scrollLeft for the rest of its
      // 560ms and the deck fought the trackpad, which is the stutter you feel
      // when you flick twice in a row. Scroll events fire before the next
      // animation-frame callback, so `written` is still the tween's last
      // position when we compare.
      if (tween && Math.abs(rail.scrollLeft - written) > 1.5) {
        cancelAnimationFrame(tween);
        tween = 0;
      }
      if (tween) return; // our own tween scrolling; it will settle itself
      clearTimeout(settleT);
      settleT = setTimeout(settle, 90); // fires once the wheel/fling stops
    };
    const onResize = () => {
      readInset();
      onScroll();
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    addEventListener("resize", onResize);
    cleanups.push(() => {
      clearTimeout(settleT);
      if (tween) cancelAnimationFrame(tween);
    });

    // hover brings a waiting card round to the front — it turns to face you,
    // grows, and lands centred, ready to play. Mouse only, and never while a
    // clip is running (the pull would pause it out from under the viewer).
    if (
      matchMedia("(hover: hover) and (pointer: fine)").matches &&
      matchMedia("(prefers-reduced-motion: no-preference)").matches
    ) {
      let hoverT: ReturnType<typeof setTimeout> | undefined;
      // `pointerenter` fires when the DECK moves under a still cursor, not
      // only when the cursor moves onto a card. Left unguarded, every scroll
      // slid a new card under the pointer and 130ms later that card yanked
      // itself to the centre — a second tween fighting the settle, landing on
      // a different card than the gesture asked for. So: no hover pull while
      // the deck is in motion, or in the beat right after it stops.
      const deckMoving = () => tween !== 0 || performance.now() - lastScrollAt < 400;
      cards.forEach((c) => {
        const enter = () => {
          if (c.classList.contains("active")) return;
          if (rail.querySelector(".case.playing")) return;
          if (deckMoving()) return;
          clearTimeout(hoverT);
          // a beat of dwell, so sweeping the pointer across the rail on the way
          // somewhere else doesn't drag the whole deck around
          hoverT = setTimeout(() => {
            if (deckMoving()) return; // a scroll started during the dwell
            centre(c);
          }, 130);
        };
        const leave = () => clearTimeout(hoverT);
        c.addEventListener("pointerenter", enter);
        c.addEventListener("pointerleave", leave);
        cleanups.push(() => {
          clearTimeout(hoverT);
          c.removeEventListener("pointerenter", enter);
          c.removeEventListener("pointerleave", leave);
        });
      });
    }

    // drag the deck with the mouse: grab anywhere on the rail and pull.
    // Writing scrollLeft mid-drag fires scroll events the tween didn't
    // write, so the reader-outranks-tween rule and the coverflow update
    // both treat it as any other gesture; the settle waits for release
    // (dragActive) and a real drag swallows the click that would otherwise
    // centre or play the card under the pointer.
    if (settleGesture) {
      let down = false;
      let dragged = false;
      let startX = 0;
      let startLeft = 0;
      const onDown = (e: PointerEvent) => {
        if (e.button !== 0 || e.pointerType !== "mouse") return;
        down = true;
        dragged = false;
        startX = e.clientX;
        startLeft = rail.scrollLeft;
      };
      const onMove = (e: PointerEvent) => {
        if (!down) return;
        const dx = e.clientX - startX;
        // a 6px dead zone so a plain click never turns into a micro-drag
        if (!dragged && Math.abs(dx) < 6) return;
        if (!dragged) {
          dragged = true;
          dragActive = true;
          rail.classList.add("dragging");
          try {
            rail.setPointerCapture(e.pointerId);
          } catch {
            /* capture is best-effort */
          }
          if (tween) {
            cancelAnimationFrame(tween);
            tween = 0;
          }
        }
        rail.scrollLeft = startLeft - dx;
      };
      const onUp = (e: PointerEvent) => {
        if (!down) return;
        down = false;
        if (!dragged) return;
        dragged = false;
        dragActive = false;
        rail.classList.remove("dragging");
        try {
          rail.releasePointerCapture(e.pointerId);
        } catch {
          /* already released */
        }
        // the browser fires a click at whatever the pointer was over when it
        // let go — after a real drag that click is noise, not intent
        const swallow = (ce: Event) => {
          ce.stopPropagation();
          ce.preventDefault();
        };
        rail.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => rail.removeEventListener("click", swallow, { capture: true }), 150);
        clearTimeout(settleT);
        settleT = setTimeout(settle, 90);
      };
      const onDragStart = (e: Event) => e.preventDefault(); // logos are <img>s
      rail.addEventListener("pointerdown", onDown);
      rail.addEventListener("pointermove", onMove);
      rail.addEventListener("pointerup", onUp);
      rail.addEventListener("pointercancel", onUp);
      rail.addEventListener("dragstart", onDragStart);
      cleanups.push(() => {
        rail.removeEventListener("pointerdown", onDown);
        rail.removeEventListener("pointermove", onMove);
        rail.removeEventListener("pointerup", onUp);
        rail.removeEventListener("pointercancel", onUp);
        rail.removeEventListener("dragstart", onDragStart);
      });
    }

    update();
    return () => {
      rail.removeEventListener("scroll", onScroll);
      removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
      cleanups.forEach((fn) => fn());
    };
  }, []);

  return (
        <section id="cases" className="sheet sheet-white">
          <div className="sect">
            <div className="wrap cases-head">
              {/* tested copy (Aayush 08-09): names the enemy in the page's own
                  vocabulary — the compare section IS the slop parody. "slop"
                  carries the line, so it takes the voice accent. */}
              <h2>
                {title ?? <>Don&rsquo;t send your leads <em className="voice">slop</em></>}
              </h2>
            </div>
            <div className="cases-rail" ref={casesRef}>
              {/* click-to-centre is bound in the rail effect, not on the article
                  here, so it shares that tween and its anchor */}
              {CASE_STUDIES.map((c) => (
                <article key={c.id} className="case">
                  {/* first voice: the demo itself, the loudest object on the sheet,
                      and the card's leading edge — so the card waiting off to the
                      right teases its clip, never its logo. The copy is a sibling
                      of the frame, not a child of it: on desktop it lies over the
                      clip's head, on phones (where a 342px frame can't carry type)
                      it drops below in ink. */}
                  <div className="case-main">
                    <div className="case-video">
                      <video
                        className="case-media"
                        src={c.video}
                        poster={c.poster}
                        preload="none"
                        playsInline
                        aria-label={`The demo driftwood built and sent for ${c.company}`}
                      />
                      <button
                        type="button"
                        className="case-play"
                        aria-label={`Play the ${c.company} demo`}
                        onClick={(e) => {
                          // an off-centre card only comes to the middle — the
                          // click bubbles to the card's own centring handler,
                          // and the second click is the one that plays it
                          const card = e.currentTarget.closest(".case");
                          if (card?.classList.contains("active")) {
                            void card.querySelector("video")?.play();
                          }
                        }}
                      />
                    </div>
                    <div className="case-copy">
                      <h3 className="case-title">{c.title}</h3>
                      <p className="case-sub">{c.sub}</p>
                    </div>
                  </div>
                  {/* second and third voice — they arrive with the card as it
                      turns to face you, not before */}
                  <div className="case-aside">
                    {c.quote && (
                      <figure className="case-quote">
                        <blockquote>&ldquo;{c.quote}&rdquo;</blockquote>
                        <figcaption>
                          {c.avatar && (
                            <img src={c.avatar} width="128" height="128" alt="" loading="lazy" decoding="async" />
                          )}
                          <span>
                            <b>{c.author}</b>
                            {c.role}
                          </span>
                        </figcaption>
                      </figure>
                    )}
                    <div className="case-mark">
                      <img
                        className="case-logo"
                        src={c.logo}
                        alt={c.company}
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
  );
}
