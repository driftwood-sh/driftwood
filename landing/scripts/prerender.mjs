/* Injects the prerendered landing markup into dist/index.html after the
   client build. Fails the build loudly if the root div isn't found or the
   render comes back suspiciously small — a silently empty prerender would
   quietly undo the whole point. */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";

const { render } = await import("../dist-ssr/prerender-entry.js");
for (const [path, file] of [["/", "index.html"], ["/pricing", "pricing/index.html"]]) {
  const html = render(path);
  if (html.length < 5_000) {
    throw new Error(`prerender output for ${path} suspiciously small (${html.length} chars)`);
  }
  const target = new URL(`../dist/${file}`, import.meta.url);
  const doc = readFileSync(target, "utf8");
  const anchor = '<div id="root"></div>';
  if (!doc.includes(anchor)) {
    throw new Error(`dist/${file} has no empty #root div to fill`);
  }
  writeFileSync(target, doc.replace(anchor, `<div id="root">${html}</div>`));
  console.log(`prerendered ${path} into dist/${file} (+${(html.length / 1024).toFixed(1)} kB of markup)`);
}

/* Stamp the sitemap's lastmod with the build date — the hand-written date in
   public/sitemap.xml rots silently otherwise. */
const sitemap = new URL("../dist/sitemap.xml", import.meta.url);
const stamped = readFileSync(sitemap, "utf8").replace(
  /<lastmod>[^<]*<\/lastmod>/g,
  `<lastmod>${new Date().toISOString().slice(0, 10)}</lastmod>`,
);
writeFileSync(sitemap, stamped);
console.log(`stamped sitemap lastmod ${new Date().toISOString().slice(0, 10)}`);

/* Install Switchfrog in every generated document, including static articles
   copied from public/ and the separate dashboard/admin entry points. */
const switchfrog = '<script async src="https://api.switchfrog.com/sdk/v1.js" data-publishable-key="sf_pk_3273a62b46ca72a3617a2c72633680b9be7b85c268991712bb471d653e505234"></script>';
const output = new URL("../dist/", import.meta.url);
let trackedPages = 0;
for (const file of readdirSync(output, { recursive: true })) {
  if (!file.endsWith(".html")) continue;
  const page = new URL(file, output);
  const content = readFileSync(page, "utf8");
  if (!content.includes("</head>")) {
    throw new Error(`Cannot install Switchfrog: ${file} has no closing head`);
  }
  if (!content.includes('src="https://api.switchfrog.com/sdk/v1.js"')) {
    writeFileSync(page, content.replace("</head>", `${switchfrog}\n</head>`));
  }
  trackedPages += 1;
}
console.log(`installed Switchfrog on ${trackedPages} HTML pages`);
