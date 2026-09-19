/* Build-time prerender entry: renders the landing to static HTML so the
   served index.html carries real content. Most AI crawlers (GPTBot,
   ClaudeBot, PerplexityBot) don't execute JS — without this they see an
   empty <div id="root">. Built via `vite build --ssr` (see package.json),
   consumed by scripts/prerender.mjs, hydrated by main.tsx. */
import { StrictMode, Suspense } from "react";
import { renderToString } from "react-dom/server";
import App from "./App";
import Pricing from "./Pricing";

export function render(path = "/"): string {
  return renderToString(
    <StrictMode>
      <Suspense fallback={null}>
        {path === "/pricing" ? <Pricing /> : <App />}
      </Suspense>
    </StrictMode>,
  );
}
