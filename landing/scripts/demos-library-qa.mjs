/* The regression this proves is gone: a workspace with demos made, nothing
   pending and nothing scheduled opened /dashboard/demos on three empty
   segments and read it as lost work.

   Run the dev server on 5191 first: npm run dev -- --port 5191 */
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const base='http://127.0.0.1:5191';
const shots='/private/tmp/driftwood-dashboard-review-shots';
mkdirSync(shots,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));

 // A workspace whose demos all sit in the library: Staging opens, and it
 // holds every one of them. The library is 111 rows and the endpoint serves
 // 50 at a time, so every page has to be asked for.
 // The mock answers inside the page, so no request leaves the browser. This
 // wraps whatever fetch the mock installs and keeps the library urls it is
 // asked for, which is how the paging is read back.
 await page.addInitScript(()=>{
  window.__libraryUrls=[];
  let current=window.fetch;
  Object.defineProperty(window,'fetch',{configurable:true,get:()=>current,set:(next)=>{
   current=(...args)=>{
    const url=typeof args[0]==='string'?args[0]:args[0]?.url??'';
    if (url.includes('/api/v1/dashboard/demos?')) window.__libraryUrls.push(url);
    return next(...args);
   };
  }});
 });
 await page.goto(`${base}/dashboard/demos?mock=library-only`);
 await page.locator('.dp-card').first().waitFor();
 const pressed=page.locator('.dp-segments button[aria-pressed="true"]');
 assert.match(await pressed.innerText(),/^Staging/);
 assert.equal(await page.locator('.dp-empty').count(),0);
 // Every row arrives, and the count says so rather than naming the first page.
 await page.locator('.dp-card').nth(110).waitFor();
 assert.equal(await page.locator('.dp-card').count(),111);
 await pressed.locator('.dp-count').getByText('111',{exact:true}).waitFor();
 // 50 rows a page, so 111 of them take three asks: offsets 0, 50 and 100.
 const asked=await page.evaluate(()=>[...new Set(window.__libraryUrls.map((u)=>Number(new URL(u,location.origin).searchParams.get('offset')??0)))].sort((a,b)=>a-b));
 assert.deepEqual(asked,[0,50,100]);
 // The progress line is honest while the rest is still coming, and gone once
 // the whole library is in.
 assert.equal(await page.locator('.dp-quiet').filter({hasText:'Loading the rest.'}).count(),0);
 // The six the customer asked about, and the clip on each one.
 for (const name of ['Airbnb','Bookaway','Booking.com','Flixbus','Hostelworld','Omio']) {
  const card=page.locator(`.dp-card[aria-label="${name}"]`);
  await card.waitFor();
  assert.equal(await card.locator('video.dp-video').count(),1);
 }
 // Newest first, whatever made the demo.
 assert.equal(await page.locator('.dp-card').first().getAttribute('aria-label'),'Airbnb');
 assert.equal(await page.locator('.dp-card').last().getAttribute('aria-label'),'Demo run 100');
 // Nothing to approve, skip or pin: those writes name a review item.
 for (const label of ['Approve','Skip','Pin','Approve all']) {
  assert.equal(await page.getByRole('button',{name:label,exact:true}).count(),0,`${label} must not render`);
 }
 assert.equal(await page.getByRole('button',{name:'Ask for a change',exact:true}).count(),111);
 assert.ok(await page.locator('.dp-idea').count()>0);
 // The clip really plays: the file is there and the element has data.
 assert.ok(await page.locator('.dp-card').first().locator('video').evaluate((v)=>new Promise((done)=>{
  if (v.readyState>0) return done(true);
  v.addEventListener('loadedmetadata',()=>done(true),{once:true});
  v.addEventListener('error',()=>done(false),{once:true});
  setTimeout(()=>done(v.readyState>0),4000);
 })),'the first clip must load');
 assert.equal(await page.getByRole('link',{name:'All demo videos'}).count(),0);
 // 111 clips make a very tall page; the fold is what a reader sees.
 await page.screenshot({path:`${shots}/demos-staging-library-only.png`});

 // A link already shared still lands somewhere real.
 await page.goto(`${base}/dashboard/demos/library?mock=library-only`);
 await page.locator('.dp-card').first().waitFor();
 assert.match(new URL(page.url()).pathname,/^\/dashboard\/demos$/);
 assert.match(await page.locator('.dp-segments button[aria-pressed="true"]').innerText(),/^Staging/);
 await page.locator('.dp-card').nth(110).waitFor();
 assert.equal(await page.locator('.dp-card').count(),111);

 // A demo both sources hold is one card, and it keeps its email.
 await page.goto(`${base}/dashboard/demos?mock=1`);
 await page.locator('.dp-card').first().waitFor();
 const northstar=page.locator('.dp-card[aria-label*="Priya Patel"]');
 assert.equal(await northstar.count(),1);
 assert.equal(await northstar.locator('.dp-col-email').count(),1);
 assert.equal(await northstar.getByRole('button',{name:'Approve',exact:true}).count(),1);
 // The same page still carries the demos that have no email yet.
 const sample=page.locator('.dp-card[aria-label*="Sample company"]');
 assert.equal(await sample.count(),1);
 assert.equal(await sample.getByRole('button',{name:'Approve',exact:true}).count(),0);
 assert.equal(await sample.getByRole('button',{name:'Ask for a change',exact:true}).count(),1);
 // And a change on one of those sends.
 await sample.getByRole('button',{name:'Ask for a change',exact:true}).click();
 await sample.getByRole('textbox').fill('Cut the first four seconds.');
 await sample.getByRole('button',{name:'Send',exact:true}).click();
 await page.getByText('Change sent.',{exact:true}).waitFor();
 await page.screenshot({path:`${shots}/demos-staging-both-sources.png`,fullPage:true});

 // One card per company. This library holds 71 rows for 60 companies: 60
 // arrive from the private-run source as "<company> (<domain>)", and 11 of
 // those companies arrive again as a lead-linked video under the bare company
 // name. A customer counts companies, so the page owes 60 cards and a count
 // that says 60.
 await page.goto(`${base}/dashboard/demos?mock=photon-shaped`);
 await page.locator('.dp-card').first().waitFor();
 const staging=page.locator('.dp-segments button[aria-pressed="true"]');
 // The count renders only once both sources are whole, so it is also the
 // signal that the second page of the library landed.
 await staging.locator('.dp-count').waitFor();
 const shown=await page.locator('.dp-card').evaluateAll((nodes)=>nodes.map((node)=>node.getAttribute('aria-label')));
 const company=(label)=>label.toLowerCase().replace(/\s*\([^()]+\)$/,'').trim();
 const companies=new Set(shown.map(company));
 assert.equal(shown.length,60,'one card per company');
 assert.equal(companies.size,60,`no company twice: ${[...companies].filter((name)=>shown.filter((label)=>company(label)===name).length>1)}`);
 assert.equal(await staging.locator('.dp-count').innerText(),'60','the count is what the segment lists');
 // The copy kept is the newest one, whichever source registered it: Airbnb's
 // lead-linked video is newer than its run, and Wanderu's run is newer than
 // its lead-linked video.
 assert.ok(shown.includes('Airbnb'),'Airbnb keeps its newer lead-linked video');
 assert.ok(shown.includes('Wanderu (wanderu.com)'),'Wanderu keeps its newer run');
 await page.screenshot({path:`${shots}/demos-staging-photon-shaped.png`});

 // A segment the reader picks still wins.
 await page.goto(`${base}/dashboard/demos?seg=sent&mock=library-only`);
 await page.locator('.dp-empty').waitFor();
 assert.match(await page.locator('.dp-segments button[aria-pressed="true"]').innerText(),/^Sent/);
 assert.equal(await page.getByRole('link',{name:'All demo videos'}).count(),0);

 assert.deepEqual(errors,[]);
 console.log('Desktop Chromium: library demos in Staging, no dead controls, one card per demo, one card per company, /library resolves, explicit segment wins.');
} finally {await browser.close();}

const mobile=await webkit.launch({headless:true});
try {
 const page=await mobile.newPage({...devices['iPhone 13']});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${base}/dashboard/demos?mock=library-only`);
 await page.locator('.dp-card').first().waitFor();
 await page.locator('.dp-card').nth(110).waitFor();
 assert.equal(await page.locator('.dp-card').count(),111);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:`${shots}/demos-staging-library-only-mobile.png`});
 assert.deepEqual(errors,[]);
 console.log('iPhone WebKit: Staging holds the library and the page does not scroll sideways.');
} finally {await mobile.close();}
