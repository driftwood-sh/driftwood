import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100},deviceScaleFactor:2});
 await page.goto('http://127.0.0.1:5191/dashboard?mock=1');
 await page.getByText('Emails sent today',{exact:true}).waitFor();
 await page.locator('.overview-latest-sends .overview-empty, .overview-latest-sends h3 + *').first().waitFor();
 await page.getByText('Manual approval',{exact:true}).waitFor();
 await page.evaluate(()=>document.fonts.ready);
 await page.locator('.overview-imports').evaluate(el=>el.open=true);
 // The disclosure mark rotates on open; shoot it at rest.
 await page.waitForTimeout(500);
 const root=page.locator('.overview-page');
 await root.screenshot({path:'/private/tmp/dashboard-marketing.png'});
 const bounds=await root.boundingBox();
 const selectors={linkedin:'.overview-sending-stats',results:'.overview-metrics',latest:'.overview-latest-sends',leads:'.overview-add',blacklist:'.overview-imports'};
 const regions={};
 for(const [id,selector] of Object.entries(selectors)) {
  const b=await page.locator(selector).boundingBox();
  regions[id]={l:100*(b.x-bounds.x)/bounds.width,t:100*(b.y-bounds.y)/bounds.height,w:100*b.width/bounds.width,h:100*b.height/bounds.height};
 }
 await writeFile('/private/tmp/dashboard-shot-regions.json',JSON.stringify({bounds,regions}));
} finally {await browser.close();}
