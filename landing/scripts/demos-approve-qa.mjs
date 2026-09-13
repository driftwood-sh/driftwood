/* Approve, before anyone has been found to send the demo to.

   The hole this proves is closed: a workspace with sixty demos and no email
   on any of them had no way to say "send this one". Their cards offered only
   Ask for a change, so the demos sat in Staging and nothing left it.

   Four things have to hold:
   - a card with no email carries Approve, and one press moves it;
   - Approve all covers the whole segment, arms, and names the number;
   - an approved demo with nobody to send it to yet is at the top of Queue,
     with the company and the day it was approved;
   - a demo nobody was found for carries one line and one thing to do about
     it, and the name the customer types goes back through the same call.

   Plus the state prod is in until the backend ships: every control renders,
   and a 404 says so beside the control.

   Run the dev server first: npm run dev -- --port 5191
   Another port: DEMO_QA_BASE_URL=http://127.0.0.1:5193 node scripts/demos-approve-qa.mjs */
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const base=process.env.DEMO_QA_BASE_URL ?? 'http://127.0.0.1:5191';
const shots='/private/tmp/driftwood-dashboard-review-shots';
mkdirSync(shots,{recursive:true});

/* The fixture: sixty demos with no email, and four already approved — two
   waiting for people, two nobody was found for. */
const STAGED=60;
const APPROVED=4;

const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));

 // ---- one demo, one press ----
 await page.goto(`${base}/dashboard/demos?mock=demos-approval`);
 await page.locator('.dp-card').nth(STAGED-1).waitFor();
 assert.equal(await page.locator('.dp-card').count(),STAGED);
 // Every card offers it, because Approve names the demo and not a review item.
 assert.equal(await page.getByRole('button',{name:'Approve',exact:true}).count(),STAGED);
 // The demos already approved are not among them: they have left Staging.
 for (const company of ['Meridian','Ledgerline','Bloom','Kestrel'])
  assert.equal(await page.locator(`.dp-card[aria-label="${company}"]`).count(),0,`${company} must have left Staging`);
 const airbnb=page.locator('.dp-card[aria-label="Airbnb"]');
 await airbnb.getByRole('button',{name:'Approve',exact:true}).click();
 await page.getByText('Approved.',{exact:true}).waitFor();
 assert.equal(await airbnb.count(),0,'an approved demo leaves Staging');
 assert.equal(await page.locator('.dp-card').count(),STAGED-1);

 // ---- the group at the top of Queue ----
 await page.getByRole('button',{name:/^Queue/}).click();
 const group=page.locator('section.dp-approved');
 await group.waitFor();
 await group.getByRole('heading',{name:'Approved, not scheduled yet'}).waitFor();
 const rows=group.locator('tbody tr');
 assert.equal(await rows.count(),APPROVED+1);
 // Newest approval first, with the company and the day they approved it.
 assert.deepEqual(await rows.first().locator('td').allInnerTexts(),['Airbnb','Today']);
 // Nothing queued in this workspace, so the group stands alone — and the
 // empty-queue line must not claim there is nothing here.
 assert.equal(await page.locator('.dp-day:not(.dp-approved)').count(),0);
 assert.equal(await page.locator('.dp-empty').count(),0);
 // The number over the tab counts the group, not only the days.
 await page.locator('.dp-segments button[aria-pressed="true"] .dp-count').getByText(String(APPROVED+1),{exact:true}).waitFor();
 await page.screenshot({path:`${shots}/demos-queue-approved-group.png`});

 // ---- nobody found: one line, one action ----
 // The backend's own note writes the line when it wrote one; otherwise the
 // line names the company.
 const bloom=rows.filter({hasText:'No one found at Bloom.'});
 assert.equal(await bloom.count(),1);
 assert.equal(await rows.filter({hasText:'Kestrel is on your blocklist.'}).count(),1);
 // Nothing on this surface describes our work, so no row narrates one.
 const groupText=await group.innerText();
 for (const word of ['enrich','Enrich','finding','contacts','looking'])
  assert.equal(groupText.includes(word),false,`the group must not say "${word}"`);
 await bloom.getByRole('button',{name:'Add a name'}).click();
 await bloom.getByRole('textbox').fill('Ada Lovelace');
 await bloom.getByRole('button',{name:'Add',exact:true}).click();
 await page.getByText('Ada Lovelace added.',{exact:true}).waitFor();
 // A name means there is somebody to send it to, so the line is gone and the
 // row reads like the rest of the group.
 assert.equal(await rows.filter({hasText:'No one found at Bloom.'}).count(),0);
 assert.deepEqual(await rows.filter({hasText:'Bloom'}).locator('td').allInnerTexts(),['Bloom','Today']);

 // ---- Approve all, sixty of them, on a fresh page ----
 await page.goto(`${base}/dashboard/demos?mock=demos-approval`);
 await page.locator('.dp-card').nth(STAGED-1).waitFor();
 const all=page.getByRole('button',{name:'Approve all',exact:true});
 await all.click();
 // Arms first, and the confirm states the number, with no cap on it.
 const confirm=page.getByRole('button',{name:`Approve all ${STAGED}? Confirm`});
 await confirm.waitFor();
 // A press inside the guard window is a double click, not a decision.
 await confirm.click();
 assert.equal(await confirm.count(),1,'a press inside the guard window decides nothing');
 await page.waitForTimeout(500);
 await confirm.click();
 await page.getByText(`${STAGED} demos approved.`,{exact:true}).waitFor();
 await page.locator('.dp-empty').waitFor();
 assert.equal(await page.locator('.dp-card').count(),0);
 await page.getByRole('button',{name:/^Queue/}).click();
 await group.waitFor();
 assert.equal(await group.locator('tbody tr').count(),STAGED+APPROVED);
 await page.screenshot({path:`${shots}/demos-queue-approved-all.png`});

 // ---- until the backend ships ----
 // Every control renders, and a 404 says so beside the control that was
 // pressed rather than as a failure the customer cannot act on.
 await page.goto(`${base}/dashboard/demos?mock=demos-approve-missing`);
 await page.locator('.dp-card').first().waitFor();
 const missing=page.locator('.dp-card[aria-label="Airbnb"]');
 assert.equal(await missing.getByRole('button',{name:'Approve',exact:true}).count(),1);
 await missing.getByRole('button',{name:'Approve',exact:true}).click();
 await missing.locator('.dp-error').getByText('Not available yet.',{exact:true}).waitFor();
 // The demo stays where it is: nothing was approved.
 assert.equal(await missing.count(),1);
 const allMissing=page.getByRole('button',{name:'Approve all',exact:true});
 await allMissing.click();
 await page.waitForTimeout(500);
 await page.getByRole('button',{name:`Approve all ${STAGED}? Confirm`}).click();
 await page.locator('.dp-error').getByText('Not available yet.',{exact:true}).first().waitFor();
 assert.equal(await page.locator('.dp-card').count(),STAGED);

 assert.deepEqual(errors,[]);
 console.log('Desktop Chromium: Approve on a demo with no email, Approve all of 60 armed and confirmed, the Queue group, the nobody-found line and its name, and the 404 line.');
} finally {await browser.close();}

const mobile=await webkit.launch({headless:true});
try {
 const page=await mobile.newPage({...devices['iPhone 13']});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/dashboard/demos?seg=queue&mock=demos-approval`);
 const group=page.locator('section.dp-approved');
 await group.waitFor();
 assert.equal(await group.locator('tbody tr').count(),APPROVED);
 await group.getByRole('button',{name:'Add a name'}).first().click();
 await group.getByRole('textbox').first().waitFor();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:`${shots}/demos-queue-approved-group-mobile.png`});
 assert.deepEqual(errors,[]);
 console.log('iPhone WebKit: the group and its name field fit, and the page does not scroll sideways.');
} finally {await mobile.close();}
