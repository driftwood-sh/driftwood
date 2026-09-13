/* The shape of the frame a clip is painted in.

   The card was built around a 16:9 rail, and a landscape or square recording
   still belongs in one. A phone recording does not: a portrait clip in a 16:9
   frame is a narrow strip of video between two wide black bars, so most of
   the frame carries nothing. Photon's demos are all phone recordings, which
   is how this reached a customer.

   So the frame takes the shape the file reports. The ratio comes from the
   media itself — videoWidth and videoHeight on loadedmetadata — because a
   filename and a stored field both lie about what was recorded.

   The height is capped. A 9:16 clip filling the 20rem rail is 569px tall,
   which turns a card into a column and drops the next card off the screen. */

/* Tallest a clip frame gets. A 9:16 clip at this height is about 225px wide,
   so it still sits inside the rail rather than setting the rail's width. */
export const PORTRAIT_FRAME_MAX_HEIGHT = 400;

export type ClipFrame = {
  /* True when the file is taller than it is wide. The card uses it to mark
     the frame, and the QA pass reads it back. */
  portrait: boolean;
  /* CSS aspect-ratio for the frame. */
  aspectRatio: string;
  /* CSS width for the frame. A portrait frame is bounded twice: by the height
     cap, and by the rail it sits in. */
  width: string;
};

/* The frame held from first paint, before the file has reported anything: the
   same 16:9 box the card always reserved. Layout shift after first paint is a
   bug (ux-principles rule 17), so the space is there first and the real ratio
   replaces it in one step. */
export const RESERVED_CLIP_FRAME: ClipFrame = {
  portrait: false,
  aspectRatio: "16 / 9",
  width: "100%",
};

/* The frame for a clip that reports width x height pixels.

   A square clip counts as landscape: it reads correctly in a 16:9 frame, and
   moving it would change a card no one complained about. Zero, NaN and a
   width or height the element never learned all return the reserved frame,
   which is what an audio-only file or a failed load reports. */
export function clipFrame(width: number, height: number): ClipFrame {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return RESERVED_CLIP_FRAME;
  if (width <= 0 || height <= 0) return RESERVED_CLIP_FRAME;
  if (height <= width) return RESERVED_CLIP_FRAME;
  const cappedWidth = (PORTRAIT_FRAME_MAX_HEIGHT * width) / height;
  return {
    portrait: true,
    aspectRatio: `${width} / ${height}`,
    width: `min(100%, ${Math.round(cappedWidth * 100) / 100}px)`,
  };
}
