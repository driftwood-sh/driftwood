import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  clockLabel,
  demoChoices,
  demoTimeline,
  readEdits,
  sceneAtTime,
  type DemoChoice,
  type DemoEdit,
  type DemoScene,
  type DemoTimeline,
  type EditTarget,
} from "./demo-timeline";
import { useDemoMedia } from "./useDemoMedia";
import "./studio.css";

export default function ScriptStudio({
  onDirty,
  active,
  agentId,
  viewerId,
}: {
  onDirty: (dirty: boolean) => void;
  active: boolean;
  agentId: string;
  viewerId: string;
}) {
  const [choices, setChoices] = useState<DemoChoice[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState("");
  const handleDirty = useCallback((value: boolean) => {
    setDirty(value);
    if (!value) setPending("");
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    demoChoices(agentId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return;
        setChoices(data.demos);
        setSelected((current) =>
          data.demos.some((item) => item.run_id === current)
            ? current
            : (data.demos[0]?.run_id ?? ""),
        );
        setError(null);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Completed demos could not be loaded.");
      });
    return () => controller.abort();
  }, [agentId, revision]);
  useLayoutEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  return (
    <section className="demo-studio" aria-label="Photon demo editor">
      <header className="demo-studio-heading">
        <div>
          <h2>Your demo, step by step</h2>
          <p>
            Select a moment. See its direction and tell us what you’d change.
          </p>
        </div>
        {choices && choices.length > 0 && (
          <label className="demo-select">
            Demo
            <select
              aria-label="Demo"
              value={selected}
              onChange={(event) => {
                if (dirty) setPending(event.target.value);
                else setSelected(event.target.value);
              }}
            >
              {choices.map((item) => (
                <option key={item.run_id} value={item.run_id}>
                  {item.company_name} ·{" "}
                  {new Date(item.created_at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      {pending && (
        <div className="workflow-notice" role="alert">
          <p>
            Save this edit request as a draft before switching, or discard it.
          </p>
          <div className="workflow-save-actions">
            <button className="workflow-button" onClick={() => setPending("")}>
              Keep editing
            </button>
            <button
              className="workflow-button"
              onClick={() => {
                setDirty(false);
                setSelected(pending);
                setPending("");
              }}
            >
              Discard and switch demo
            </button>
          </div>
        </div>
      )}
      {error ? (
        <div className="workflow-empty" role="alert">
          <p>{error}</p>
          <button
            className="workflow-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Try again
          </button>
        </div>
      ) : choices?.length === 0 ? (
        <div className="workflow-empty">
          <h3>No completed demos yet</h3>
          <p>
            A completed Photon demo is needed to open its video and recorded
            story here.
          </p>
          <button
            className="workflow-button"
            onClick={() => setRevision((value) => value + 1)}
          >
            Refresh demos
          </button>
        </div>
      ) : selected ? (
        <LoadDemo
          key={selected}
          id={selected}
          agentId={agentId}
          viewerId={viewerId}
          active={active}
          onDirty={handleDirty}
        />
      ) : (
        <EditorSkeleton />
      )}
    </section>
  );
}

function LoadDemo({
  id,
  agentId,
  viewerId,
  active,
  onDirty,
}: {
  id: string;
  agentId: string;
  viewerId: string;
  active: boolean;
  onDirty: (value: boolean) => void;
}) {
  const [demo, setDemo] = useState<DemoTimeline | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    demoTimeline(agentId, id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) {
          setDemo(data);
          setError(false);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [agentId, id, attempt]);
  if (error)
    return (
      <div className="workflow-empty" role="alert">
        <h3>This demo’s recorded story could not be loaded</h3>
        <p>Choose another demo, or try again.</p>
        <button
          className="workflow-button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Try again
        </button>
      </div>
    );
  return demo ? (
    <RecordedDemo
      key={`${demo.video_version}:${attempt}`}
      demo={demo}
      active={active}
      storageKey={`drift-demo-edits:v1:${viewerId}:${agentId}:${id}:${demo.video_version}`}
      onDirty={onDirty}
      retry={() => setAttempt((value) => value + 1)}
    />
  ) : (
    <EditorSkeleton />
  );
}

function RecordedDemo({
  demo,
  active,
  storageKey,
  onDirty,
  retry,
}: {
  demo: DemoTimeline;
  active: boolean;
  storageKey: string;
  onDirty: (value: boolean) => void;
  retry: () => void;
}) {
  const media = useDemoMedia(demo);
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const feedbackRef = useRef<HTMLTextAreaElement>(null);
  const [sceneId, setSceneId] = useState(demo.scenes[0].id);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [target, setTarget] = useState<EditTarget>("content");
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<DemoEdit[]>(() => {
    try {
      return readEdits(sessionStorage.getItem(storageKey), demo);
    } catch {
      return [];
    }
  });
  const [notice, setNotice] = useState("");
  const [saveError, setSaveError] = useState("");
  const scene = demo.scenes.find((item) => item.id === sceneId)!;
  const sceneDrafts = drafts.filter((item) => item.scene_id === scene.id);
  const dirty = message.trim().length > 0;
  useLayoutEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  useEffect(() => {
    if (!active) videoRef.current?.pause();
    const pause = () => {
      if (document.hidden) videoRef.current?.pause();
    };
    document.addEventListener("visibilitychange", pause);
    return () => document.removeEventListener("visibilitychange", pause);
  }, [active]);
  function selectScene(next: DemoScene) {
    if (dirty && next.id !== sceneId) {
      setNotice(
        "Save or discard this edit request before selecting another moment.",
      );
      feedbackRef.current?.focus();
      return;
    }
    videoRef.current?.pause();
    setSceneId(next.id);
    setNotice("");
    setTime(next.preview_time);
    if (videoRef.current) videoRef.current.currentTime = next.preview_time;
    if (window.matchMedia("(max-width: 800px)").matches)
      previewRef.current?.scrollIntoView({ block: "start" });
  }
  function save() {
    if (!dirty) return;
    const next: DemoEdit = {
      id: crypto.randomUUID(),
      run_id: demo.run_id,
      video_version: demo.video_version,
      workflow_version: demo.workflow_version,
      scene_id: scene.id,
      timestamp: time,
      target,
      message: message.trim(),
    };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify([...drafts, next]));
      setDrafts((current) => [...current, next]);
      setMessage("");
      setSaveError("");
      setNotice("Draft saved for this tab. The video has not changed.");
    } catch {
      setSaveError(
        "Your browser could not save this draft. Your text is still here.",
      );
    }
  }
  function removeDraft(id: string) {
    const next = drafts.filter((item) => item.id !== id);
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(next));
      setDrafts(next);
      setNotice("Draft removed.");
    } catch {
      setSaveError("This draft could not be removed. Try again.");
    }
  }
  const canPlay = Boolean(media.source) && !dirty;
  return (
    <>
      <section className="recorded-timeline" aria-label="Demo timeline">
        <header>
          <h3>The full demo</h3>
          <span>
            {demo.scenes.length} moments · {drafts.length} draft{" "}
            {drafts.length === 1 ? "edit" : "edits"}
          </span>
        </header>
        <ol>
          {demo.scenes.map((item, index) => (
            <li key={item.id}>
              <button
                aria-label={`${item.label}, ${clockLabel(item.start)} to ${clockLabel(item.end)}`}
                aria-pressed={scene.id === item.id}
                onClick={() => selectScene(item)}
              >
                <div className="recorded-thumbnail">
                  {media.frames[item.id] ? (
                    <img src={media.frames[item.id]} alt="" />
                  ) : (
                    <span className="recorded-thumbnail-placeholder" />
                  )}
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {drafts.some((edit) => edit.scene_id === item.id) && (
                    <i aria-label="Has draft edits" />
                  )}
                </div>
                <strong>{item.label}</strong>
                <small>
                  {clockLabel(item.start)}–{clockLabel(item.end)}
                </small>
              </button>
            </li>
          ))}
        </ol>
        <p>
          {media.frameError
            ? "Some frame previews could not be read. You can still select a moment to watch it."
            : "Frames from this video. Scene timing and wording come from its saved story."}
        </p>
      </section>
      <div className="recorded-demo-layout">
        <section
          className="recorded-preview"
          ref={previewRef}
          aria-label="Recorded demo video"
        >
          <div className="recorded-title">
            <div>
              <span>Photon demo</span>
              <h3>{demo.title || demo.company_name}</h3>
            </div>
            <span>{clockLabel(demo.duration)}</span>
          </div>
          <div className="recorded-video-canvas">
            {media.error ? (
              <div className="recorded-media-status" role="alert">
                <p>{media.error}</p>
                <button className="workflow-button" onClick={retry}>
                  Reload video
                </button>
              </div>
            ) : !media.source ? (
              <div className="recorded-media-status" role="status">
                <div className="recorded-phone-skeleton" />
                <span>Loading the recorded video…</span>
              </div>
            ) : (
              <video
                ref={videoRef}
                src={media.source}
                playsInline
                muted
                preload="auto"
                aria-label={`Recorded demo for ${demo.company_name}`}
                onLoadedMetadata={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = scene.preview_time;
                    setTime(scene.preview_time);
                  }
                }}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
                onTimeUpdate={(event) => {
                  const at = event.currentTarget.currentTime;
                  setTime(at);
                  if (!event.currentTarget.paused && !dirty)
                    setSceneId(sceneAtTime(demo.scenes, at)!.id);
                }}
                onError={() =>
                  setNotice("Playback is unavailable. Try reloading the video.")
                }
              />
            )}
          </div>
          <div className="recorded-playback">
            <button
              className="workflow-button recorded-play"
              aria-label={playing ? "Pause demo" : "Play demo"}
              disabled={!canPlay}
              title={
                !media.source
                  ? "Available when the video loads."
                  : dirty
                    ? "Save or discard this edit request before playing."
                    : undefined
              }
              onClick={() => {
                const video = videoRef.current;
                if (!video) return;
                if (video.paused) {
                  if (video.currentTime >= demo.duration - 0.05)
                    video.currentTime = 0;
                  void video
                    .play()
                    .catch(() =>
                      setNotice("Playback could not start. Try again."),
                    );
                } else video.pause();
              }}
            >
              {playing ? "Ⅱ" : "▶"}
            </button>
            <input
              type="range"
              min="0"
              max={demo.duration}
              step="0.05"
              value={time}
              aria-label="Demo playhead"
              aria-valuetext={`${clockLabel(time)} of ${clockLabel(demo.duration)}`}
              disabled={!canPlay}
              title={
                !canPlay
                  ? dirty
                    ? "Save or discard your edit request before moving to another moment."
                    : "Available when the video loads."
                  : undefined
              }
              onChange={(event) => {
                const at = Number(event.target.value);
                videoRef.current?.pause();
                if (videoRef.current) videoRef.current.currentTime = at;
                setTime(at);
                setSceneId(sceneAtTime(demo.scenes, at)!.id);
              }}
            />
            <span>
              {clockLabel(time)} <span>/ {clockLabel(demo.duration)}</span>
            </span>
          </div>
        </section>
        <aside className="recorded-inspector" aria-label="Selected moment">
          <header>
            <span>
              {clockLabel(scene.start)}–{clockLabel(scene.end)}
            </span>
            <h3>{scene.label}</h3>
          </header>
          <div className="recorded-direction">
            <span>Scene direction</span>
            <p>{scene.direction}</p>
          </div>
          <div className="recorded-output">
            <h4>In this demo</h4>
            {scene.content.length ? (
              scene.content.map((item) => (
                <div key={item.field}>
                  <span>{item.label}</span>
                  <p>{item.text}</p>
                </div>
              ))
            ) : (
              <p className="recorded-visual-output">
                {scene.id === "heart"
                  ? "The customer reacts to the result."
                  : scene.id === "hold"
                    ? "The final state stays on screen."
                    : "Watch this moment to see the visual result."}
              </p>
            )}
          </div>
          <div className="recorded-feedback">
            <label htmlFor="demo-change-request">What would you change?</label>
            <div
              className="recorded-targets"
              role="group"
              aria-label="Edit focus"
            >
              {(
                [
                  ["content", "Wording"],
                  ["visuals", "Visuals"],
                  ["timing", "Pacing"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={target === value}
                  onClick={() => {
                    videoRef.current?.pause();
                    setTarget(value);
                    feedbackRef.current?.focus();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <textarea
              id="demo-change-request"
              ref={feedbackRef}
              rows={3}
              maxLength={1500}
              value={message}
              placeholder={
                target === "content"
                  ? "e.g. Make this reply shorter and more direct."
                  : target === "visuals"
                    ? "e.g. Make the background quieter."
                    : "e.g. Give these choices more time on screen."
              }
              onFocus={() => videoRef.current?.pause()}
              onChange={(event) => {
                setMessage(event.target.value);
                setNotice("");
                setSaveError("");
              }}
            />
            <div className="recorded-feedback-actions">
              <button
                className="workflow-button is-primary"
                disabled={!dirty}
                title={
                  !dirty ? "Describe a change to this moment first." : undefined
                }
                onClick={save}
              >
                Save draft edit
              </button>
              {dirty && (
                <button
                  className="workflow-button is-quiet"
                  onClick={() => {
                    setMessage("");
                    setNotice("");
                  }}
                >
                  Discard
                </button>
              )}
            </div>
            <p className="recorded-draft-hint">
              Draft edits stay in this tab. Generating a revised video isn’t
              connected yet.
            </p>
            {notice && (
              <p role="status" className="recorded-notice">
                {notice}
              </p>
            )}
            {saveError && (
              <p role="alert" className="recorded-notice">
                {saveError}
              </p>
            )}
          </div>
          {sceneDrafts.length > 0 && (
            <div className="recorded-drafts">
              <h4>
                {sceneDrafts.length} draft{" "}
                {sceneDrafts.length === 1 ? "edit" : "edits"} for this moment
              </h4>
              {sceneDrafts.map((edit) => (
                <div key={edit.id}>
                  <span>
                    {edit.target === "content"
                      ? "Wording"
                      : edit.target === "visuals"
                        ? "Visuals"
                        : "Pacing"}{" "}
                    · {clockLabel(edit.timestamp)}
                  </span>
                  <p>{edit.message}</p>
                  <button
                    onClick={() => removeDraft(edit.id)}
                    aria-label={`Remove draft: ${edit.message}`}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function EditorSkeleton() {
  return (
    <div
      className="recorded-skeleton"
      role="status"
      aria-label="Loading recorded demo"
    >
      <div />
      <div />
      <span>Loading the demo and its recorded story…</span>
    </div>
  );
}
