import { useEffect, useState } from "react";
import type { DemoTimeline } from "./demo-timeline";

function waitFor(video: HTMLVideoElement, event: string, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener("error", fail);
      signal.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    };
    const done = () => finish();
    const fail = () =>
      finish(new Error("This browser could not read the video frames."));
    const aborted = () => finish(new DOMException("Aborted", "AbortError"));
    const timer = window.setTimeout(fail, 10000);
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", fail, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

/** Download through the existing authenticated route, then decode local frames.
 * Customer media is never copied into public frontend assets. */
export function useDemoMedia(demo: DemoTimeline) {
  const [media, setMedia] = useState<{
    source: string;
    frames: Record<string, string>;
    error: string | null;
    frameError: boolean;
  }>({ source: "", frames: {}, error: null, frameError: false });
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    async function load() {
      try {
        const res = await fetch(demo.video_url, {
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!res.ok || !res.headers.get("content-type")?.startsWith("video/"))
          throw new Error("The video could not be loaded. Try again.");
        const blob = await res.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        const ready = waitFor(video, "loadeddata", controller.signal);
        video.src = objectUrl;
        video.load();
        await ready;
        if (
          !Number.isFinite(video.duration) ||
          Math.abs(video.duration - demo.duration) > 0.2
        )
          throw new Error(
            "This video does not match its recorded timeline. Choose another demo.",
          );
        setMedia({
          source: objectUrl,
          frames: {},
          error: null,
          frameError: false,
        });
        const canvas = document.createElement("canvas");
        canvas.width = 120;
        canvas.height = Math.round(
          (120 * video.videoHeight) / video.videoWidth,
        );
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Frame previews are unavailable.");
        try {
          for (const scene of demo.scenes) {
            if (controller.signal.aborted) return;
            const seek = waitFor(video, "seeked", controller.signal);
            video.currentTime = Math.min(
              video.duration - 0.04,
              scene.preview_time,
            );
            await seek;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const frame = canvas.toDataURL("image/webp", 0.75);
            setMedia((current) => ({
              ...current,
              frames: { ...current.frames, [scene.id]: frame },
            }));
          }
        } catch {
          if (!controller.signal.aborted)
            setMedia((current) => ({ ...current, frameError: true }));
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setMedia({
            source: "",
            frames: {},
            error:
              error instanceof Error
                ? error.message
                : "The video could not be loaded.",
            frameError: false,
          });
      }
    }
    void load();
    return () => {
      controller.abort();
      video.pause();
      video.removeAttribute("src");
      video.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [demo]);
  return media;
}
