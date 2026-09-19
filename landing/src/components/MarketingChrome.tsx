import { useEffect, useState } from "react";
import HelmMark from "./HelmMark";
import { trackCta } from "../track";

/* Backend reachability, shown as a dot in the footer. The landing itself is
   static on Vercel, so it stays up while the Cloud Run backend is down — which
   is exactly the gap this reports (2026-09-07: the backend was gone for 5.5h
   and every surface here still looked fine).

   Two things this deliberately does NOT trust:
   - a bare 200. `/health` is proxied in vercel.json, but the catch-all rewrite
     serves index.html for anything unmatched, so a 200 can be the landing page
     itself. The body has to actually be the health payload.
   - a hung request. Cloud Run answers in ~200ms; without the abort a wedged
     backend leaves the dot on "Checking status" forever instead of going red. */
type HealthState = "pending" | "ok" | "down";

const HEALTH_LABEL: Record<HealthState, string> = {
  pending: "Checking status",
  ok: "All systems operational",
  down: "Service disruption",
};

function FooterStatus() {
  const [state, setState] = useState<HealthState>("pending");

  useEffect(() => {
    let cancelled = false;

    async function check(force = false) {
      // Skip background POLLS — a hidden tab pinging every minute is just
      // noise on Cloud Run. Never skip the first check though: a page restored
      // or cmd-clicked into a background tab would otherwise sit on "Checking
      // status" forever, which is the one state that tells a reader nothing.
      if (!force && document.visibilityState !== "visible") return;
      const abort = new AbortController();
      const timer = window.setTimeout(() => abort.abort(), 5000);
      try {
        const res = await fetch("/health", {
          signal: abort.signal,
          cache: "no-store",
        });
        const body = await res.json();
        if (!cancelled) {
          setState(res.ok && body?.status === "ok" ? "ok" : "down");
        }
      } catch {
        // Non-JSON body, abort, or network failure all mean the same thing to
        // a reader: the thing behind this page is not answering.
        if (!cancelled) setState("down");
      } finally {
        window.clearTimeout(timer);
      }
    }

    // Wrapped, not passed directly: a listener/interval hands its own first
    // argument (an Event, a timer id) straight into `force`.
    const tick = () => void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") void check(true);
    };

    void check(true);
    const poll = window.setInterval(tick, 60000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return (
    <span className="foot-status" data-state={state} role="status">
      <span className="dot" aria-hidden="true" />
      {HEALTH_LABEL[state]}
    </span>
  );
}

export function MarketingNav({ pricing = false }: { pricing?: boolean }) {
  const homePrefix = pricing ? "/" : "";
  return (
    <header>
      <a className="skip-link" href={pricing ? "#pricing" : "#top"}>Skip to content</a>
      <div className="wrap nav">
        <a className="wordmark" href={homePrefix || "#top"} aria-label="driftwood home">
          <HelmMark /><span>driftwood</span>
        </a>
        <nav className="nav-right" aria-label="primary">
          <a className="nav-pricing" href="/pricing" aria-current={pricing ? "page" : undefined}>Pricing</a>
          <a className="nav-login" href="/dashboard">
            Log in
          </a>
          <a
            className="btn btn-primary"
            href={`${homePrefix}#book`}
            onClick={() => trackCta("nav")}
          >
            Book a demo
          </a>
        </nav>
      </div>
    </header>
  );
}

export function MarketingFooter({ homePrefix = "", description }: { homePrefix?: string; description?: string }) {
  return (
    <footer>
      <div className="wrap foot">
        <div className="foot-top">
          <div className="foot-brand">
            <a className="wordmark" href={homePrefix || "#top"} aria-label="driftwood home">
              <HelmMark />driftwood
            </a>
            <p className="foot-def">
              {description ?? "driftwood is an AI sales agent for demo-led outbound: it researches each prospect, builds a working demo of your product for their business, and sends from your account after human review."}
            </p>
          </div>
          <nav className="foot-col" aria-label="site">
            <span className="foot-col-head">Learn</span>
            <a href="/pricing">Pricing</a>
            <a href="/customers/autosana">Customers</a>
            <a href="/demo-led-outbound">Demo-led outbound</a>
            <a href="/faq">FAQ</a>
            <a href="/founder-led-sales">Founder-led sales</a>
            <a href="/cold-outbound-benchmarks">Outbound benchmarks</a>
            <a href="/ai-sdr">What is an AI SDR</a>
          </nav>
          <nav className="foot-col" aria-label="compare">
            <span className="foot-col-head">Compare</span>
            <a href="/best-ai-sdr-tools">Compare AI SDR tools</a>
            <a href="/alternatives/instantly">Instantly alternatives</a>
            <a href="/alternatives/clay">Clay alternatives</a>
            <a href="/alternatives/apollo">Apollo alternatives</a>
            <a href="/alternatives/artisan">Artisan alternatives</a>
            <a href="/alternatives/11x">11x alternatives</a>
            <a href="/vs/artisan">driftwood vs Artisan</a>
            <a href="/vs/11x">driftwood vs 11x</a>
          </nav>
        </div>
        <div className="foot-bottom">
          <FooterStatus />
          <a href="mailto:aayush@driftwood.sh">aayush@driftwood.sh</a>
          <span>&copy; 2026 driftwood</span>
        </div>
      </div>
    </footer>
  );
}
