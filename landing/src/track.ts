/* One call, both sinks: Vercel Web Analytics (custom events are dropped on
   the free plan today, but they light up if the team ever upgrades) and
   PostHog (the queryable one — first-party proxied via /ingest, see
   vercel.json). posthog.init happens in main.tsx before any CTA can be
   clicked, so capture() here never fires pre-init. */
import { track } from "@vercel/analytics";
import posthog from "posthog-js";

export function trackCta(placement: "nav" | "hero" | "close" | "pricing-startup" | "pricing-growth" | "pricing-enterprise") {
  track("book_demo", { placement });
  posthog.capture("book_demo", { placement });
}

/* the inline booking funnel: calendar_open = the Cal embed mounted (section
   reached or CTA clicked), confirmed = Cal's bookingSuccessful event — the
   real conversion, which the old outbound link never gave us */
export function trackBooking(event: "booking_calendar_open" | "booking_confirmed") {
  track(event);
  posthog.capture(event);
}
