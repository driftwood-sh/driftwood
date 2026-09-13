/* Fixture generated from the reviewed Photon workflow projection. */
import type { WorkflowPlan } from "./api";

export const photonPlan: WorkflowPlan = {
  task: "photon_demo",
  title: "Photon messaging demo",
  description: "Turn a company into a short, personalized product story.",
  version: "00075ef50dd1187119fe6f3d621057c832b3e267fc2c505a1b265a3cfeabc8c1",
  editable: true,
  unavailable_reason: null,
  output: {
    format: "Portrait video + interactive preview",
    duration: "30 seconds",
    dimensions: "720 x 1422",
  },
  stages: [
    {
      id: "preflight",
      name: "Check the setup",
      description:
        "Check the company input and that the demo renderer is ready.",
      output: "A ready workspace for this demo",
      gate: true,
    },
    {
      id: "research",
      name: "Understand the company",
      description:
        "Find the product, customer journeys and visual identity using official sources.",
      output: "A researched company brief and brand references",
      gate: true,
    },
    {
      id: "story",
      name: "Plan the conversation",
      description:
        "Turn one customer journey into a timed chat, choices, result and checkout.",
      output: "A 30-second conversation with a clear customer goal",
      gate: true,
    },
    {
      id: "artwork",
      name: "Create the artwork",
      description:
        "Prepare the backdrop, phone wallpaper, contact avatar and result illustration. These are reviewed together in the finished demo.",
      output: "Four coordinated visual assets",
      gate: false,
    },
    {
      id: "demo",
      name: "Build and review",
      description:
        "Build the interactive demo, export the video and review the finished result. Failed work returns for a bounded correction.",
      output: "A reviewed demo video and interactive preview",
      gate: true,
    },
    {
      id: "delivery",
      name: "Package the demo",
      description:
        "Save the finished video, preview and review record for the workspace.",
      output: "A completed demo package",
      gate: false,
    },
  ],
  fields: [
    {
      id: "research.direction",
      stage_id: "research",
      label: "Research focus",
      placeholder: "Emphasize a customer segment, use case or product area.",
      value: "",
      max_length: 4000,
    },
    {
      id: "story.direction",
      stage_id: "story",
      label: "Story direction",
      placeholder:
        "Describe the journey, tone or result you want to emphasize.",
      value: "",
      max_length: 4000,
    },
    {
      id: "artwork.backdrop",
      stage_id: "artwork",
      label: "Backdrop",
      placeholder: "Describe the mood and visual treatment around the phone.",
      value: "",
      max_length: 4000,
    },
    {
      id: "artwork.wallpaper",
      stage_id: "artwork",
      label: "Phone wallpaper",
      placeholder:
        "Describe a subtle background that keeps the conversation readable.",
      value: "",
      max_length: 4000,
    },
    {
      id: "artwork.avatar",
      stage_id: "artwork",
      label: "Contact avatar",
      placeholder: "Describe the recognizable image in the contact circle.",
      value: "",
      max_length: 4000,
    },
    {
      id: "artwork.widget",
      stage_id: "artwork",
      label: "Result illustration",
      placeholder: "Describe the image that supports the result card.",
      value: "",
      max_length: 4000,
    },
    {
      id: "demo.direction",
      stage_id: "demo",
      label: "Presentation direction",
      placeholder:
        "Describe the visual emphasis or finishing details you want.",
      value: "",
      max_length: 4000,
    },
  ],
};
