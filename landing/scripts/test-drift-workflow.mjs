import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium, webkit, devices } from "playwright";

const base = process.env.DRIFT_TEST_BASE_URL ?? "http://127.0.0.1:5182";
const screenshots = process.env.DRIFT_TEST_SCREENSHOTS;
const axe = await readFile(
  new URL("../node_modules/axe-core/axe.min.js", import.meta.url),
  "utf8",
);
if (screenshots) await mkdir(screenshots, { recursive: true });

async function checkStudio(page, name) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/dashboard/admin/drift?mock=admin`);
  await page
    .getByRole("heading", { name: "Photon’s prompt sequence" })
    .waitFor();
  const studio = page.getByRole("region", {
    name: "Photon script visualization",
  });
  const frame = studio.locator(".studio-preview-canvas");
  const prompts = studio.locator(".studio-prompt-list");
  const save = studio.getByRole("button", {
    name: "Save changes",
    exact: false,
  });
  const opening = page.getByLabel("Opening message", { exact: true });
  const scene = (name) =>
    studio.getByRole("button", { name: new RegExp(`^${name}, 0:`) });
  const tab = (name) => studio.getByRole("tab", { name, exact: true });
  await page.evaluate(() => {
    const original = window.fetch;
    window.studioWrites = [];
    window.fetch = (input, init) => {
      const method =
        init?.method ?? (input instanceof Request ? input.method : "GET");
      const url = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      if (
        url.origin === location.origin &&
        !["GET", "HEAD"].includes(method.toUpperCase())
      )
        window.studioWrites.push({ url: String(input), method });
      return original(input, init);
    };
  });
  assert.equal(await prompts.locator("button").count(), 5);
  assert.equal(await studio.locator(".studio-filmstrip button").count(), 5);
  assert.equal(await save.isDisabled(), true);
  assert.equal(
    await studio
      .getByRole("button", { name: "Before", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await studio.getByText("Interactive prototype", { exact: true }).count(),
    1,
  );

  // Output selection, text feedback and the same draft across view changes.
  await frame
    .getByRole("button", { name: "Edit opening message", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.getElementById("clip-field-request") === document.activeElement,
  );
  await studio
    .getByRole("button", { name: "Shorten the message", exact: true })
    .click();
  assert.equal(await opening.inputValue(), "Plan me a sunny weekend.");
  assert.match(
    await frame
      .getByRole("button", { name: "Edit opening message" })
      .innerText(),
    /Plan me a sunny weekend\./,
  );
  assert.deepEqual(
    await prompts.locator(".is-affected strong").allTextContents(),
    ["Story", "Artwork", "Build", "Review"],
  );
  assert.equal(
    await prompts.getByText("Would refine", { exact: true }).count(),
    1,
  );
  await page.getByRole("tab", { name: "Run history", exact: true }).click();
  await page
    .getByRole("heading", { name: "Sample company", exact: true })
    .waitFor();
  await page.getByRole("button", { name: /03 Plan the conversation/ }).click();
  await page.getByText("Review passed · Attempt 2", { exact: true }).waitFor();
  await page
    .getByRole("tab", { name: "Visualize script", exact: true })
    .click();
  assert.equal(await opening.inputValue(), "Plan me a sunny weekend.");
  await page.getByLabel("Agent", { exact: true }).selectOption("autosana");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(
    await page.getByLabel("Agent", { exact: true }).inputValue(),
    "photon",
  );

  // Invalid content stays local and cannot be saved; discard returns to the baseline.
  await opening.fill("   ");
  assert.equal(await save.isDisabled(), true);
  await studio
    .getByRole("button", { name: "Discard edits", exact: true })
    .click();
  assert.equal(
    await opening.inputValue(),
    "Find me a sunny escape for this weekend.",
  );
  assert.equal(await prompts.locator(".is-affected").count(), 0);

  // Independent style edits map to Artwork and Build, without rerunning Research or Story.
  await tab("Look").click();
  await studio.getByRole("button", { name: "Sunset", exact: true }).click();
  assert.equal(await frame.locator(".palette-sunset").count(), 1);
  assert.deepEqual(
    await prompts.locator(".is-affected strong").allTextContents(),
    ["Artwork", "Build", "Review"],
  );
  await studio
    .getByRole("button", { name: "Larger text", exact: true })
    .click();
  await studio.getByRole("button", { name: "Calmer", exact: true }).click();
  assert.equal(await frame.locator(".text-large.background-soft").count(), 1);
  assert.equal(
    await prompts.getByText("Would refine", { exact: true }).count(),
    2,
  );

  // A shared clip detail carries through the rest of the storyline.
  await scene("The choice").click();
  await studio
    .getByRole("button", { name: "Try Porto instead", exact: true })
    .click();
  assert.equal(await frame.getByText("Porto", { exact: true }).count(), 1);
  await scene("The result").click();
  assert.match(await frame.innerText(), /A weekend in Porto, just for you/);
  await scene("The next step").click();
  assert.match(await frame.innerText(), /A weekend in Porto/);
  await save.click();
  await studio
    .getByRole("status")
    .filter({ hasText: "Example v2 saved in this prototype." })
    .waitFor();
  assert.equal(await save.isDisabled(), true);
  assert.equal(await studio.locator(".studio-receipt li").count(), 4);
  await studio.getByRole("button", { name: "Before", exact: true }).click();
  assert.match(await frame.innerText(), /A weekend in Lisbon/);
  assert.equal(
    await frame
      .locator(".palette-ocean.text-standard.background-vivid")
      .count(),
    1,
  );
  await studio.getByRole("button", { name: "After", exact: true }).click();
  assert.match(await frame.innerText(), /A weekend in Porto/);

  // Checklists remain honest, and both tabsets support keyboard navigation.
  await tab("Content").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await tab("Look").getAttribute("aria-selected"), "true");
  await page.keyboard.press("ArrowRight");
  assert.equal(await studio.getByText("Not run", { exact: true }).count(), 5);
  await page.keyboard.press("End");
  assert.equal(await tab("Step details").getAttribute("aria-selected"), "true");
  await prompts.getByRole("button", { name: /Research/ }).click();
  await studio.getByText("Example brief", { exact: true }).waitFor();
  assert.equal(await studio.locator("textarea:visible").count(), 0);

  // The playhead navigates the same storyboard, completes, then restarts cleanly.
  const playhead = studio.getByRole("slider", { name: "Storyboard playhead" });
  await playhead.fill("12");
  await studio
    .getByRole("heading", { name: "The choice", exact: true })
    .waitFor();
  await playhead.fill("29.75");
  await studio
    .getByRole("button", { name: "Play storyboard", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Storyboard playhead"]').value ===
      "30",
  );
  await studio
    .getByRole("button", { name: "Play storyboard", exact: true })
    .click();
  await page.waitForFunction(() => {
    const value = Number(
      document.querySelector('[aria-label="Storyboard playhead"]').value,
    );
    return value > 0 && value < 4;
  });
  await studio
    .getByRole("button", { name: "Pause storyboard", exact: true })
    .click();
  const paused = await playhead.inputValue();
  await page.waitForTimeout(350);
  assert.equal(await playhead.inputValue(), paused);

  await scene("The result").click();
  await tab("Look").click();
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
    await page.waitForTimeout(100);
    await page.screenshot({
      path: `${screenshots}/studio-${name}.png`,
      fullPage: true,
    });
    await studio
      .locator(".studio-workbench")
      .screenshot({ path: `${screenshots}/workbench-${name}.png` });
    await frame.evaluate((element) =>
      element.scrollIntoView({ block: "start" }),
    );
    await page.screenshot({
      path: `${screenshots}/preview-viewport-${name}.png`,
    });
  }

  // Reset and agent switching discard only the local example. Run history stays available.
  await studio
    .getByRole("button", { name: "Reset example", exact: true })
    .click();
  assert.equal(
    await opening.inputValue(),
    "Find me a sunny escape for this weekend.",
  );
  assert.equal(await studio.locator(".studio-receipt").count(), 0);
  await opening.fill("An unsaved local edit");
  await page.getByLabel("Agent", { exact: true }).selectOption("autosana");
  await page
    .getByRole("button", { name: "Discard and switch", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "The visual prototype starts with Photon" })
    .waitFor();
  await page
    .getByRole("button", { name: "View run history", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Agility Robotics", exact: true })
    .waitFor();
  await page.getByRole("button", { name: /Zoox quarantined/ }).click();
  await page
    .getByRole("heading", { name: "Still generation", exact: true })
    .waitFor();
  await page.getByLabel("Agent", { exact: true }).selectOption("photon");
  assert.equal(
    await opening.inputValue(),
    "Find me a sunny escape for this weekend.",
  );
  await studio
    .getByRole("button", { name: "Shorten the message", exact: true })
    .click();
  await save.click();
  assert.deepEqual(
    await page.evaluate(() => window.studioWrites),
    [],
    `${name}: prototype must never write to an application API`,
  );
  await page.reload();
  await opening.waitFor();
  assert.equal(
    await opening.inputValue(),
    "Find me a sunny escape for this weekend.",
  );
  assert.deepEqual(errors, [], `${name} browser errors`);
  console.log(
    `${name}: output edits, prompt feedback, comparison, local revisions, playback, no API writes, history, access controls, keyboard and accessibility passed`,
  );
}

const desktop = await chromium.launch();
try {
  const context = await desktop.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await checkStudio(await context.newPage(), "desktop");
  const denied = await context.newPage();
  await denied.goto(`${base}/dashboard/admin/drift?mock=member`);
  await denied.getByRole("link", { name: /Google/ }).waitFor();
  assert.equal(
    await denied
      .getByRole("heading", { name: "Photon’s prompt sequence" })
      .count(),
    0,
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
