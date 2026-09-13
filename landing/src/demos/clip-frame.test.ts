import assert from "node:assert/strict";
import test from "node:test";
import { clipFrame, PORTRAIT_FRAME_MAX_HEIGHT, RESERVED_CLIP_FRAME } from "./clip-frame.ts";

test("a landscape or square clip keeps the 16:9 frame the card always had", () => {
  for (const [width, height] of [
    [1920, 1080],
    [1280, 720],
    [640, 640],
  ]) {
    assert.deepEqual(clipFrame(width, height), RESERVED_CLIP_FRAME);
  }
});

test("a portrait clip is framed at its own ratio, capped at 400px tall", () => {
  const phone = clipFrame(540, 960);
  assert.equal(phone.portrait, true);
  assert.equal(phone.aspectRatio, "540 / 960");
  assert.equal(phone.width, "min(100%, 225px)");
  /* 225px at 400px tall is 9:16, which is what the cap has to hold. */
  assert.equal((225 / PORTRAIT_FRAME_MAX_HEIGHT).toFixed(4), (540 / 960).toFixed(4));
});

test("a clip only a little taller than wide is still framed portrait, and the rail bounds it", () => {
  /* compare.mp4 in the fixtures. The height cap puts it at 327.58px wide,
     which is wider than the 320px rail, so min(100%, ...) is what keeps the
     frame inside the rail and the two-column layout unchanged. */
  const tall = clipFrame(968, 1182);
  assert.equal(tall.portrait, true);
  assert.equal(tall.aspectRatio, "968 / 1182");
  assert.equal(tall.width, "min(100%, 327.58px)");
});

test("a file that reports no usable size falls back to the reserved frame", () => {
  for (const [width, height] of [
    [0, 0],
    [540, 0],
    [0, 960],
    [-540, 960],
    [Number.NaN, Number.NaN],
    [540, Number.POSITIVE_INFINITY],
  ]) {
    assert.deepEqual(clipFrame(width, height), RESERVED_CLIP_FRAME);
  }
});

test("the reserved frame is the 16:9 box, so the space is there from first paint", () => {
  assert.deepEqual(RESERVED_CLIP_FRAME, { portrait: false, aspectRatio: "16 / 9", width: "100%" });
});
