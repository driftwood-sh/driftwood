import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:5191';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const tabs=()=>page.getByRole('navigation',{name:'Message status'}).getByRole('button').allTextContents();
 // Auto: no approval tab, and Driftwood's drafts sit in Queued as a final check.
 await page.goto(`${base}/dashboard/inbox?mock=1&approval=auto`);
 await page.locator('.inbox-layout').waitFor();
 assert.deepEqual(await tabs(),['Queued','Sent','Replies']);
 await page.locator('.inbox-status',{hasText:'Final check'}).first().waitFor();
 assert.equal(await page.getByRole('button',{name:/^Approve/}).count(),0);
 await page.goto(`${base}/dashboard/settings?tab=approvals&mock=1`);
 await page.getByRole('radio',{name:/Hybrid approval/}).check();
 await page.locator('.approval-campaigns select').first().selectOption('customer');
 await page.getByRole('button',{name:'Save approval settings'}).click();
 await page.getByText('Approval settings saved.',{exact:true}).waitFor();
 await page.screenshot({path:'/private/tmp/driftwood-dashboard-review-shots/approval-settings-hybrid.png',fullPage:true});
 await page.getByRole('link',{name:'Back to Inbox →'}).click();
 // Hybrid: the team's campaign waits in Needs approval, the rest is Driftwood's final check.
 await page.getByRole('button',{name:'Needs approval',exact:true}).click();
 await page.locator('.inbox-status').getByText('Needs your approval',{exact:true}).first().waitFor();
 assert.equal(await page.locator('.inbox-status',{hasText:'Final check'}).count(),0);
 await page.screenshot({path:'/private/tmp/driftwood-dashboard-review-shots/inbox-pending-hybrid.png',fullPage:true});
 await page.getByRole('button',{name:'Queued',exact:true}).click();
 await page.locator('.inbox-status',{hasText:'Final check'}).first().waitFor();
 await page.getByRole('button',{name:'Needs approval',exact:true}).click();
 await page.getByRole('link',{name:'Change who approves'}).click();
 await page.getByRole('radio',{name:/Manual approval/}).check();
 await page.getByRole('button',{name:'Save approval settings'}).click();
 await page.getByText('Approval settings saved.',{exact:true}).waitFor();
 await page.getByRole('link',{name:'Back to Inbox →'}).click();
 await page.getByRole('button',{name:'Needs approval',exact:true}).click();
 await page.getByRole('button',{name:'Approve message',exact:true}).click();
 await page.getByRole('button',{name:'Confirm approval',exact:true}).click();
 await page.getByText('1 approved and moved to Queued.',{exact:true}).waitFor();
 await page.getByRole('button',{name:/Approve \d+ visible messages/}).click();
 await page.getByRole('button',{name:/Confirm approval of \d+ messages/}).click();
 await page.getByRole('heading',{name:'No matching messages'}).waitFor();
 await page.getByRole('button',{name:'Queued',exact:true}).click();
 assert.ok(await page.locator('.inbox-status.is-queued').count()>5);
 await page.reload();
 await page.getByRole('button',{name:'Needs approval',exact:true}).waitFor();
 await page.goto(`${base}/dashboard/settings?tab=approvals&mock=member`);
 await page.getByRole('radio',{name:/Manual approval/}).waitFor();
 assert.equal(await page.getByRole('radio',{name:/Manual approval/}).isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'Save approval settings'}).count(),0);
 assert.deepEqual(errors,[]);
 console.log('Auto (no approval tab), campaign-based Hybrid, Manual, single/batch approval, persistence and member permissions passed.');
} finally {await browser.close();}
const mobile=await webkit.launch({headless:true});
try {
 const page=await mobile.newPage({...devices['iPhone 13']});
 await page.goto(`${base}/dashboard/settings?tab=approvals&mock=1`);
 await page.getByRole('radio',{name:/Hybrid approval/}).check();
 await page.locator('.approval-campaigns select').first().waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:'/private/tmp/driftwood-dashboard-review-shots/approval-settings-mobile.png',fullPage:true});
 console.log('iPhone WebKit approval settings layout passed.');
} finally {await mobile.close();}
