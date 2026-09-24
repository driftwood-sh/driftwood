import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
const output='/private/tmp/driftwood-dashboard-review-shots';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[]; page.on('pageerror',(e)=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5191/dashboard/inbox?mock=1&approval=auto');
 await page.locator('.inbox-layout').waitFor();
 // Auto approval: nothing waits on the team, so there is no approval tab and no banner.
 assert.deepEqual(await page.getByRole('navigation',{name:'Message status'}).getByRole('button').allTextContents(),['Queued','Sent','Replies']);
 assert.equal(await page.locator('.inbox-approval-banner').count(),0);
 assert.equal(await page.getByRole('button',{name:'Queued',exact:true}).getAttribute('aria-pressed'),'true');
 await page.screenshot({path:`${output}/inbox-default-queued.png`,fullPage:true});
 await page.getByLabel('Message channel').selectOption('Email');
 await page.getByRole('button',{name:'Sent',exact:true}).click();
 await page.locator('.inbox-message').getByText('Email · Sent',{exact:true}).waitFor();
 assert.match(await page.locator('.inbox-outbound-body').innerText(),/same-day booking fix/);
 await page.screenshot({path:`${output}/inbox-sent.png`,fullPage:true});
 await page.getByRole('button',{name:'Queued',exact:true}).click();
 // The one queued email that carries an image; which email sorts first depends on the clock.
 await page.getByLabel('Search messages').fill('Two outreach fixes');
 await page.locator('.inbox-list button').filter({has:page.locator('.inbox-status.is-queued')}).first().click();
 await page.locator('.inbox-message').getByText('Email · Scheduled',{exact:true}).waitFor();
 await page.getByText(/Scheduled for/).waitFor();
 await page.locator('.inbox-outbound-body img').waitFor();
 await page.screenshot({path:`${output}/inbox-queued.png`,fullPage:true});
 await page.getByLabel('Search messages').fill('');
 // Drafts in Driftwood's final check are listed under Queued, read-only.
 await page.getByLabel('Message channel').selectOption('all');
 await page.locator('.inbox-list button').filter({has:page.locator('.inbox-status',{hasText:'Final check'})}).first().click();
 await page.getByText('Driftwood checks every message before it gets a send time. Nothing has been sent.',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:/Approve/}).count(),0);
 await page.locator('.inbox-list button').filter({has:page.locator('.inbox-status.is-failed')}).first().click();
 await page.locator('.inbox-message').getByText('LinkedIn · Needs attention',{exact:true}).waitFor();
 await page.locator('.inbox-failure').waitFor();
 await page.getByRole('button',{name:'Replies',exact:true}).click();
 await page.getByRole('button',{name:'Automatic',exact:true}).click();
 await page.locator('.inbox-message aside').filter({hasText:'Automatic response'}).waitFor();
 // Manual approval: the team's own drafts get their own tab.
 await page.goto('http://127.0.0.1:5191/dashboard/inbox?mock=1&approval=manual');
 await page.locator('.inbox-layout').waitFor();
 assert.deepEqual(await page.getByRole('navigation',{name:'Message status'}).getByRole('button').allTextContents(),['Queued','Needs approval','Sent','Replies']);
 assert.deepEqual(errors,[]);
 console.log('Queued default, sent email body, queued media/schedule, final check under Queued, approval tab only on manual, failures and automatic replies passed.');
} finally {await browser.close();}
const mobile=await webkit.launch({headless:true});
try {
 const page=await mobile.newPage({...devices['iPhone 13']});
 await page.goto('http://127.0.0.1:5191/dashboard/inbox?mock=1&approval=auto');
 await page.locator('.inbox-layout').waitFor();
 await page.getByRole('button',{name:'Queued',exact:true}).click();
 await page.getByLabel('Message channel').selectOption('Email');
 await page.locator('.inbox-list button').filter({has:page.locator('.inbox-status.is-queued')}).first().click();
 await page.getByText(/Scheduled for/).waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:`${output}/inbox-queued-mobile.png`,fullPage:true});
 console.log('iPhone WebKit queued-email view passed.');
} finally {await mobile.close();}
