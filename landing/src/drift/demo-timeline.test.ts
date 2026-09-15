import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { readEdits, sceneAtTime, type DemoTimeline } from "./demo-timeline.ts";

const demo: DemoTimeline = JSON.parse(
  readFileSync(
    new URL("../../scripts/fixtures/timeline.json", import.meta.url),
    "utf8",
  ),
);
const edit = {
  id: "note-1",
  run_id: demo.run_id,
  workflow_version: demo.workflow_version,
  video_version: demo.video_version,
  scene_id: "request",
  timestamp: 3.9,
  target: "content",
  message: "Shorten the request.",
};

test("playback selects the next scene exactly at the boundary and holds the final scene", () => {
  assert.equal(sceneAtTime(demo.scenes, 3.99)?.id, "request");
  assert.equal(sceneAtTime(demo.scenes, 4)?.id, "hold");
  assert.equal(sceneAtTime(demo.scenes, 30)?.id, "hold");
});

test("drafts belong to one viewer's exact run, video, workflow and moment", () => {
  for (const changed of [
    { run_id: "other" },
    { video_version: "new" },
    { workflow_version: "new" },
    { scene_id: "missing" },
    { timestamp: 31 },
    { target: "raw_prompt" },
    { message: " " },
  ]) {
    assert.deepEqual(
      readEdits(JSON.stringify([{ ...edit, ...changed }]), demo),
      [],
    );
  }
  assert.deepEqual(readEdits(JSON.stringify([edit]), demo), [edit]);
  assert.deepEqual(readEdits("broken", demo), []);
  assert.deepEqual(readEdits('{"message":"not a list"}', demo), []);
});
