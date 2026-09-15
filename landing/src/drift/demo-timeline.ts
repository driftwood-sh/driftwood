export type DemoChoice = {
  run_id: string;
  company_name: string;
  created_at: string;
};
export type DemoScene = {
  id: string;
  label: string;
  direction: string;
  start: number;
  end: number;
  preview_time: number;
  content: { field: string; label: string; text: string }[];
  bindings: { content: string[]; visuals: string[]; timing: string };
};
export type DemoTimeline = {
  run_id: string;
  company_name: string;
  title: string;
  goal: string;
  workflow_version: string;
  video_version: string;
  duration: number;
  width: number;
  height: number;
  video_url: string;
  scenes: DemoScene[];
};
export type EditTarget = "content" | "visuals" | "timing";
export type DemoEdit = {
  id: string;
  run_id: string;
  workflow_version: string;
  video_version: string;
  scene_id: string;
  timestamp: number;
  target: EditTarget;
  message: string;
};
export function sceneAtTime(scenes: DemoScene[], time: number) {
  return (
    scenes.find((scene) => time >= scene.start && time < scene.end) ??
    (time <= 0 ? scenes[0] : scenes.at(-1))
  );
}
export function clockLabel(time: number) {
  return `${Math.floor(time / 60)}:${Math.floor(time % 60)
    .toString()
    .padStart(2, "0")}`;
}
export function readEdits(raw: string | null, demo: DemoTimeline): DemoEdit[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (edit): edit is DemoEdit =>
        edit &&
        typeof edit.id === "string" &&
        edit.run_id === demo.run_id &&
        edit.video_version === demo.video_version &&
        edit.workflow_version === demo.workflow_version &&
        demo.scenes.some((scene) => scene.id === edit.scene_id) &&
        ["content", "visuals", "timing"].includes(edit.target) &&
        typeof edit.message === "string" &&
        edit.message.trim().length > 0 &&
        edit.message.length <= 1500 &&
        typeof edit.timestamp === "number" &&
        Number.isFinite(edit.timestamp) &&
        edit.timestamp >= 0 &&
        edit.timestamp <= demo.duration,
    );
  } catch {
    return [];
  }
}
async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    signal,
  });
  if (!res.ok)
    throw new Error(
      "This demo could not be loaded. Try again or choose another demo.",
    );
  return res.json();
}
export const demoChoices = (agent: string, signal: AbortSignal) =>
  read<{ demos: DemoChoice[] }>(
    `/api/v1/admin/drift/agents/${encodeURIComponent(agent)}/demos`,
    signal,
  );
export const demoTimeline = (agent: string, id: string, signal: AbortSignal) =>
  read<DemoTimeline>(
    `/api/v1/admin/drift/agents/${encodeURIComponent(agent)}/demos/${encodeURIComponent(id)}`,
    signal,
  );
