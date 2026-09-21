/* Offline load regression: a long library must not open every video stream.
   Mock API responses and media bytes are local; no production writes occur. */
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
const base = process.env.DEMO_QA_BASE_URL ?? 'http://127.0.0.1:5196';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));

async function instrument(page, mode) {
  await page.addInitScript(({ mode }) => {
    window.__mediaVersion = 1;
    let current = window.fetch;
    Object.defineProperty(window, 'fetch', { configurable: true, get: () => current, set: next => {
      current = async (...args) => {
        const url = new URL(String(args[0]), location.origin);
        const response = await next(...args);
        if (mode === 'videos' && url.pathname === '/api/v1/dashboard/demos' && !args[1]?.method) {
          const body = await response.json();
          const offset = Number(url.searchParams.get('offset') ?? 0);
          body.demos = body.demos.slice(0, Math.max(0, 80 - offset)).map((row, i) => ({
            ...row, content_type: 'video/mp4', content_url: `/qa-lazy-video/${offset + i}.mp4?v=${offset + i === 0 ? window.__mediaVersion : 1}`,
          }));
          return new Response(JSON.stringify({ ...body, total: 80 }), { status: response.status, headers: response.headers });
        }
        if (mode === 'emails' && url.pathname === '/api/v1/dashboard/reviews' && !args[1]?.method) {
          const body = await response.json();
          const offset = Number(url.searchParams.get('offset') ?? 0);
          const limit = Number(url.searchParams.get('limit') ?? 100);
          const seed = body.pending[0] ?? window.__reviewSeed;
          window.__reviewSeed = seed;
          const pending = Array.from({ length: 400 }, (_, i) => ({
            ...seed, id: `lazy-review-${i}`, attachment_slug: '',
            lead: { ...seed.lead, lead_id: `lazy-lead-${i}`, name: `Recipient ${i + 1}`, company: `Company ${Math.floor(i / 5) + 1}`, email: `recipient${i + 1}@example.test` },
            evidence: { demo_key: `lazy-demo-${Math.floor(i / 5)}` },
            body: `Hey there,\n\nA short concept demo of the booking experience in iMessage, with the details confirmed before checkout.\n\n[![Demo preview ${i + 1}](https://driftwood.sh/d/qa-gif-${i})](https://driftwood.sh/d/qa-video-${Math.floor(i / 5)})\n\nCould this fit what you're building?\n\nDarshan\nPhoton`,
          })).slice(offset, offset + limit);
          return new Response(JSON.stringify({ ...body, pending, total_pending: 400 }), { status: response.status, headers: response.headers });
        }
        return response;
      };
    }});
  }, { mode });
}

async function videoPass(browser, options) {
  const page = await browser.newPage(options);
  const requests = new Set();
  let releaseReplacement;
  const replacement = new Promise(resolve => { releaseReplacement = resolve; });
  await instrument(page, 'videos');
  await page.route('**/qa-lazy-video/*.mp4?*', async route => {
    requests.add(new URL(route.request().url()).pathname);
    if (route.request().url().includes('?v=2')) await replacement;
    await route.fulfill({ path: 'public/demo-portrait.mp4', contentType: 'video/mp4' });
  });
  await page.goto(`${base}/dashboard/demos?mock=library-only&seg=staging`);
  await page.locator('.dp-card').nth(79).waitFor();
  const first = page.locator('.dp-card').first();
  await first.locator('.is-portrait').waitFor();
  await page.waitForTimeout(500);
  const initial = requests.size;
  assert.ok(initial > 0 && initial <= 6, `80 cards must request only nearby clips, saw ${initial}`);
  assert.ok(await page.locator('video[src]').count() <= 6);
  assert.equal(await page.locator('video:not([src])').count(), 80 - await page.locator('video[src]').count());
  assert.equal(await first.locator('video').getAttribute('preload'), 'metadata');
  assert.equal(await page.locator('.dp-card').last().locator('video').getAttribute('preload'), 'none');
  const playhead = await first.locator('video').evaluate(video => { video.currentTime = Math.min(0.1, video.duration / 2); return video.currentTime; });

  const last = page.locator('.dp-card').nth(79);
  await last.scrollIntoViewIfNeeded();
  await last.locator('.is-portrait').waitFor();
  assert.ok(requests.size > initial && requests.size < 15, `scroll should load a nearby batch, saw ${requests.size}`);
  assert.ok(requests.has('/qa-lazy-video/79.mp4'));
  assert.equal(await first.locator('video').getAttribute('src'), '/qa-lazy-video/0.mp4?v=1', 'loaded source survives scrolling away');
  assert.equal(await first.locator('video').evaluate(video => video.currentTime), playhead);

  await first.scrollIntoViewIfNeeded();
  await page.evaluate(() => { window.__mediaVersion = 2; window.dispatchEvent(new Event('focus')); });
  await page.waitForFunction(() => document.querySelector('.dp-card video')?.getAttribute('src')?.endsWith('?v=2'));
  assert.equal(await first.locator('.dp-duration').count(), 0, 'new source clears the previous duration');
  assert.equal(await first.locator('.is-portrait').count(), 0, 'new source reserves the initial frame until metadata arrives');
  releaseReplacement();
  await first.locator('.is-portrait').waitFor();
  assert.equal(await first.locator('video').evaluate(video => video.controls), true);
  assert.equal(await first.locator('video').evaluate(video => video.currentTime), 0);
  await page.close();
  return { initial, afterScroll: requests.size };
}

async function emailPass(browser, options) {
  const page = await browser.newPage(options);
  const gifs = new Set();
  const videos = new Set();
  await instrument(page, 'emails');
  await page.route('https://driftwood.sh/d/qa-gif-*', async route => {
    gifs.add(new URL(route.request().url()).pathname);
    await route.fulfill({ path: 'public/compare.gif', contentType: 'image/gif' });
  });
  await page.route('**/d/qa-video-*', async route => {
    videos.add(new URL(route.request().url()).pathname);
    await route.fulfill({ path: 'public/demo-portrait.mp4', contentType: 'video/mp4' });
  });
  await page.goto(`${base}/dashboard/demos?mock=photon-review&seg=review`);
  await page.locator('.dp-card').nth(399).waitFor();
  await page.waitForTimeout(500);
  const initial = gifs.size;
  assert.equal(await page.locator('.email-preview img[loading="lazy"]').count(), 400);
  assert.ok(initial > 0 && initial < 25, `400 emails must defer distant GIFs, saw ${initial}`);
  assert.ok(videos.size <= 6, `only nearby review videos load, saw ${videos.size}`);
  const last = page.locator('.dp-card').nth(399);
  await last.scrollIntoViewIfNeeded();
  await last.locator('.email-preview img').scrollIntoViewIfNeeded();
  await page.waitForFunction(() => { const image = document.querySelectorAll('.email-preview img')[399]; return image?.complete && image.naturalWidth > 0; });
  assert.ok(await last.locator('.email-preview img').evaluate(image => image.naturalWidth) > 0);
  assert.ok(gifs.has('/d/qa-gif-399'));
  assert.ok(gifs.size > initial && gifs.size < 50, `scroll loads another bounded GIF batch, saw ${gifs.size}`);
  await page.close();
  return { initial, afterScroll: gifs.size };
}

for (const [name, type, options] of [
  ['Desktop Chromium', chromium, { viewport: { width: 1440, height: 1000 } }],
  ['iPhone WebKit', webkit, { ...devices['iPhone 13'] }],
]) {
  const browser = await type.launch({ headless: true });
  try {
    const videos = await videoPass(browser, options);
    const gifs = await emailPass(browser, options);
    console.log(`${name}: requests after first load → after scrolling: videos ${videos.initial}/80 → ${videos.afterScroll}/80; GIFs ${gifs.initial}/400 → ${gifs.afterScroll}/400. Source replacement resets media state and scrolling preserves loaded playheads.`);
  } finally { await browser.close(); }
}
