import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium, webkit, devices } from "playwright";

const base = process.env.DRIFT_TEST_BASE_URL ?? "http://127.0.0.1:5182";
const screenshots = process.env.DRIFT_TEST_SCREENSHOTS;
const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const demo = JSON.parse(
  await readFile(
    process.env.DRIFT_TEST_TIMELINE ?? fixture("timeline.json"),
    "utf8",
  ),
);
const video = await readFile(
  process.env.DRIFT_TEST_VIDEO ?? fixture("timeline.mp4"),
);
const axe = await readFile(
  new URL("../node_modules/axe-core/axe.min.js", import.meta.url),
  "utf8",
);
if (screenshots) await mkdir(screenshots, { recursive: true });
const nextId = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const focus =
  demo.scenes.find((scene) => scene.id === "preview") ?? demo.scenes.at(-1);

async function setup(
  page,
  { admin = true, empty = false, broken = false } = {},
) {
  const writes = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).origin === new URL(base).origin &&
      !["GET", "HEAD"].includes(request.method())
    )
      writes.push(request.url());
  });
  await page.route("**/auth/me", (route) =>
    route.fulfill({
      json: {
        id: "qa-staff",
        name: "Demo reviewer",
        email: "reviewer@test.invalid",
        is_admin: admin,
      },
    }),
  );
  await page.route("**/api/v1/admin/drift/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/overview"))
      return route.fulfill({
        json: {
          refreshed_at: new Date().toISOString(),
          agents: [
            { agent_id: "photon", states: { done: 1 }, total: 1, in_flight: 0 },
            { agent_id: "autosana", states: {}, total: 0, in_flight: 0 },
          ],
          flows: {},
          tasks: ["photon_demo"],
        },
      });
    if (path.endsWith("/runs")) return route.fulfill({ json: { runs: [] } });
    if (path.endsWith("/demos"))
      return route.fulfill({
        json: {
          demos: empty
            ? []
            : [
                {
                  run_id: demo.run_id,
                  company_name: demo.company_name,
                  created_at: "2026-09-13T00:00:00Z",
                },
                {
                  run_id: nextId,
                  company_name: "Another version",
                  created_at: "2026-09-12T00:00:00Z",
                },
              ],
        },
      });
    if (broken)
      return route.fulfill({
        status: 422,
        json: { error: { code: "demo_timeline_unavailable" } },
      });
    return route.fulfill({ json: { ...demo, run_id: path.split("/").at(-1) } });
  });
  await page.route(`**${demo.video_url}`, (route) =>
    route.fulfill({
      body: video,
      contentType: "video/mp4",
      headers: { "Cache-Control": "private, no-store" },
    }),
  );
  return writes;
}

async function checkStudio(page, name) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const writes = await setup(page);
  await page.goto(`${base}/dashboard/admin/drift`);
  const studio = page.getByRole("region", { name: "Photon demo editor" });
  const timeline = page.getByRole("region", { name: "Demo timeline" });
  const inspector = page.getByRole("complementary", {
    name: "Selected moment",
  });
  const note = page.getByRole("textbox", { name: "What would you change?" });
  const save = page.getByRole("button", {
    name: "Save draft edit",
    exact: true,
  });
  const slider = page.getByRole("slider", { name: "Demo playhead" });
  const moment = (scene) =>
    timeline.getByRole("button", { name: new RegExp(`^${scene.label},`) });
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".recorded-thumbnail img").length === count,
    demo.scenes.length,
  );
  assert.equal(await timeline.locator("button").count(), demo.scenes.length);
  assert.equal(await save.isDisabled(), true);
  assert.match(
    await page.locator(".recorded-video-canvas video").getAttribute("src"),
    /^blob:/,
  );
  const frameSources = await timeline
    .locator("img")
    .evaluateAll((images) => images.map((image) => image.src));
  assert.ok(
    new Set(frameSources).size > 1,
    "Thumbnails must decode distinct frames from the video",
  );

  await moment(focus).click();
  await inspector
    .getByRole("heading", { name: focus.label, exact: true })
    .waitFor();
  await page.waitForFunction((at) => {
    const video = document.querySelector(".recorded-video-canvas video");
    return (
      !video.seeking &&
      video.readyState >= 2 &&
      Math.abs(video.currentTime - at) < 0.1
    );
  }, focus.preview_time);
  for (const content of focus.content)
    assert.ok((await inspector.innerText()).includes(content.text));
  await page.getByRole("button", { name: "Pacing", exact: true }).click();
  await note.fill("Give this result two more seconds on screen.");
  assert.equal(await slider.isDisabled(), true);
  await moment(demo.scenes[0]).click();
  assert.equal(
    await inspector
      .getByRole("heading", { name: focus.label, exact: true })
      .count(),
    1,
  );
  await save.click();
  await page
    .getByText("Draft saved for this tab. The video has not changed.", {
      exact: true,
    })
    .waitFor();
  const saved = await page.evaluate(() =>
    Object.entries(sessionStorage)
      .filter(([key]) => key.startsWith("drift-demo-edits:"))
      .flatMap(([, value]) => JSON.parse(value)),
  );
  assert.equal(saved[0].scene_id, focus.id);
  assert.equal(saved[0].video_version, demo.video_version);
  assert.equal(saved[0].workflow_version, demo.workflow_version);
  assert.equal(saved[0].target, "timing");

  // Draft notes survive reloads, but remain isolated by demo and viewer.
  await page.reload();
  await moment(focus).click();
  await page
    .getByText("Give this result two more seconds on screen.", { exact: true })
    .waitFor();
  await page.getByLabel("Demo", { exact: true }).selectOption(nextId);
  await page.waitForFunction(() =>
    document
      .querySelector(".recorded-timeline header")
      ?.textContent.includes("0 draft edits"),
  );
  await page.getByLabel("Demo", { exact: true }).selectOption(demo.run_id);
  await moment(focus).click();
  await page
    .getByText("Give this result two more seconds on screen.", { exact: true })
    .waitFor();
  await note.fill("Keep this unfinished request.");
  await page.getByRole("tab", { name: "Run history", exact: true }).click();
  await page.getByRole("tab", { name: "Demo editor", exact: true }).click();
  assert.equal(await note.inputValue(), "Keep this unfinished request.");
  await page.getByLabel("Agent", { exact: true }).selectOption("autosana");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(
    await page.getByLabel("Agent", { exact: true }).inputValue(),
    "photon",
  );
  await page.getByLabel("Demo", { exact: true }).selectOption(nextId);
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(
    await page.getByLabel("Demo", { exact: true }).inputValue(),
    demo.run_id,
  );
  await page.getByRole("button", { name: "Discard", exact: true }).click();

  // Native video time, selected scene, scrubber and playback stay synchronized.
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Demo playhead"]').disabled,
  );
  await slider.fill(String(demo.scenes[1].start));
  await inspector
    .getByRole("heading", { name: demo.scenes[1].label, exact: true })
    .waitFor();
  await slider.fill(String(demo.duration - 0.5));
  await page.waitForFunction((at) => {
    const video = document.querySelector(".recorded-video-canvas video");
    return !video.seeking && Math.abs(video.currentTime - at) < 0.1;
  }, demo.duration - 0.5);
  await page.getByRole("button", { name: "Play demo", exact: true }).click();
  await page.waitForFunction(
    () => document.querySelector(".recorded-video-canvas video").ended,
  );
  await page.getByRole("button", { name: "Play demo", exact: true }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector(".recorded-video-canvas video");
    return video.currentTime > 0 && video.currentTime < 4 && !video.paused;
  });
  await page.getByRole("button", { name: "Pause demo", exact: true }).click();
  await moment(focus).click();
  await page.waitForFunction(
    (count) =>
      document.querySelectorAll(".recorded-thumbnail img").length === count,
    demo.scenes.length,
  );
  await page.waitForFunction((at) => {
    const video = document.querySelector(".recorded-video-canvas video");
    return (
      !video.seeking &&
      video.readyState >= 2 &&
      Math.abs(video.currentTime - at) < 0.1
    );
  }, focus.preview_time);
  // The paused player must show the same decoded moment as its thumbnail.
  const frameDifference = await page.evaluate(() => {
    const video = document.querySelector(".recorded-video-canvas video");
    const thumbnail = document.querySelector(
      '.recorded-timeline button[aria-pressed="true"] img',
    );
    const canvas = document.createElement("canvas");
    canvas.width = thumbnail.naturalWidth;
    canvas.height = thumbnail.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const a = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.drawImage(thumbnail, 0, 0, canvas.width, canvas.height);
    const b = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return (
      a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) /
      a.length
    );
  });
  assert.ok(
    frameDifference < 10,
    `${name}: paused player must match the selected frame (${frameDifference})`,
  );
  await page.evaluate(axe);
  const violations = await page.evaluate(async () =>
    (
      await window.axe.run(document, {
        runOnly: ["wcag2a", "wcag2aa", "wcag21aa"],
      })
    ).violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
  );
  assert.deepEqual(violations, [], `${name} accessibility`);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
    true,
    `${name} horizontal overflow`,
  );
  if (screenshots) {
    await page.evaluate(() => {
      document.activeElement?.blur();
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500); // Let mobile scroll and video compositing finish.
    await page.screenshot({
      path: `${screenshots}/studio-${name}.png`,
      fullPage: true,
    });
    await studio.screenshot({ path: `${screenshots}/editor-${name}.png` });
  }
  assert.deepEqual(
    writes,
    [],
    "The editor must never mutate a script, generate media or send feedback",
  );
  assert.deepEqual(errors, [], `${name} browser errors`);
  console.log(
    `${name}: real frame decoding, timeline mapping, playback, scoped drafts, unsaved guards, history, no API writes and accessibility passed`,
  );
}

const desktop = await chromium.launch();
try {
  const context = await desktop.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await checkStudio(await context.newPage(), "desktop");
  for (const state of [{ admin: false }, { empty: true }, { broken: true }]) {
    const page = await context.newPage();
    await setup(page, state);
    await page.goto(`${base}/dashboard/admin/drift`);
    if (state.admin === false)
      await page.getByRole("link", { name: /Google/ }).waitFor();
    else if (state.empty)
      await page
        .getByRole("heading", { name: "No completed demos yet" })
        .waitFor();
    else
      await page
        .getByRole("button", { name: "Try again", exact: true })
        .waitFor();
    assert.equal(await page.locator(".recorded-video-canvas video").count(), 0);
    await page.close();
  }
  console.log(
    "Unauthenticated/member, empty and unavailable evidence states passed",
  );
} finally {
  await desktop.close();
}

const mobile = await webkit.launch(
  process.env.DRIFT_TEST_WEBKIT_EXECUTABLE
    ? { executablePath: process.env.DRIFT_TEST_WEBKIT_EXECUTABLE }
    : {},
);
try {
  const context = await mobile.newContext({ ...devices["iPhone 13"] });
  await checkStudio(await context.newPage(), "iphone");
} finally {
  await mobile.close();
}
