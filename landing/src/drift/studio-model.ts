/** Local demonstration of clip feedback. No generation or prompt writes. */
export type PromptId = "research" | "story" | "artwork" | "build" | "review";
export type SceneId = "opening" | "reply" | "choices" | "result" | "checkout";
export type ClipStyle = "ocean" | "sunset" | "sage";
export type Clip = {
  request: string;
  reply: string;
  destination: string;
  optionTwo: string;
  optionThree: string;
  resultTitle: string;
  resultDetail: string;
  closing: string;
  palette: ClipStyle;
  textSize: "standard" | "large";
  background: "soft" | "vivid";
};
export type ClipField = keyof Clip;
export const INITIAL_CLIP: Clip = {
  request: "Find me a sunny escape for this weekend.",
  reply: "Three great cities. All within your $500 budget.",
  destination: "Lisbon",
  optionTwo: "Barcelona",
  optionThree: "Nice",
  resultTitle: "Your weekend, sorted.",
  resultDetail: "Return flights + two nights by the water",
  closing: "Ready to book your weekend?",
  palette: "ocean",
  textSize: "standard",
  background: "vivid",
};
export const PROMPTS: {
  id: PromptId;
  name: string;
  purpose: string;
  input: string;
  output: string;
  detail: string;
  checks: string[];
}[] = [
  {
    id: "research",
    name: "Research",
    purpose: "Understand the company",
    input: "Company + customer use case",
    output: "Company brief",
    detail:
      "Find what the company offers, who it serves and which customer journey belongs in the demo.",
    checks: [
      "Correct company",
      "Claims backed by sources",
      "A relevant customer journey",
    ],
  },
  {
    id: "story",
    name: "Story",
    purpose: "Plan the conversation",
    input: "Company brief",
    output: "Timed storyboard",
    detail:
      "Turn the brief into a conversation with requests, choices, a useful result and a clear next step.",
    checks: [
      "Clear customer goal",
      "Specific, useful choices",
      "Copy fits the timing",
    ],
  },
  {
    id: "artwork",
    name: "Artwork",
    purpose: "Create the visual assets",
    input: "Brief + storyboard",
    output: "4 visual assets",
    detail:
      "Create a backdrop, phone wallpaper, avatar and result image. These are reviewed together inside the assembled demo.",
    checks: [
      "Consistent visual identity",
      "Readable foreground",
      "Images work at their final size",
    ],
  },
  {
    id: "build",
    name: "Build",
    purpose: "Assemble the clip",
    input: "Storyboard + artwork",
    output: "Interactive demo + clip",
    detail:
      "Place the messages and cards in the phone, connect their interactions, and render the shared timeline.",
    checks: [
      "Text stays in its frame",
      "Controls work",
      "Timing and transitions",
    ],
  },
  {
    id: "review",
    name: "Review",
    purpose: "Check and refine",
    input: "Clip + captured frames",
    output: "Reviewed demo",
    detail:
      "Check the finished demo against the brief and quality criteria. Feedback returns to the relevant earlier prompts.",
    checks: [
      "Branding and visual quality",
      "Full-clip pacing",
      "Story and interaction fidelity",
    ],
  },
];
export const SCENES: {
  id: SceneId;
  name: string;
  start: number;
  end: number;
  description: string;
  fields: { key: ClipField; label: string; max: number }[];
}[] = [
  {
    id: "opening",
    name: "The request",
    start: 0,
    end: 4,
    description: "A customer starts the conversation.",
    fields: [{ key: "request", label: "Opening message", max: 72 }],
  },
  {
    id: "reply",
    name: "The reply",
    start: 4,
    end: 12,
    description: "The assistant offers a useful answer.",
    fields: [{ key: "reply", label: "Assistant reply", max: 90 }],
  },
  {
    id: "choices",
    name: "The choice",
    start: 12,
    end: 17,
    description: "Three options lead to one decision.",
    fields: [
      { key: "destination", label: "Selected destination", max: 22 },
      { key: "optionTwo", label: "Second option", max: 22 },
      { key: "optionThree", label: "Third option", max: 22 },
    ],
  },
  {
    id: "result",
    name: "The result",
    start: 17,
    end: 25,
    description: "Show what the customer gets.",
    fields: [
      { key: "resultTitle", label: "Result headline", max: 48 },
      { key: "resultDetail", label: "Result description", max: 72 },
    ],
  },
  {
    id: "checkout",
    name: "The next step",
    start: 25,
    end: 30,
    description: "A clear finish to the journey.",
    fields: [{ key: "closing", label: "Closing message", max: 64 }],
  },
];
export const FIELD_LABELS: Record<ClipField, string> = {
  request: "Opening message",
  reply: "Assistant reply",
  destination: "Selected destination",
  optionTwo: "Second option",
  optionThree: "Third option",
  resultTitle: "Result headline",
  resultDetail: "Result description",
  closing: "Closing message",
  palette: "Color palette",
  textSize: "Message size",
  background: "Background detail",
};
export const FIELD_PROMPT: Record<ClipField, PromptId> = {
  request: "story",
  reply: "story",
  destination: "story",
  optionTwo: "story",
  optionThree: "story",
  resultTitle: "story",
  resultDetail: "story",
  closing: "story",
  palette: "artwork",
  background: "artwork",
  textSize: "build",
};
export type ClipChange = {
  field: ClipField;
  label: string;
  before: string;
  after: string;
  prompt: PromptId;
};
export function clipChanges(before: Clip, after: Clip): ClipChange[] {
  return (Object.keys(before) as ClipField[])
    .filter((key) => before[key] !== after[key])
    .map((key) => ({
      field: key,
      label: FIELD_LABELS[key],
      before: before[key],
      after: after[key],
      prompt: FIELD_PROMPT[key],
    }));
}
export function refinementPath(changes: ClipChange[]) {
  const direct = new Set(changes.map((change) => change.prompt));
  const earliest = Math.min(
    ...PROMPTS.map((prompt, index) =>
      direct.has(prompt.id) ? index : Infinity,
    ),
  );
  return PROMPTS.filter((_, index) => index >= earliest).map((prompt) => ({
    ...prompt,
    action: direct.has(prompt.id) ? ("refine" as const) : ("rerun" as const),
  }));
}
export function sceneAt(time: number) {
  return (
    SCENES.find((scene) => time >= scene.start && time < scene.end) ??
    (time < 0 ? SCENES[0] : SCENES[SCENES.length - 1])
  );
}
export function timeLabel(time: number) {
  return `0:${Math.floor(time).toString().padStart(2, "0")}`;
}

// Existing read-only run-history fixture. The studio itself uses no API.
export const photonPrototypeFlow = {
  task: "photon_demo",
  stages: [
    { id: "preflight", name: "Check the setup" },
    {
      id: "research",
      name: "Understand the company",
      gate: true,
      judge_prefixes: ["research-"],
    },
    {
      id: "story",
      name: "Plan the conversation",
      gate: true,
      judge_prefixes: ["story-"],
    },
    { id: "artwork", name: "Create the artwork" },
    {
      id: "demo",
      name: "Build and review",
      gate: true,
      judge_prefixes: ["demo-"],
    },
    { id: "delivery", name: "Package the demo" },
  ],
  terminals: { done: { label: "Demo completed", tone: "good" } },
};
