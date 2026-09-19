/* case studies — scroll through them; more get added as clients come on.
   Each card runs case study → testimonial → company logo, loudest first: the
   16:9 clip is the real demo the client sent, the quote sits beside it, and
   the lockup closes the column. Clips stay unloaded (preload="none") until
   someone hits play; the poster is a frame of the demo itself. */
type CaseStudy = {
  id: string;
  company: string;
  title: string;
  sub: string;
  video: string;
  poster: string;
  // every lockup is baked as a rounded tile on its own plate (the source art's
  // plate colour, sampled, so the added room is seamless) with alpha corners —
  // drop-shadow follows that alpha and lifts it as a chip. See the bake recipe
  // in design/design-language.md; never ship a hard-cut square.
  logo: string;
  // the testimonial is optional: a case ships the moment the clip is cleared,
  // the quote lands whenever the client sends one (never invented — §6)
  quote?: string;
  author?: string;
  role?: string;
  avatar?: string;
};
export const CASE_STUDIES: CaseStudy[] = [
  {
    id: "autosana",
    company: "Autosana",
    // artifact-style title (Aayush 08-09), matching the Oruk card's register:
    // the card names what the clip shows, not an outcome stat
    title: "Agent filed bug report",
    sub: "Autosana's QA agent running a real test on the prospect's app and filing the bug it caught.",
    video: "/case-autosana.mp4",
    poster: "/case-autosana-poster.webp",
    logo: "/logo-autosana.webp",
    quote: "amazing stuff, the demos are working so well",
    author: "Yuvan Sundrani",
    role: "Founder, Autosana (YC S25)",
    avatar: "/yuvan.webp",
  },
  {
    id: "oruk",
    company: "Oruk",
    title: "Autonomously trying different growth experiments",
    sub: "Using Oruk's emotion-aware captioning on each lead's favorite TV show and sending it to them.",
    video: "/case-oruk.mp4",
    poster: "/case-oruk-poster.webp",
    logo: "/logo-oruk.webp",
    // Nathan's words as relayed by Aayush 08-09 ("what he said to my friend")
    quote: "driftwood is like a head of growth for your team",
    author: "Nathan Roll",
    // nbsp: "(Speedrun 007)" wraps as one phrase, never leaving "007)" alone
    role: "Founder & CEO, Oruk (Speedrun 007)",
    avatar: "/nathan.webp",
  },
];

