import { useEffect, useLayoutEffect, useRef, useState } from "react";
import ScenePhone from "./ScenePhone";
import {
  clipChanges,
  FIELD_LABELS,
  FIELD_PROMPT,
  INITIAL_CLIP,
  PROMPTS,
  refinementPath,
  SCENES,
  sceneAt,
  timeLabel,
  type Clip,
  type ClipChange,
  type ClipField,
  type PromptId,
} from "./studio-model";
import "./studio.css";

type EditorTab = "content" | "look" | "checks" | "step";

export default function ScriptStudio({
  onDirty,
  active,
}: {
  onDirty: (dirty: boolean) => void;
  active: boolean;
}) {
  const [clip, setClip] = useState<Clip>({ ...INITIAL_CLIP });
  const [saved, setSaved] = useState<Clip>({ ...INITIAL_CLIP });
  const [previous, setPrevious] = useState<Clip>({ ...INITIAL_CLIP });
  const [receipt, setReceipt] = useState<ClipChange[]>([]);
  const [revision, setRevision] = useState(1);
  const [time, setTime] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [before, setBefore] = useState(false);
  const [promptId, setPromptId] = useState<PromptId>("story");
  const [editorTab, setEditorTab] = useState<EditorTab>("content");
  const [selectedField, setSelectedField] = useState<ClipField>("request");
  const editorRef = useRef<HTMLElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const scene = sceneAt(time);
  const prompt = PROMPTS.find((item) => item.id === promptId)!;
  const changes = clipChanges(saved, clip);
  const dirty = changes.length > 0;
  const invalid = SCENES.flatMap((item) => item.fields).some(
    (field) => !clip[field.key].trim(),
  );
  const displayedChanges = dirty ? changes : receipt;
  const path = refinementPath(displayedChanges);
  const visibleClip = before ? (dirty ? saved : previous) : clip;
  const isPlaying = playing && time < 30;

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
    if (!isPlaying || !active) return;
    const timer = setInterval(
      () => setTime((current) => Math.min(30, current + 0.25)),
      250,
    );
    const pause = () => {
      if (document.hidden) setPlaying(false);
    };
    document.addEventListener("visibilitychange", pause);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", pause);
    };
  }, [isPlaying, active]);

  function update<K extends ClipField>(field: K, value: Clip[K]) {
    setClip((current) => ({ ...current, [field]: value }));
    setBefore(false);
    setPlaying(false);
    setPromptId(FIELD_PROMPT[field]);
  }
  function selectScene(id: string) {
    const selected = SCENES.find((item) => item.id === id)!;
    setTime(selected.start);
    setPlaying(false);
    setBefore(false);
    setSelectedField(selected.fields[0].key);
    setEditorTab("content");
    setPromptId("story");
    if (window.matchMedia("(max-width: 900px)").matches)
      requestAnimationFrame(() =>
        previewRef.current?.scrollIntoView({ block: "start" }),
      );
  }
  function selectTarget(field: ClipField) {
    const owner = SCENES.find((item) =>
      item.fields.some((value) => value.key === field),
    );
    if (owner && owner.id !== scene.id) setTime(owner.start);
    setSelectedField(field);
    setEditorTab("content");
    setBefore(false);
    setPlaying(false);
    setPromptId(FIELD_PROMPT[field]);
    requestAnimationFrame(() => {
      const input = document.getElementById(`clip-field-${field}`);
      input?.focus({ preventScroll: true });
      if (window.matchMedia("(max-width: 900px)").matches)
        editorRef.current?.scrollIntoView({ block: "start" });
    });
  }
  function selectPrompt(id: PromptId) {
    setPromptId(id);
    setPlaying(false);
    setEditorTab(
      id === "artwork" || id === "build"
        ? "look"
        : id === "review"
          ? "checks"
          : id === "research"
            ? "step"
            : "content",
    );
  }
  function save() {
    if (!dirty || invalid) return;
    setPrevious({ ...saved });
    setSaved({ ...clip });
    setReceipt(changes);
    setRevision((value) => value + 1);
    setBefore(false);
    setPlaying(false);
  }
  function reset() {
    setClip({ ...INITIAL_CLIP });
    setSaved({ ...INITIAL_CLIP });
    setPrevious({ ...INITIAL_CLIP });
    setReceipt([]);
    setRevision(1);
    setBefore(false);
    setPlaying(false);
    setTime(1);
    setSelectedField("request");
    setPromptId("story");
    setEditorTab("content");
  }
  return (
    <section className="script-studio" aria-label="Photon script visualization">
      <div className="studio-prototype">
        <span className="studio-prototype-label">Interactive prototype</span>
        <p>
          Sample frames and local edits. Prompt refinement and clip generation
          will connect through the MCP.
        </p>
        <button className="workflow-button is-quiet" onClick={reset}>
          Reset example
        </button>
      </div>
      <section className="studio-chain" aria-label="Prompt sequence">
        <div className="studio-section-heading">
          <div>
            <h2>Photon’s prompt sequence</h2>
            <span>Each output becomes the next step’s input.</span>
            <span className="studio-mobile-hint">
              Swipe across all 5 steps →
            </span>
          </div>
          <span className="studio-subtle">5 prompt stages</span>
        </div>
        <ol className="studio-prompt-list">
          {PROMPTS.map((item, index) => {
            const affected = path.find((step) => step.id === item.id);
            return (
              <li key={item.id}>
                <button
                  className={`studio-prompt ${promptId === item.id ? "is-selected" : ""} ${affected ? "is-affected" : ""}`}
                  aria-pressed={promptId === item.id}
                  onClick={() => selectPrompt(item.id)}
                >
                  <span className="studio-prompt-top">
                    <span>
                      {String(index + 1).padStart(2, "0")} /{" "}
                      {item.id === "artwork" || item.id === "review"
                        ? "Prompts"
                        : "Prompt"}
                    </span>
                    {affected && (
                      <span
                        className="studio-impact-dot"
                        title={
                          affected.action === "refine"
                            ? "This prompt would be refined by your edits."
                            : "This downstream step would be revisited."
                        }
                      />
                    )}
                  </span>
                  <strong>{item.name}</strong>
                  <span>{item.purpose}</span>
                  <span className="studio-prompt-output">↓ {item.output}</span>
                  <small>
                    {affected
                      ? affected.action === "refine"
                        ? "Would refine"
                        : "Would revisit"
                      : "View this step"}
                  </small>
                </button>
              </li>
            );
          })}
        </ol>
      </section>

      <div
        className="studio-loop"
        aria-label="How clip edits refine the script"
      >
        <span>
          <b>1</b> Select a scene
        </span>
        <i aria-hidden="true">→</i>
        <span>
          <b>2</b> Make a clip edit
        </span>
        <i aria-hidden="true">↶</i>
        <span>
          <b>3</b> Refine the linked prompts
        </span>
        <i aria-hidden="true">→</i>
        <span>
          <b>4</b> Preview again
        </span>
      </div>

      <div className="studio-workbench">
        <section
          className="studio-preview"
          ref={previewRef}
          aria-label="Sample clip preview"
        >
          <header className="studio-preview-heading">
            <div>
              <span className="studio-eyebrow">
                Sample Travel / weekend escape
              </span>
              <h3>{scene.name}</h3>
            </div>
            <div className="studio-compare" aria-label="Compare clip versions">
              <button
                aria-pressed={before}
                disabled={!dirty && !receipt.length}
                title={
                  !dirty && !receipt.length
                    ? "Make an edit to compare it with the original."
                    : "Show the version before these edits."
                }
                onClick={() => {
                  setBefore(true);
                  setPlaying(false);
                }}
              >
                Before
              </button>
              <button aria-pressed={!before} onClick={() => setBefore(false)}>
                After
              </button>
            </div>
          </header>
          <div
            className={`studio-preview-canvas palette-${visibleClip.palette}`}
          >
            <div className="studio-canvas-caption">
              <span>
                {before
                  ? "Before edits"
                  : dirty
                    ? "Unsaved clip edits"
                    : `Example v${revision}`}
              </span>
              <span>Illustrative frame</span>
            </div>
            <ScenePhone
              clip={visibleClip}
              scene={scene.id}
              selectedField={selectedField}
              onSelect={before || isPlaying ? undefined : selectTarget}
            />
            <p className="studio-canvas-hint">
              {before
                ? "The previous version at the same moment."
                : "Click a message or card to edit the clip."}
            </p>
          </div>
          <div className="studio-playback">
            <button
              className="workflow-button studio-play"
              aria-label={isPlaying ? "Pause storyboard" : "Play storyboard"}
              onClick={() => {
                if (time >= 30) setTime(0);
                setPlaying(!isPlaying);
              }}
            >
              {isPlaying ? "Ⅱ" : "▶"}
            </button>
            <input
              type="range"
              min="0"
              max="30"
              step="0.25"
              value={time}
              aria-label="Storyboard playhead"
              aria-valuetext={`${timeLabel(time)} of 0:30, ${scene.name}`}
              onChange={(event) => {
                setTime(Number(event.target.value));
                setPlaying(false);
              }}
            />
            <span>
              {timeLabel(time)} <span>/ 0:30</span>
            </span>
            <span className="studio-playback-label">Storyboard playback</span>
          </div>
          <div className="studio-filmstrip-heading">
            <strong>Clip timeline</strong>
            <span>Five sections of one continuous demo</span>
          </div>
          <ol className="studio-filmstrip" aria-label="Clip scenes">
            {SCENES.map((item, index) => (
              <li key={item.id}>
                <button
                  aria-label={`${item.name}, ${timeLabel(item.start)} to ${timeLabel(item.end)}`}
                  aria-pressed={scene.id === item.id}
                  onClick={() => selectScene(item.id)}
                >
                  <div
                    className={`studio-thumb palette-${clip.palette}`}
                    aria-hidden="true"
                  >
                    <div>
                      <ScenePhone clip={clip} scene={item.id} />
                    </div>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                  </div>
                  <strong>{item.name}</strong>
                  <small>
                    {timeLabel(item.start)}–{timeLabel(item.end)}
                  </small>
                </button>
              </li>
            ))}
          </ol>
        </section>

        <aside
          className="studio-editor"
          ref={editorRef}
          aria-label="Clip editing controls"
        >
          <header>
            <span className="studio-eyebrow">Edit the output</span>
            <h3>Shape this clip</h3>
            <p>Make a small change. See which prompts it feeds back into.</p>
            <button
              className="studio-mobile-frame-link"
              onClick={() =>
                previewRef.current?.scrollIntoView({ block: "start" })
              }
            >
              View edited frame ↑
            </button>
          </header>
          <div
            className="studio-editor-tabs"
            role="tablist"
            aria-label="Clip controls"
            onKeyDown={(event) => {
              if (
                !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
              )
                return;
              event.preventDefault();
              const tabs: EditorTab[] = ["content", "look", "checks", "step"];
              const index = tabs.indexOf(editorTab);
              const next =
                event.key === "Home"
                  ? tabs[0]
                  : event.key === "End"
                    ? tabs.at(-1)!
                    : tabs[(index + (event.key === "ArrowLeft" ? 3 : 1)) % 4];
              setEditorTab(next);
              document.getElementById(`studio-tab-${next}`)?.focus();
            }}
          >
            {(
              [
                ["content", "Content"],
                ["look", "Look"],
                ["checks", "Checks"],
                ["step", "Step details"],
              ] as const
            ).map(([id, label]) => (
              <button
                id={`studio-tab-${id}`}
                key={id}
                role="tab"
                tabIndex={editorTab === id ? 0 : -1}
                aria-selected={editorTab === id}
                aria-controls={`studio-panel-${id}`}
                onClick={() => setEditorTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="studio-editor-body">
            <div
              id="studio-panel-content"
              role="tabpanel"
              aria-labelledby="studio-tab-content"
              hidden={editorTab !== "content"}
            >
              <div className="studio-editor-scene">
                <span>
                  {timeLabel(scene.start)}–{timeLabel(scene.end)}
                </span>
                <strong>{scene.name}</strong>
                <p>{scene.description}</p>
              </div>
              {scene.fields.map((field) => (
                <div className="studio-field" key={field.key}>
                  <label htmlFor={`clip-field-${field.key}`}>
                    {field.label}
                  </label>
                  <textarea
                    id={`clip-field-${field.key}`}
                    rows={field.max > 48 ? 3 : 2}
                    value={clip[field.key]}
                    maxLength={field.max}
                    onFocus={() => setSelectedField(field.key)}
                    onChange={(event) => update(field.key, event.target.value)}
                  />
                  <small>
                    {clip[field.key].length}/{field.max}
                    {field.key === "destination"
                      ? " · Carries through choices, result and checkout"
                      : ""}
                  </small>
                </div>
              ))}
              <div className="studio-quick-edits">
                <span>Try a small edit</span>
                {scene.id === "opening" ? (
                  <>
                    <button
                      onClick={() =>
                        update("request", "Plan me a sunny weekend.")
                      }
                    >
                      Shorten the message
                    </button>
                    <button
                      onClick={() =>
                        update(
                          "request",
                          "I need a little sunshine this weekend.",
                        )
                      }
                    >
                      Make it more casual
                    </button>
                  </>
                ) : scene.id === "reply" ? (
                  <button
                    onClick={() =>
                      update("reply", "Three sunny cities. All under $500.")
                    }
                  >
                    Make the reply tighter
                  </button>
                ) : scene.id === "choices" ? (
                  <button onClick={() => update("destination", "Porto")}>
                    Try Porto instead
                  </button>
                ) : scene.id === "result" ? (
                  <button
                    onClick={() =>
                      update("resultTitle", "A little escape. All sorted.")
                    }
                  >
                    Make the headline warmer
                  </button>
                ) : (
                  <button
                    onClick={() =>
                      update("closing", "Shall we make it happen?")
                    }
                  >
                    Soften the closing message
                  </button>
                )}
              </div>
            </div>
            <div
              id="studio-panel-look"
              role="tabpanel"
              aria-labelledby="studio-tab-look"
              hidden={editorTab !== "look"}
            >
              <div className="studio-editor-scene">
                <strong>Look & feel</strong>
                <p>These visual choices carry through every scene.</p>
              </div>
              <fieldset className="studio-field">
                <legend>Color palette</legend>
                <div className="studio-swatches">
                  {(["ocean", "sunset", "sage"] as const).map((value) => (
                    <button
                      key={value}
                      className={`palette-${value}`}
                      aria-pressed={clip.palette === value}
                      onClick={() => update("palette", value)}
                    >
                      <i />
                      <span>{value[0].toUpperCase() + value.slice(1)}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="studio-field">
                <legend>Background detail</legend>
                <div className="studio-options">
                  {(["soft", "vivid"] as const).map((value) => (
                    <button
                      key={value}
                      aria-pressed={clip.background === value}
                      onClick={() => update("background", value)}
                    >
                      {value === "soft" ? "Calmer" : "More texture"}
                    </button>
                  ))}
                </div>
              </fieldset>
              <fieldset className="studio-field">
                <legend>Message size</legend>
                <div className="studio-options">
                  {(["standard", "large"] as const).map((value) => (
                    <button
                      key={value}
                      aria-pressed={clip.textSize === value}
                      onClick={() => update("textSize", value)}
                    >
                      {value === "standard" ? "Standard" : "Larger text"}
                    </button>
                  ))}
                </div>
              </fieldset>
              <p className="studio-field-help">
                Palette and background edits feed back to the artwork prompts.
                Message sizing feeds back to the build prompt.
              </p>
            </div>
            <div
              id="studio-panel-checks"
              role="tabpanel"
              aria-labelledby="studio-tab-checks"
              hidden={editorTab !== "checks"}
            >
              <div className="studio-editor-scene">
                <strong>What the next render checks</strong>
                <p>
                  Shown as a checklist here. No AI reviews have run in this
                  prototype.
                </p>
              </div>
              <ul className="studio-checks">
                {[
                  "The story matches the company brief",
                  "Messages fit and stay readable",
                  "The visuals feel consistent",
                  "Choices and payment work",
                  "The complete clip has a clear pace",
                ].map((check) => (
                  <li key={check}>
                    <span aria-hidden="true">○</span>
                    <span>{check}</span>
                    <small>Not run</small>
                  </li>
                ))}
              </ul>
              <p className="studio-field-help">
                Frames help review layout and branding. The full clip is needed
                to check motion, timing and interactions.
              </p>
            </div>
            <div
              id="studio-panel-step"
              role="tabpanel"
              aria-labelledby="studio-tab-step"
              hidden={editorTab !== "step"}
            >
              <div className="studio-editor-scene">
                <strong>
                  {prompt.name} prompt
                  {prompt.id === "artwork" || prompt.id === "review" ? "s" : ""}
                </strong>
                <p>{prompt.detail}</p>
              </div>
              <dl className="studio-step-io">
                <div>
                  <dt>Receives</dt>
                  <dd>{prompt.input}</dd>
                </div>
                <div>
                  <dt>Produces</dt>
                  <dd>{prompt.output}</dd>
                </div>
              </dl>
              <h4>What matters here</h4>
              <ul className="studio-step-checks">
                {prompt.checks.map((check) => (
                  <li key={check}>{check}</li>
                ))}
              </ul>
              {prompt.id === "research" && (
                <div className="studio-sample-brief">
                  <span>Example brief</span>
                  <strong>Sample Travel</strong>
                  <p>
                    A travel service helping people find a weekend escape with
                    flights and a place to stay.
                  </p>
                  <small>
                    Audience: weekend travelers
                    <br />
                    Journey: discover → choose → book
                  </small>
                </div>
              )}
            </div>
          </div>
          <div className="studio-refinement">
            <div className="studio-section-heading">
              <h4>
                {dirty
                  ? "This edit feeds back into"
                  : receipt.length
                    ? "Last example refinement"
                    : "The feedback loop"}
              </h4>
              <span className="studio-subtle">Illustrated</span>
            </div>
            {path.length ? (
              <ol>
                {path.map((step) => (
                  <li key={step.id}>
                    <span
                      className={
                        step.action === "refine" ? "is-refinement" : ""
                      }
                    >
                      {step.action === "refine" ? "↶" : "→"}
                    </span>
                    <strong>{step.name}</strong>
                    <small>
                      {step.action === "refine"
                        ? "Refine prompt"
                        : step.id === "review"
                          ? "Check again"
                          : "Revisit output"}
                    </small>
                  </li>
                ))}
              </ol>
            ) : (
              <p>
                Change a message or visual style. The prompt steps above will
                show where that feedback belongs.
              </p>
            )}
            {!!displayedChanges.length && (
              <p>
                {displayedChanges.length} clip{" "}
                {displayedChanges.length === 1 ? "edit" : "edits"} ·{" "}
                {new Set(displayedChanges.map((change) => change.prompt)).size}{" "}
                prompt{" "}
                {new Set(displayedChanges.map((change) => change.prompt))
                  .size === 1
                  ? "step"
                  : "steps"}{" "}
                to refine
              </p>
            )}
          </div>
        </aside>
      </div>
      {receipt.length > 0 && !dirty && (
        <div className="studio-receipt" role="status">
          <strong>Example v{revision} saved in this prototype.</strong>
          <span>
            The highlighted steps show how these edits would refine the script.
          </span>
          <ul>
            {receipt.map((change) => (
              <li key={change.field}>
                <span>{FIELD_LABELS[change.field]}</span>
                <del>{change.before}</del>
                <span aria-hidden="true">→</span>
                <b>{change.after}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
      <footer className={`studio-savebar ${dirty ? "is-dirty" : ""}`}>
        <div>
          <strong>
            {invalid
              ? "Add text to the empty fields before saving."
              : dirty
                ? `${changes.length} unsaved clip ${changes.length === 1 ? "edit" : "edits"}`
                : "Try editing the clip to see the feedback loop"}
          </strong>
          <span>
            Local walkthrough. Reloading or switching agents resets the example.
          </span>
        </div>
        <div className="workflow-save-actions">
          <button
            className="workflow-button is-quiet"
            disabled={!dirty}
            title={
              !dirty ? "There are no unsaved edits to discard." : undefined
            }
            onClick={() => {
              setClip({ ...saved });
              setBefore(false);
            }}
          >
            Discard edits
          </button>
          <button
            className="workflow-button is-primary"
            disabled={!dirty || invalid}
            title={
              invalid
                ? "Add text to the empty fields first."
                : !dirty
                  ? "Edit a message or visual style first."
                  : "Save this local example and illustrate the prompt feedback."
            }
            onClick={save}
          >
            Save changes <span aria-hidden="true">↗</span>
          </button>
        </div>
      </footer>
    </section>
  );
}
