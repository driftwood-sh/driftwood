import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clipChanges,
  INITIAL_CLIP,
  refinementPath,
  sceneAt,
} from "./studio-model.ts";

test("clip feedback identifies the original and edited output, without changing its snapshot", () => {
  const original = Object.freeze({ ...INITIAL_CLIP });
  const edits = clipChanges(original, {
    ...original,
    destination: "Porto",
    palette: "sunset",
  });
  assert.deepEqual(
    edits.map(({ field, before, after, prompt }) => ({
      field,
      before,
      after,
      prompt,
    })),
    [
      {
        field: "destination",
        before: "Lisbon",
        after: "Porto",
        prompt: "story",
      },
      { field: "palette", before: "ocean", after: "sunset", prompt: "artwork" },
    ],
  );
  assert.equal(original.destination, "Lisbon");
});

test("combined clip feedback refines direct prompts and revisits only downstream stages", () => {
  const edits = clipChanges(INITIAL_CLIP, {
    ...INITIAL_CLIP,
    reply: "A shorter reply",
    palette: "sage",
  });
  assert.deepEqual(
    refinementPath(edits).map(({ id, action }) => [id, action]),
    [
      ["story", "refine"],
      ["artwork", "refine"],
      ["build", "rerun"],
      ["review", "rerun"],
    ],
  );
  assert.deepEqual(
    refinementPath(
      clipChanges(INITIAL_CLIP, { ...INITIAL_CLIP, textSize: "large" }),
    ).map(({ id, action }) => [id, action]),
    [
      ["build", "refine"],
      ["review", "rerun"],
    ],
  );
  assert.deepEqual(
    refinementPath(clipChanges(INITIAL_CLIP, { ...INITIAL_CLIP })),
    [],
  );
});

test("storyboard boundaries advance once and the completed playhead stays on the final frame", () => {
  assert.deepEqual(
    [0, 3.75, 4, 11.75, 12, 17, 25, 30].map((time) => sceneAt(time).id),
    [
      "opening",
      "opening",
      "reply",
      "reply",
      "choices",
      "result",
      "checkout",
      "checkout",
    ],
  );
});
