/* Offline regression for the two separate customer approvals. Every write is
   intercepted by ?mock; this script must never point at a production host. */
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const base = process.env.DEMO_QA_BASE_URL ?? 'http://127.0.0.1:5196';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname));
const shots = process.env.DEMO_QA_SHOTS ?? '/private/tmp/photon-approval-ui-shots';
mkdirSync(shots, { recursive: true });

async function instrument(page) {
  await page.addInitScript(() => {
    window.__writes = [];
    let current = window.fetch;
    Object.defineProperty(window, 'fetch', { configurable: true, get: () => current, set: next => {
      current = async (...args) => {
        const url = String(args[0]);
        if (args[1]?.method === 'POST') window.__writes.push({ url, body: args[1].body });
        const response = await next(...args);
        // Photon deliberately links the MP4 instead of attaching it. Exercise
        // that exact API shape with a distinct GIF URL and video URL.
        if (url.includes('/dashboard/reviews?') && location.search.includes('mock=photon-review')) {
          const body = await response.json();
          body.pending = body.pending.map(item => ({ ...item, attachment_slug: '', body: item.body.replaceAll('https://driftwood.sh/compare.gif', 'https://driftwood.sh/d/qa-photon-gif').replaceAll('https://driftwood.sh/demo-portrait.mp4', 'https://driftwood.sh/d/qa-photon-mp4') }));
          return new Response(JSON.stringify(body), { status: response.status, headers: response.headers });
        }
        return response;
      };
    }});
  });
  // Fixture preview is local media; the email still uses its real URL syntax.
  await page.route('https://driftwood.sh/d/qa-photon-gif', route => route.fulfill({ path: 'public/compare.gif', contentType: 'image/gif' }));
  await page.route('**/d/qa-photon-mp4', route => route.fulfill({ path: 'public/demo-portrait.mp4', contentType: 'video/mp4' }));
}
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await instrument(page);

  await page.goto(`${base}/dashboard/demos?mock=demos-approval&view=approve-demos`);
  await page.locator('.dp-card').nth(59).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Approve demo', exact: true }).count(), 60);
  assert.equal(await page.locator('.dp-approved tbody tr').count(), 4);
  await page.getByRole('button', { name: 'Approve all demos', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'Approve 60 demos? Confirm', exact: true });
  await confirm.click();
  assert.equal(await page.locator('.dp-card').count(), 60, 'double click does not confirm');
  await page.waitForTimeout(450);
  await confirm.click();
  await page.getByText('60 demos approved. Review recipients and emails when they are ready.', { exact: true }).waitFor();
  assert.equal(await page.locator('.dp-card').count(), 0);
  assert.equal(await page.locator('.dp-approved tbody tr').count(), 64);
  assert.equal((await page.evaluate(() => window.__writes)).filter(row => row.url.includes('/reviews/decide')).length, 0);
  // The queue lives on Flow now; Demos offers only the library and the two approval views.
  assert.deepEqual(await page.locator('.dp-segments button').evaluateAll(buttons => buttons.map(button => button.firstChild.textContent)), ['All demos', 'Demos to approve', 'Emails to approve']);
  const bloom = page.locator('.dp-approved tbody tr').filter({ hasText: 'No one found at Bloom.' });
  await bloom.getByRole('button', { name: 'Add a name' }).click();
  await bloom.getByRole('textbox').fill('Ada Lovelace');
  await bloom.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByText('Ada Lovelace added.', { exact: true }).waitFor();
  await page.screenshot({ path: `${shots}/discovery-desktop.png` });

  await page.goto(`${base}/dashboard/demos?mock=photon-review-multi&view=approve-emails`);
  await page.locator('.dp-email-group .dp-card').nth(4).waitFor();
  assert.equal(await page.locator('.dp-email-group').count(), 2);
  await page.getByRole('heading', { name: 'Meridian 5 emails to review' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Approve all demos', exact: true }).count(), 0);
  const dana = page.getByRole('article', { name: 'Dana Whitfield, Meridian', exact: true });
  await dana.getByText('To Dana Whitfield <dana.whitfield@example.test>', { exact: true }).waitFor();
  await dana.getByText('Meridian, in iMessage', { exact: true }).waitFor();
  assert.equal(await dana.getByRole('img', { name: 'Meridian demo preview' }).locator('..').getAttribute('href'), 'https://driftwood.sh/d/qa-photon-mp4');
  assert.equal(await dana.locator('video').getAttribute('src'), '/d/qa-photon-mp4', 'the clip is the full MP4, never the preview GIF');
  await page.screenshot({ path: `${shots}/email-review-desktop.png` });

  // A demo can be approved while reviewed emails exist, without approving them.
  await page.getByRole('button', { name: /^Demos to approve/ }).click();
  await page.getByRole('button', { name: 'Approve demo', exact: true }).click();
  await page.getByText('Demo approved. Recipients and emails will be prepared for your review.', { exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.__writes)).filter(row => row.url.includes('/reviews/decide')).length, 0);
  await page.getByRole('button', { name: /^Emails to approve/ }).click();
  assert.equal(await page.locator('.dp-email-group .dp-card').count(), 6);
  await dana.getByRole('button', { name: 'Approve email & queue', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.dp-email-group .dp-card').length === 5);
  const writes = (await page.evaluate(() => window.__writes)).filter(row => row.url.includes('/reviews/decide'));
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0].body), [{ item_id: 'photon-email-1', decision: 'approve' }]);
  await page.screenshot({ path: `${shots}/queued-desktop.png` });
  // Company approval follows all four complete bodies and excludes Juniper.
  await page.getByRole('button', { name: /^Emails to approve/ }).click();
  const meridian = page.getByRole('region', { name: 'Meridian email review', exact: true });
  assert.equal(await meridian.locator('.dp-card').count(), 4);
  await meridian.getByRole('button', { name: 'Approve 4 emails & queue', exact: true }).click();
  const batchConfirm = meridian.getByRole('button', { name: 'Queue 4 emails? Confirm', exact: true });
  await batchConfirm.waitFor();
  await page.waitForTimeout(450);
  await batchConfirm.click();
  await page.waitForFunction(() => document.querySelectorAll('.dp-email-group .dp-card').length === 1);
  const batchWrites = (await page.evaluate(() => window.__writes)).filter(row => row.url.includes('/reviews/decide'));
  assert.deepEqual(JSON.parse(batchWrites[1].body).map(row => row.item_id).sort(), ['photon-email-2', 'photon-email-3', 'photon-email-4', 'photon-email-5']);
  await page.getByRole('article', { name: 'Owen Brooks, Juniper', exact: true }).waitFor();

  assert.deepEqual(errors, []);
  console.log('Desktop: 60 demo approvals queue zero emails; discovery and contacts stay visible; five recipient copies with clickable preview; one email approval queues exactly one send; company approval queues only its four remaining reviewed emails.');
} finally { await browser.close(); }

const mobile = await webkit.launch({ headless: true });
try {
  const page = await mobile.newPage({ ...devices['iPhone 13'] });
  await instrument(page);
  await page.goto(`${base}/dashboard/demos?mock=photon-review&seg=review`);
  await page.locator('.dp-email-group .dp-card').nth(4).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${shots}/email-review-mobile.png` });
  await page.getByRole('button', { name: /^Demos to approve/ }).click();
  await page.locator('.dp-approved').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: `${shots}/discovery-mobile.png` });
  console.log('iPhone WebKit: both approval views, recipient address, email preview, and discovery fit without horizontal page overflow.');
} finally { await mobile.close(); }
