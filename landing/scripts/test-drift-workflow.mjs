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

async function checkEditor(page, name) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/dashboard/admin/drift?mock=admin`);
  await page.getByRole("heading", { name: "Photon messaging demo" }).waitFor();
  const plan = page.getByRole("region", { name: "Workflow plan" });
  assert.equal(await plan.locator(".workflow-step").count(), 6);
  assert.equal(
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .isDisabled(),
    true,
  );
  await page.evaluate(() => {
    const original = window.fetch;
    window.workflowRequests = [];
    window.holdWorkflowSave = false;
    window.failWorkflowSave = false;
    window.conflictWorkflowSave = false;
    window.fetch = async (url, init) => {
      if (String(url).includes("/plans/") && init?.method === "PUT") {
        window.workflowRequests.push(JSON.parse(init.body));
        if (window.holdWorkflowSave)
          await new Promise((resolve) => {
            window.releaseWorkflowSave = resolve;
          });
        if (window.failWorkflowSave)
          return Response.json(
            {
              error: {
                code: "unavailable",
                detail: "Save unavailable. Your draft is still here.",
              },
            },
            { status: 503 },
          );
        if (window.conflictWorkflowSave) {
          window.conflictWorkflowSave = false;
          await original(url, {
            ...init,
            body: JSON.stringify({
              version: JSON.parse(init.body).version,
              changes: { "story.direction": "Another admin’s direction" },
            }),
          });
          return Response.json(
            {
              error: {
                code: "workflow_changed",
                detail:
                  "This workflow changed. Reload it before saving your changes.",
              },
            },
            { status: 409 },
          );
        }
      }
      return original(url, init);
    };
  });

  const storyStep = page.getByRole("button", {
    name: /03 Plan the conversation/,
  });
  const artworkStep = page.getByRole("button", {
    name: /04 Create the artwork/,
  });
  const save = page.getByRole("button", { name: "Save changes", exact: true });
  await storyStep.click();
  await page
    .getByLabel("Story direction", { exact: true })
    .fill("Show a customer booking a weekend getaway.");
  await artworkStep.click();
  await page
    .getByLabel("Backdrop", { exact: true })
    .fill("Soft blue with natural light.");
  await page.getByRole("tab", { name: "Run history", exact: true }).click();
  await page
    .getByRole("heading", { name: "Sample company", exact: true })
    .waitFor();
  await page.getByRole("button", { name: /03 Plan the conversation/ }).click();
  await page.getByText("Review passed · Attempt 2", { exact: true }).waitFor();
  assert.equal(
    await page.getByText("Passed after correction", { exact: true }).count(),
    1,
  );
  await page.getByRole("tab", { name: "Workflow plan", exact: true }).click();
  await storyStep.click();
  assert.equal(
    await page.getByLabel("Story direction", { exact: true }).inputValue(),
    "Show a customer booking a weekend getaway.",
  );
  await page.getByLabel("Agent", { exact: true }).selectOption("autosana");
  await page.getByRole("button", { name: "Keep editing" }).click();
  assert.equal(
    await page.getByLabel("Agent", { exact: true }).inputValue(),
    "photon",
  );

  await page.getByLabel("Agent", { exact: true }).selectOption("autosana");
  await page.getByRole("button", { name: "Discard and switch" }).waitFor();
  await page.evaluate(() => {
    window.holdWorkflowSave = true;
  });
  await save.evaluate((button) => {
    button.click();
    button.click();
  });
  await page.getByRole("button", { name: "Saving…", exact: true }).waitFor();
  await page.waitForFunction(
    () => typeof window.releaseWorkflowSave === "function",
  );
  assert.equal(
    await page.getByLabel("Agent", { exact: true }).isDisabled(),
    true,
  );
  assert.equal(
    await page.getByLabel("Story direction", { exact: true }).isDisabled(),
    true,
  );
  assert.equal(await page.evaluate(() => window.workflowRequests.length), 1);
  await page.evaluate(() => {
    window.holdWorkflowSave = false;
    window.releaseWorkflowSave();
  });
  await page
    .getByRole("status")
    .filter({ hasText: "Changes saved for future demos." })
    .waitFor();
  const request = await page.evaluate(() => window.workflowRequests[0]);
  assert.equal(
    await page.getByRole("button", { name: "Discard and switch" }).count(),
    0,
  );
  assert.deepEqual(Object.keys(request).sort(), ["changes", "version"]);
  assert.match(request.version, /^[a-f0-9]{64}$/);
  assert.deepEqual(request.changes, {
    "story.direction": "Show a customer booking a weekend getaway.",
    "artwork.backdrop": "Soft blue with natural light.",
  });

  await page
    .getByLabel("Story direction", { exact: true })
    .fill("Keep this through a failed save.");
  await page.evaluate(() => {
    window.failWorkflowSave = true;
  });
  await save.click();
  await page
    .getByRole("alert")
    .filter({ hasText: "Save unavailable." })
    .waitFor();
  assert.equal(
    await page.getByLabel("Story direction", { exact: true }).inputValue(),
    "Keep this through a failed save.",
  );
  await page.evaluate(() => {
    window.failWorkflowSave = false;
  });
  await save.click();
  await page
    .getByRole("status")
    .filter({ hasText: "Changes saved for future demos." })
    .waitFor();
  assert.notEqual(
    (await page.evaluate(() => window.workflowRequests.at(-1))).version,
    request.version,
  );

  await page
    .getByLabel("Story direction", { exact: true })
    .fill("A stale draft");
  await page.evaluate(() => {
    window.conflictWorkflowSave = true;
  });
  await save.click();
  await page.getByRole("button", { name: "Reload latest plan" }).click();
  await page.getByRole("button", { name: "Keep draft", exact: true }).click();
  assert.equal(
    await page.getByLabel("Story direction", { exact: true }).inputValue(),
    "A stale draft",
  );
  await page.getByRole("button", { name: "Reload latest plan" }).click();
  await page.getByRole("button", { name: "Discard draft and reload" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Latest workflow loaded." })
    .waitFor();
  assert.equal(
    await page.getByLabel("Story direction", { exact: true }).inputValue(),
    "Another admin’s direction",
  );
  assert.equal(await save.isDisabled(), true);

  await page
    .getByLabel("Story direction", { exact: true })
    .fill("A temporary draft");
  await page
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  assert.equal(
    await page.getByLabel("Story direction", { exact: true }).inputValue(),
    "Another admin’s direction",
  );
  await page
    .getByLabel("Story direction", { exact: true })
    .fill("Discard on switch");
  await page.getByLabel("Agent", { exact: true }).selectOption("autosana");
  await page.getByRole("button", { name: "Discard and switch" }).click();
  await page.getByRole("heading", { name: "No editable plan yet" }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("agent"), "autosana");
  await page.getByRole("button", { name: "View run history" }).click();
  await page
    .getByRole("heading", { name: "Agility Robotics", exact: true })
    .waitFor();
  await page.getByRole("button", { name: /Zoox quarantined/ }).click();
  await page
    .getByRole("heading", { name: "Still generation", exact: true })
    .waitFor();
  assert.equal(
    await page.getByText("Needs attention", { exact: true }).count(),
    1,
  );
  if (screenshots)
    await page.screenshot({
      path: `${screenshots}/runs-${name}.png`,
      fullPage: true,
    });

  await page.getByLabel("Agent", { exact: true }).selectOption("photon");
  await page.getByRole("heading", { name: "Photon messaging demo" }).waitFor();
  await storyStep.click();
  assert.equal(
    await page.getByLabel("Story direction", { exact: true }).inputValue(),
    "Another admin’s direction",
  );
  const planTab = page.getByRole("tab", { name: "Workflow plan", exact: true });
  await planTab.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page
      .getByRole("tab", { name: "Run history", exact: true })
      .getAttribute("aria-selected"),
    "true",
  );
  await page.keyboard.press("Home");
  assert.equal(await planTab.getAttribute("aria-selected"), "true");
  await page
    .getByLabel("Story direction", { exact: true })
    .fill(
      "Show a customer booking a weekend getaway. Keep the choices clear and the tone warm.",
    );
  await save.click();
  await page
    .getByRole("status")
    .filter({ hasText: "Changes saved for future demos." })
    .waitFor();
  await page.evaluate(axe);
  const violations = await page.evaluate(async () =>
    (
      await window.axe.run(document, {
        runOnly: ["wcag2a", "wcag2aa", "wcag21aa"],
      })
    ).violations.map((item) => ({
      id: item.id,
      nodes: item.nodes.map((node) => node.target),
    })),
  );
  assert.deepEqual(violations, [], `${name} accessibility`);
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
    true,
    `${name} horizontal overflow`,
  );
  if (screenshots) {
    await page.screenshot({
      path: `${screenshots}/plan-${name}.png`,
      fullPage: true,
    });
    if (page.viewportSize().width < 820)
      await plan
        .locator(".workflow-inspector")
        .screenshot({ path: `${screenshots}/details-${name}.png` });
  }
  assert.deepEqual(errors, [], `${name} browser errors`);
  console.log(
    `${name}: edit, save, draft recovery, conflict, agent scope, history, keyboard, accessibility passed`,
  );
}

const desktop = await chromium.launch();
try {
  const context = await desktop.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await checkEditor(await context.newPage(), "desktop");
  const denied = await context.newPage();
  await denied.goto(`${base}/dashboard/admin/drift?mock=member`);
  await denied.getByRole("link", { name: /Google/ }).waitFor();
  assert.equal(
    await denied
      .getByRole("heading", { name: "Photon messaging demo" })
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
  await checkEditor(await context.newPage(), "iphone");
} finally {
  await mobile.close();
}
