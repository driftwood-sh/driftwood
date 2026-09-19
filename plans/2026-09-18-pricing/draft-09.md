# Restrained pricing polish

Apply the user's approved visual re-audit to the restored comparison. Keep the
column structure, left alignment, content order and all plan copy. Public Sans;
#202020 ink, #626262 supporting text, #e8e8e8 rules, #f7f7f7 Growth surface,
#15557e booking buttons with #0d3c5b hover. Prices remain dominant; names use
500 weight and feature copy becomes 15px at base scale. Inline numbers inherit
feature size with 600 weight. List gaps 12px, group gaps 24–28px. No new artwork,
motion, badges, containers, or quantity blocks.

Pre-emit component design_plan: minimal direction valid; zero motion; blue/white
button contrast AA with visible focus; all metrics and copy remain user supplied.
The prior oversized counters competed with prices; this pass preserves reading
order and changes only typographic emphasis, spacing, rules, and action color.

Verification: production build and whitespace checks pass; axe found no
violations after the color/type edits. Chromium and WebKit at 1440, 1024, 768,
390 and 320px have no horizontal overflow. Nested subgrid keeps allowance rows
aligned across desktop plans even when labels wrap; mobile uses natural rows.
Desktop and phone screenshots visually reviewed. Existing preview refreshed.

Release integration: applied onto current main, retaining newer dashboard
routes, homepage content, Switchfrog installation, and footer health status.
The footer status component moved unchanged into the shared marketing chrome.
Release build, ESLint, and all 290 unit tests pass. Chromium/WebKit verify the
pricing URL variants, homepage section, nine allowances, three booking links,
responsive widths, and Enterprise navigation to /#book. No-JS rendering and axe
checks pass. WebKit QA uses port 4189 (4190 is blocked by WebKit).
