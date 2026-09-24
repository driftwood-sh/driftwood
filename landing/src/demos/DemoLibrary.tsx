import { useEffect, useRef, useState, type FormEvent, type RefObject, type SyntheticEvent } from "react";
import { ExternalIcon, SearchIcon, VideoIcon } from "../assets/icons";
import { listDemos, sendFeedback, type Demo, type DemosPage, type Sentiment } from "./api";
import FeedbackForm from "./FeedbackForm";
import { EMPTY_FEEDBACK, type FeedbackState } from "./feedback";
import "./demos.css";

function DemoPreview({ demo, videoRef, onPlaybackTime }: { demo: Demo; videoRef: RefObject<HTMLVideoElement | null>; onPlaybackTime: (time: number | null) => void }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <div className="demo-placeholder"><VideoIcon size={30} /><p>Preview could not load.</p><a href={demo.content_url} target="_blank" rel="noopener noreferrer">Open the demo in a new tab</a></div>;
  if (demo.content_type === "video/mp4") {
    const updateTime = (event: SyntheticEvent<HTMLVideoElement>) => onPlaybackTime(Number.isFinite(event.currentTarget.currentTime) ? Math.floor(event.currentTarget.currentTime) : null);
    return <video ref={videoRef} className="demo-video" controls preload="metadata" src={demo.content_url} onLoadedMetadata={updateTime} onTimeUpdate={updateTime} onEmptied={() => onPlaybackTime(null)} onError={() => { setFailed(true); onPlaybackTime(null); }} aria-label={`Demo for ${demo.company_name}`} />;
  }
  if (demo.content_type.startsWith("image/")) {
    return <img className="demo-image" src={demo.content_url} alt={`Demo for ${demo.company_name}`} onError={() => setFailed(true)} />;
  }
  if (demo.content_type === "text/html") {
    return <iframe className="demo-web" src={demo.content_url} title={`Demo for ${demo.company_name}`} sandbox="" referrerPolicy="no-referrer" />;
  }
  return <div className="demo-placeholder"><VideoIcon size={30} /><p>This demo is available in a separate tab.</p><a href={demo.content_url} target="_blank" rel="noopener noreferrer">Open demo</a></div>;
}

function DemoDetail({ demo, feedback, onFeedback, onSend }: { demo: Demo; feedback: FeedbackState; onFeedback: (patch: Partial<FeedbackState>) => void; onSend: (message: string, sentiment: Sentiment) => Promise<boolean> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackTime, setPlaybackTime] = useState<number | null>(null);
  return (
    <article className="demo-detail" aria-label={`Demo for ${demo.company_name}`}>
      <div className="demo-detail-heading">
        <div><h2>{demo.company_name}</h2><p>{demo.lead_name ? `For ${demo.lead_name} · ` : ""}Updated {new Date(demo.updated_at).toLocaleDateString()}</p></div>
        <a className="demo-button" href={demo.preview_url ?? demo.content_url} target="_blank" rel="noopener noreferrer">Open demo <ExternalIcon size={15} /></a>
      </div>
      <div className="demo-preview"><DemoPreview demo={demo} videoRef={videoRef} onPlaybackTime={setPlaybackTime} /></div>
      {demo.description && <p className="demo-description">{demo.description}</p>}
      <FeedbackForm state={feedback} onChange={onFeedback} onSend={onSend} videoRef={videoRef} playbackTime={playbackTime} isVideo={demo.content_type === "video/mp4"} />
    </article>
  );
}

/* Every demo made for this workspace, one at a time: the list on the left,
   the demo itself on the right with a way to ask for a change. This is the
   Demos page for everyone; approval views sit beside it only where the
   customer's own team approves. */
export default function DemoLibrary() {
  const [page, setPage] = useState<DemosPage | null>(null);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, FeedbackState>>({});
  const pendingFeedback = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    listDemos(query, offset, controller.signal)
      .then((result) => { if (!controller.signal.aborted) { setPage(result); setError(null); } })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Demos could not load."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [query, offset, refresh]);

  const selected = page?.demos.find((demo) => demo.demo_id === selectedId) ?? page?.demos[0];
  // Drafts, timestamps and delivery state belong to the exact version reviewed.
  const feedbackKey = selected ? `${selected.demo_id}:${selected.artifact_id}:${selected.updated_at}` : "";

  function updateFeedback(key: string, patch: Partial<FeedbackState>) {
    setFeedback((current) => ({ ...current, [key]: { ...(current[key] ?? EMPTY_FEEDBACK), ...patch } }));
  }

  async function submitFeedback(demo: Demo, key: string, message: string, sentiment: Sentiment): Promise<boolean> {
    if (pendingFeedback.current.has(key)) return false;
    pendingFeedback.current.add(key);
    updateFeedback(key, { pending: sentiment, sent: null, error: null });
    try {
      await sendFeedback(demo, message, sentiment);
      updateFeedback(key, { pending: null, sent: sentiment, mode: "idle", ...(sentiment !== "looks_good" ? { message: "", timestamp: null } : {}) });
      return true;
    } catch (reason) {
      updateFeedback(key, { pending: null, error: reason instanceof Error ? reason.message : "Feedback could not be delivered. Please try again." });
      return false;
    } finally {
      pendingFeedback.current.delete(key);
    }
  }

  function search(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setQuery(queryInput.trim());
    setOffset(0);
    setRefresh((value) => value + 1);
  }

  return (
    <div className="demo-library-view">
      <form className="demos-search" role="search" onSubmit={search}>
        <SearchIcon size={17} /><label className="sr-only" htmlFor="demo-search">Search demos</label>
        <input id="demo-search" type="search" placeholder="Search company, lead, or demo" maxLength={200} value={queryInput} onChange={(event) => setQueryInput(event.target.value)} />
        <button type="submit" className="demo-button" disabled={loading} title={loading ? "Loading demos" : undefined}>Search</button>
        <button className="demo-button" type="button" disabled={loading} title={loading ? "Loading demos" : undefined} onClick={() => { setLoading(true); setRefresh((value) => value + 1); }}>Refresh</button>
      </form>
      {loading ? (
        /* Mirrors the loaded layout: the list rail and the demo beside it. */
        <div className="demos-layout" role="status" aria-label="Loading demos">
          <div className="demos-list" aria-hidden="true">
            {[0, 1, 2, 3, 4].map((index) => <span key={index} className="demo-skel demo-skel-item" />)}
          </div>
          <div className="demo-detail" aria-hidden="true">
            <span className="demo-skel demo-skel-title" />
            <span className="demo-skel demo-skel-player" />
          </div>
        </div>
      ) : error ? (
        <div className="demos-state" role="alert"><h2>Demos could not load</h2><p>{error}</p><button className="demo-button" onClick={() => { setLoading(true); setRefresh((value) => value + 1); }}>Try again</button></div>
      ) : !selected ? (
        <div className="demos-state"><VideoIcon size={30} /><h2>{query ? "No matching demos" : "Your demos will appear here"}</h2><p>{query ? "Try another company or lead name." : "Your completed demos appear here, ready to preview and share feedback."}</p></div>
      ) : (
        <div className="demos-layout">
          <aside className="demos-library" aria-label="Created demos">
            <p className="demos-count">{page!.total} {page!.total === 1 ? "demo" : "demos"}{query ? " found" : " created"}</p>
            <div className="demos-list">
              {page!.demos.map((demo) => (
                <button key={demo.demo_id} className={`demo-list-item ${selected.demo_id === demo.demo_id ? "is-active" : ""}`} type="button" aria-pressed={selected.demo_id === demo.demo_id} onClick={() => setSelectedId(demo.demo_id)}>
                  <span className="demo-list-icon"><VideoIcon size={19} /></span>
                  <span><strong>{demo.company_name}</strong><span>{demo.lead_name ?? "Company demo"}</span><small>{new Date(demo.updated_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</small></span>
                </button>
              ))}
            </div>
            {page!.total > page!.limit && <div className="demos-pagination">
              <button className="demo-button" disabled={offset === 0} onClick={() => { setLoading(true); setOffset(Math.max(0, offset - page!.limit)); }}>Previous</button>
              <span>{offset + 1}–{offset + page!.demos.length} of {page!.total}</span>
              <button className="demo-button" disabled={offset + page!.limit >= page!.total} onClick={() => { setLoading(true); setOffset(offset + page!.limit); }}>Next</button>
            </div>}
          </aside>
          <DemoDetail key={feedbackKey} demo={selected} feedback={feedback[feedbackKey] ?? EMPTY_FEEDBACK} onFeedback={(patch) => updateFeedback(feedbackKey, patch)} onSend={(message, sentiment) => submitFeedback(selected, feedbackKey, message, sentiment)} />
        </div>
      )}
    </div>
  );
}
