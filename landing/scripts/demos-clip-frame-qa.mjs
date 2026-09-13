/* The regression this proves is gone: every clip on a Staging card was painted
   in a fixed 16:9 frame. Photon's demos are phone recordings, so each one
   arrived as a narrow strip of video between two wide black bars, and most of
   the frame carried nothing.

   What it holds to, at 1440px and at 390px:
   - a portrait clip is framed portrait, at its own ratio, capped at 400px tall
   - a portrait frame is centred in the rail, and the rail keeps its width
   - a landscape clip is framed exactly as before: 16:9 at the rail width
   - the duration badge keeps its corner in whichever frame is used
   - the 16:9 box is reserved from first paint, the real ratio replaces it in
     one step, and the swap moves nothing (ux-principles rule 17)

   Run the dev server on 5191 first: npm run dev -- --port 5191 */
import { chromium, webkit, devices } from 'playwright';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const base='http://127.0.0.1:5191';
const shots='/private/tmp/driftwood-dashboard-review-shots';
mkdirSync(shots,{recursive:true});

// Fixture clips, by the shape the file itself reports.
const PORTRAIT='Kitebar';                            // demo-portrait.mp4, 540x960, no email
const PORTRAIT_EMAIL='Priya Patel, Northstar';       // compare.mp4, 968x1182, with email
const LANDSCAPE='Yuvan Kumar, Autosana';             // case-autosana.mp4, 1920x1080, with email
const LANDSCAPE_BARE='Example lead, Sample company';  // case-autosana.mp4, 1920x1080, no email

const round=(n)=>Math.round(n*100)/100;
// A derived height lands a hundredth off the arithmetic, so compare to the pixel.
const near=(actual,expected,what)=>assert.ok(Math.abs(actual-expected)<0.5,`${what}: ${actual} is not ${round(expected)}`);

// Every measurement the assertions read, taken in one pass over one card.
const measure=(page,label)=>page.evaluate((name)=>{
 const card=document.querySelector(`.dp-card[aria-label="${name}"]`);
 const shell=card.querySelector('.dp-video-shell');
 const rail=card.querySelector('.dp-col-clip');
 const badge=card.querySelector('.dp-duration');
 const video=card.querySelector('video');
 const r=(n)=>Math.round(n*100)/100;
 const c=card.getBoundingClientRect();
 const s=shell.getBoundingClientRect();
 const a=rail.getBoundingClientRect();
 return {
  portrait:shell.classList.contains('is-portrait'),
  frame:{w:r(s.width),h:r(s.height),left:r(s.left),top:r(s.top)},
  rail:{w:r(a.width),left:r(a.left)},
  card:r(c.height),
  /* Measured from the frame's top right, which is the corner the badge has to
     keep whatever shape the frame takes. */
  badge:badge?{right:r(s.right-badge.getBoundingClientRect().right),top:r(badge.getBoundingClientRect().top-s.top)}:null,
  intrinsic:video?{w:video.videoWidth,h:video.videoHeight}:null,
 };
},label);

// Every clip on the page has reported its size, so the frames have settled.
const clipsSettled=(page)=>page.waitForFunction(()=>{
 const clips=[...document.querySelectorAll('.dp-card video')];
 return clips.length>0 && clips.every((v)=>v.readyState>0||v.error);
});

/* Layout shift, recorded with the element each shift is attributed to. Only
   Chromium reports these entries; WebKit reads back null. */
const recordShifts=(page)=>page.addInitScript(()=>{
 window.__shifts=null;
 try {
  const seen=[];
  new PerformanceObserver((list)=>{
   for (const entry of list.getEntries()) {
    if (entry.hadRecentInput) continue;
    seen.push({score:entry.value,inFrame:[...entry.sources].some((s)=>s.node?.closest?.('.dp-video-shell'))});
   }
  }).observe({type:'layout-shift',buffered:true});
  if (PerformanceObserver.supportedEntryTypes?.includes('layout-shift')) window.__shifts=seen;
 } catch {
  window.__shifts=null;
 }
});

async function pass(page,width){
 const errors=[];page.on('pageerror',(e)=>errors.push(e.message));
 await recordShifts(page);
 await page.goto(`${base}/dashboard/demos?mock=1`);
 await page.locator(`.dp-card[aria-label="${PORTRAIT}"]`).waitFor();
 await clipsSettled(page);

 const portrait=await measure(page,PORTRAIT);
 const portraitEmail=await measure(page,PORTRAIT_EMAIL);
 const landscape=await measure(page,LANDSCAPE);
 const landscapeBare=await measure(page,LANDSCAPE_BARE);

 // A phone recording is framed as one: taller than it is wide, at its own
 // 9:16, and 400px is the cap that keeps a card off a column.
 assert.equal(portrait.portrait,true,'the phone clip must carry a portrait frame');
 assert.deepEqual(portrait.intrinsic,{w:540,h:960},'the ratio comes from the file, not the name');
 assert.ok(portrait.frame.h>portrait.frame.w,`portrait frame must be taller than wide, got ${portrait.frame.w}x${portrait.frame.h}`);
 assert.equal(portrait.frame.h,400,'the clip height cap is 400px');
 assert.equal(portrait.frame.w,225,'a 9:16 clip is 225px wide at that cap');
 // Centred in the rail, and the rail is the width it always was.
 assert.equal(portrait.rail.w,width>=1440?320:324,'the rail width does not change');
 assert.equal(round(portrait.frame.left-portrait.rail.left),round((portrait.rail.w-portrait.frame.w)/2),'the portrait frame sits in the middle of the rail');
 // 0.55rem in from the top right of the frame, not of the rail around it.
 assert.deepEqual(portrait.badge,{right:8.8,top:8.8},'the duration badge keeps the frame corner');

 // A clip only a little taller than wide is still framed portrait, and here
 // the rail bounds the width before the height cap does.
 assert.equal(portraitEmail.portrait,true);
 assert.deepEqual(portraitEmail.intrinsic,{w:968,h:1182});
 assert.equal(portraitEmail.frame.w,portraitEmail.rail.w,'the rail bounds this one, so the frame fills it');
 assert.ok(portraitEmail.frame.h>portraitEmail.frame.w);
 near(portraitEmail.frame.h,portraitEmail.rail.w*1182/968,'frame height at the clip ratio');

 // Landscape is untouched: a 16:9 frame at the full rail width, flush left,
 // which is what the card has always painted.
 for (const clip of [landscape,landscapeBare]) {
  assert.equal(clip.portrait,false);
  assert.equal(clip.frame.w,clip.rail.w);
  near(clip.frame.h,clip.rail.w*9/16,'landscape frame height');
  assert.equal(clip.frame.left,clip.rail.left);
  assert.deepEqual(clip.badge,{right:8.8,top:8.8});
 }

 // Nothing a frame did moved anything. The page's own two-phase load (the
 // review items, then the library appended under them) is the only thing that
 // moves, and it moved the same way before this change.
 const shifts=await page.evaluate(()=>window.__shifts);
 if (shifts) assert.deepEqual(shifts.filter((s)=>s.inFrame),[],'no layout shift may be attributed to a clip frame');

 assert.deepEqual(errors,[]);
 return {portrait,portraitEmail,landscape,landscapeBare,shifts};
}

/* The swap costs nothing: the same page, once with the portrait clips
   resolving and once with them blocked, reports the same layout shift. Two
   portrait frames appear in the first run and none in the second, so any
   shift the ratio swap caused would show up as a difference. */
async function noShiftFromTheSwap(browser){
 const measureCls=async (block)=>{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await recordShifts(page);
  if (block) for (const clip of ['**/demo-portrait.mp4','**/compare.mp4']) await page.route(clip,(route)=>route.abort());
  await page.goto(`${base}/dashboard/demos?mock=1`);
  await page.locator(`.dp-card[aria-label="${PORTRAIT}"]`).waitFor();
  await clipsSettled(page);
  await page.waitForTimeout(1500);
  const shifts=await page.evaluate(()=>window.__shifts);
  const portraits=await page.locator('.dp-video-shell.is-portrait').count();
  await page.close();
  return {cls:shifts?shifts.reduce((sum,s)=>sum+s.score,0):null,portraits};
 };
 const resolving=await measureCls(false);
 const blocked=await measureCls(true);
 assert.equal(resolving.portraits,2,'two fixture clips are portrait');
 assert.equal(blocked.portraits,0,'blocking them leaves no portrait frame');
 assert.equal(resolving.cls,blocked.cls,`the swap must add no layout shift: ${resolving.cls} with it, ${blocked.cls} without`);
 return resolving.cls;
}

/* The reserved box, proved under a slow clip: the frame holds the 16:9 space
   from first paint, and the portrait ratio replaces it in one step. */
async function reservedThenSwapped(page){
 const errors=[];page.on('pageerror',(e)=>errors.push(e.message));
 let release;
 const gate=new Promise((resolve)=>{release=resolve;});
 await page.route('**/demo-portrait.mp4',async (route)=>{await gate;await route.continue();});
 await page.goto(`${base}/dashboard/demos?mock=1`);
 const card=page.locator(`.dp-card[aria-label="${PORTRAIT}"]`);
 await card.waitFor();
 // Watch the frame from before the bytes land. ResizeObserver reports the size
 // it starts on, so every later entry is a change.
 await card.locator('.dp-video-shell').evaluate((shell)=>{
  window.__frames=[];
  new ResizeObserver((entries)=>{
   for (const entry of entries) {
    const r=entry.target.getBoundingClientRect();
    const size=`${Math.round(r.width*100)/100}x${Math.round(r.height*100)/100}`;
    if (window.__frames.at(-1)!==size) window.__frames.push(size);
   }
  }).observe(shell);
 });
 const held=await measure(page,PORTRAIT);
 const heldLandscape=await measure(page,LANDSCAPE);
 // Space is reserved, not zero: the 16:9 box, which is also where a landscape
 // clip ends, so a card of landscape clips never moves at all.
 assert.equal(held.portrait,false);
 assert.equal(held.frame.w,held.rail.w);
 near(held.frame.h,held.rail.w*9/16,'reserved frame height');

 release();
 await card.locator('.dp-video-shell.is-portrait').waitFor();
 await clipsSettled(page);
 const swapped=await measure(page,PORTRAIT);
 assert.equal(swapped.frame.w,225);
 assert.equal(swapped.frame.h,400);
 // One step: the reserved box, then the portrait box, with no stage between.
 const frames=await page.evaluate(()=>window.__frames);
 assert.deepEqual(frames,[`${held.frame.w}x${held.frame.h}`,'225x400'],`the frame must change once, got ${frames.join(' -> ')}`);
 // A landscape card beside it neither moved nor resized.
 assert.deepEqual(await measure(page,LANDSCAPE),heldLandscape);

 assert.deepEqual(errors,[]);
 return {held,swapped,frames};
}

const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const desktop=await pass(page,1440);
 await page.screenshot({path:`${shots}/demos-clip-frame-1440.png`,fullPage:true});
 const slow=await browser.newPage({viewport:{width:1440,height:1100}});
 const held=await reservedThenSwapped(slow);
 await slow.close();
 const cls=await noShiftFromTheSwap(browser);
 console.log('Desktop Chromium 1440px');
 console.log(`  portrait, no email:  frame ${desktop.portrait.frame.w}x${desktop.portrait.frame.h}  card ${desktop.portrait.card}px`);
 console.log(`  portrait, email:     frame ${desktop.portraitEmail.frame.w}x${desktop.portraitEmail.frame.h}  card ${desktop.portraitEmail.card}px`);
 console.log(`  landscape, email:    frame ${desktop.landscape.frame.w}x${desktop.landscape.frame.h}  card ${desktop.landscape.card}px`);
 console.log(`  landscape, no email: frame ${desktop.landscapeBare.frame.w}x${desktop.landscapeBare.frame.h}  card ${desktop.landscapeBare.card}px`);
 console.log(`  slow clip: frame held at ${held.frames[0]}, then ${held.frames[1]}, in one step`);
 console.log(`  layout shift: ${cls} with the portrait frames and without them, none of it attributed to a frame`);
} finally {await browser.close();}

const mobile=await webkit.launch({headless:true});
try {
 const page=await mobile.newPage({...devices['iPhone 13'],viewport:{width:390,height:844}});
 const phone=await pass(page,390);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'the page must not scroll sideways');
 await page.screenshot({path:`${shots}/demos-clip-frame-390.png`,fullPage:true});
 console.log('iPhone WebKit 390px');
 console.log(`  portrait, no email:  frame ${phone.portrait.frame.w}x${phone.portrait.frame.h}  card ${phone.portrait.card}px`);
 console.log(`  portrait, email:     frame ${phone.portraitEmail.frame.w}x${phone.portraitEmail.frame.h}  card ${phone.portraitEmail.card}px`);
 console.log(`  landscape, no email: frame ${phone.landscapeBare.frame.w}x${phone.landscapeBare.frame.h}  card ${phone.landscapeBare.card}px`);
} finally {await mobile.close();}
