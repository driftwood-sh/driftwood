import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5191';
for (const mobile of [false,true]) {
 const browser=await (mobile ? webkit : chromium).launch({headless:true});
 try {
  const page=await browser.newPage(mobile ? {...devices['iPhone 13']} : {viewport:{width:1440,height:1100}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/dashboard?mock=1`);
  await page.getByText('Emails sent today',{exact:true}).waitFor();
  assert.equal(await page.locator('.app-sidebar-nav a[href*="face-cloning"]').count(),1);
  // Flow replaces Campaigns: four stations, then who goes out next.
  assert.equal(await page.locator('.app-sidebar-nav a[href*="/dashboard/flow"]').count(),1);
  assert.equal(await page.locator('.app-sidebar-nav a[href*="/dashboard/campaigns"]').count(),0);
  await page.goto(`${base}/dashboard/face-cloning?mock=1`);
  assert.equal(await page.getByRole('navigation',{name:'Settings views'}).count(),0);
  await page.goto(`${base}/dashboard/flow?mock=1&approval=auto`);
  await page.locator('.flow-step').nth(3).waitFor();
  assert.equal(await page.locator('.flow-step').count(),4);
  await page.locator('.flow-list > li').first().waitFor();
  await page.locator('.flow-preview').waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.goto(`${base}/dashboard/audiences?mock=1`);
  await page.locator('.audience-list-row').first().click();
  await page.locator('.audience-members-table').waitFor();
  assert.match(page.url(),/audience=audience-qualified-qa/);
  // The source chips narrow the people; Export follows what is shown.
  await page.getByRole('group',{name:'Found by'}).getByRole('button',{name:/Lead search/}).click();
  assert.ok((await page.locator('.audience-found').allTextContents()).every((text)=>text==='Lead search'));
  await page.getByRole('button',{name:/^Export \d+ shown$/}).waitFor();
  await page.getByRole('button',{name:'Edit tags',exact:true}).click();
  await page.getByLabel('Audience tags').fill('QA, High intent, Funded');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.locator('.audience-tag-line').getByText('Funded',{exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`/private/tmp/driftwood-dashboard-review-shots/combined-audiences-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  await page.goBack();
  await page.locator('.audience-list-row').first().waitFor();
  await page.getByRole('link',{name:'All contacts',exact:true}).click();
  await page.getByRole('navigation',{name:'Audience views'}).getByRole('link',{name:'Companies',exact:true}).click();
  await page.getByRole('navigation',{name:'Audience views'}).getByRole('link',{name:'Lists',exact:true}).waitFor();
  await page.goto(`${base}/dashboard/campaigns/founder-led-qa?mock=1`);
  await page.getByRole('button',{name:'Preview email',exact:true}).click();
  await page.locator('.campaign-email-preview').waitFor();
  await page.getByLabel('Demo outcome').fill('Catch release issues before users do');
  await page.getByRole('button',{name:/Request \d+ demos/}).click();
  await page.getByRole('status').filter({hasText:'demo requests queued for your agent'}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.screenshot({path:`/private/tmp/driftwood-dashboard-review-shots/combined-campaign-${mobile?'mobile':'desktop'}.png`,fullPage:true});
  assert.deepEqual(errors,[]);
  console.log(`${mobile?'iPhone WebKit':'Desktop Chromium'} combined dashboard: Face Cloning, Flow, audience people/sources/tags, demo request and email preview passed.`);
 } finally {await browser.close();}
}
