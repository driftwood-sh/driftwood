/** Run-history fixture only. The demo editor loads recorded evidence. */
export const photonMockFlow = {
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
