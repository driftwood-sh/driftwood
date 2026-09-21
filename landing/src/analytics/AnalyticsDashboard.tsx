import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getChannelAnalytics } from "./api";
import { InfoIcon, RefreshIcon, TrendIcon } from "./icons";
import {
  AVAILABLE_STATUSES,
  CHANNELS,
  analyticsDataAfterFailure,
  appendAnalyticsPage,
  analyticsWindow,
  channelLabel,
  countAutomatic,
  filterByReplyKind,
  formatMetric,
  formatObservedAt,
  formatReplyBody,
  statusLabel,
  type AnalyticsChannel,
  type AnalyticsStatus,
  type ChannelAnalytics,
  type MetricValue,
  type ReplyKindFilter,
} from "./model";
import "./analytics.css";

const WINDOWS = [
  { days: 7, label: "Last 7 days" },
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
];

const METRIC_KEYS = [
  { key: "contacted", label: "Contacted" },
  { key: "opened", label: "Opened" },
  { key: "clicked", label: "Clicked" },
  { key: "watched", label: "Watched" },
  { key: "replied", label: "Replied" },
  { key: "demosBooked", label: "Demos booked" },
] as const;

/* How to read the three demo columns. The demo rides in the email as a GIF
   that links to a player page, so an open and a click come from two
   different places and carry different weight. */
const ENGAGEMENT_NOTE =
  "An open is only a hint. Apple Mail fetches the demo image before anyone reads the email. The player page confirms a click and a watch. Watched counts the leads who reached half the video.";

function MetricCell({ metric, unavailable }: { metric: MetricValue; unavailable: string }) {
  return (
    <td className={!metric.available ? "analytics-unavailable" : undefined}>
      <span title={!metric.available ? unavailable : undefined}>{formatMetric(metric)}</span>
    </td>
  );
}

function ReplyContent({ subject, body, expanded, onToggle }: {
  subject: string | null;
  body: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const bodyRef = useRef<HTMLParagraphElement | null>(null);
  const [clamped, setClamped] = useState(false);

  /* Only offer "Show more" when the two-line clamp is actually hiding text. */
  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element || expanded) return;
    const measure = () => setClamped(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [body, expanded]);

  return (
    <div className="analytics-reply">
      {subject ? <p className="analytics-reply-subject">{subject}</p> : null}
      <p ref={bodyRef} className={expanded ? "analytics-reply-body is-expanded" : "analytics-reply-body"}>
        {body}
      </p>
      {expanded || clamped ? (
        <button type="button" className="analytics-reply-toggle" aria-expanded={expanded} onClick={onToggle}>
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}

export default function AnalyticsDashboard() {
  const [days, setDays] = useState(30);
  const [channel, setChannel] = useState<AnalyticsChannel | null>(null);
  const [status, setStatus] = useState<AnalyticsStatus>("replied");
  const [data, setData] = useState<ChannelAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [expandedReplies, setExpandedReplies] = useState<ReadonlySet<string>>(new Set());
  /* Replied view only: differentiate human replies from automatic responses
     (OOO, autoresponders). Client-side over the loaded rows — the reply
     rate above never changes. */
  const [replyKind, setReplyKind] = useState<ReplyKindFilter>("human");

  const toggleReply = useCallback((key: string) => {
    setExpandedReplies((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /* Every fresh load (refresh, window, filters) collapses the replies again;
     paging in more people (offset) keeps what the reader opened. */
  const load = useCallback(() => {
    setLoading(true);
    setLoadingMore(false);
    setData(null);
    setOffset(0);
    setError(null);
    setExpandedReplies(new Set());
    setReplyKind("all");
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const window = analyticsWindow(days);
    getChannelAnalytics({
      ...window,
      channel,
      status,
      limit: 100,
      offset,
      signal: controller.signal,
    })
      .then((next) => {
        setData((current) => offset > 0 && current
          ? appendAnalyticsPage(current, next)
          : next);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setData((current) => analyticsDataAfterFailure(current, offset));
        setError(reason instanceof Error ? reason.message : "Analytics could not load.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      });
    return () => controller.abort();
  }, [channel, days, offset, refreshKey, status]);

  /* A dash in the matrix gets the backend's own reason for that metric, not
     one borrowed from another row: watch tracking rides the demo email, so
     LinkedIn and X go dark on opened, clicked and watched alike, and each
     definition says why in its own words. */
  const noteFor = useCallback(
    (id: AnalyticsStatus) =>
      data?.definitions.find((definition) => definition.id === id)?.note ??
      "This event is not tracked on this channel.",
    [data],
  );
  const automaticCount = data ? countAutomatic(data.people) : 0;
  const visiblePeople = data
    ? status === "replied"
      ? filterByReplyKind(data.people, replyKind)
      : data.people
    : [];
  const dataIssues = data
    ? Object.values(data.unmatchedReplies).reduce((sum, value) => sum + value, 0) +
      data.unattributedDemosBooked
    : 0;

  return (
    <section className="analytics-page" aria-labelledby="analytics-heading">
      <div className="analytics-heading-row">
        {/* "Metrics" everywhere — nav, the overview's "Open metrics" link,
            and this h1 name one concept (ux-principles rule 12). */}
        <h1 id="analytics-heading">Metrics</h1>
        <div className="analytics-window-controls">
          <label>
            <span>Date range</span>
            <select
              value={days}
              onChange={(event) => {
                setLoading(true);
                setData(null);
                setError(null);
                setOffset(0);
                setExpandedReplies(new Set());
                setDays(Number(event.target.value));
              }}
            >
              {WINDOWS.map((option) => (
                <option key={option.days} value={option.days}>{option.label}</option>
              ))}
            </select>
          </label>
          <button type="button" className="analytics-refresh" onClick={load} disabled={loading}>
            <RefreshIcon />
            <span>{loading ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {error ? (
        <div className="analytics-error" role="alert">
          <div>
            <strong>Channel data is unavailable</strong>
            <p>{error}</p>
          </div>
          <button type="button" onClick={load}>Try again</button>
        </div>
      ) : null}

      <section className="analytics-matrix-section" aria-labelledby="channel-matrix-heading">
        <div className="analytics-section-heading">
          <h2 id="channel-matrix-heading">Funnel by channel</h2>
        </div>
        <div className="analytics-table-scroll">
          <table className="analytics-matrix">
            <thead>
              <tr>
                <th scope="col">Channel</th>
                {METRIC_KEYS.map((metric) => <th key={metric.key} scope="col">{metric.label}</th>)}
              </tr>
            </thead>
            <tbody aria-busy={loading}>
              {loading && !data ? (
                CHANNELS.map((rowChannel) => (
                  <tr key={rowChannel} className="analytics-skeleton-row">
                    <th scope="row"><span /></th>
                    {METRIC_KEYS.map((metric) => <td key={metric.key}><span /></td>)}
                  </tr>
                ))
              ) : (
                data?.channels.map((row) => (
                  <tr key={row.channel}>
                    <th scope="row"><span className={`analytics-channel-dot is-${row.channel}`} />{channelLabel(row.channel)}</th>
                    <MetricCell metric={row.contacted} unavailable={noteFor("contacted")} />
                    <MetricCell metric={row.opened} unavailable={noteFor("opened")} />
                    <MetricCell metric={row.clicked} unavailable={noteFor("clicked")} />
                    <MetricCell metric={row.watched} unavailable={noteFor("watched")} />
                    <MetricCell metric={row.replied} unavailable={noteFor("replied")} />
                    <MetricCell metric={row.demosBooked} unavailable={noteFor("demos_booked")} />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="analytics-people-section" aria-labelledby="outcome-detail-heading">
        <div className="analytics-section-heading analytics-detail-heading">
          <h2 id="outcome-detail-heading">{status === "replied" ? "Responses" : "Outcome detail"}</h2>
          <div className="analytics-filter-row">
            {status === "replied" && (automaticCount > 0 || replyKind !== "all") ? (
              <label>
                <span className="sr-only">Filter replies by kind</span>
                <select
                  value={replyKind}
                  onChange={(event) => setReplyKind(event.target.value as ReplyKindFilter)}
                >
                  <option value="all">All replies</option>
                  <option value="human">From people</option>
                  <option value="automatic">{`Automatic (${automaticCount})`}</option>
                </select>
              </label>
            ) : null}
            <label>
              <span className="sr-only">Filter people by channel</span>
              <select
                value={channel ?? "all"}
                onChange={(event) => {
                  setLoading(true);
                  setData(null);
                  setError(null);
                  setOffset(0);
                  setExpandedReplies(new Set());
                  setChannel(
                    event.target.value === "all"
                      ? null
                      : event.target.value as AnalyticsChannel,
                  );
                }}
              >
                <option value="all">All channels</option>
                {CHANNELS.map((option) => <option key={option} value={option}>{channelLabel(option)}</option>)}
              </select>
            </label>
          </div>
        </div>
        {/* Filter buttons, not ARIA tabs: no roving tabindex or arrow-key
            contract here, so the honest semantics are a group of toggles. */}
        <div className="analytics-status-tabs" role="group" aria-label="Outcome type">
          {AVAILABLE_STATUSES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={status === option}
              className={status === option ? "is-active" : ""}
              onClick={() => {
                if (status === option) return;
                setLoading(true);
                setData(null);
                setError(null);
                setOffset(0);
                setExpandedReplies(new Set());
                setReplyKind("all");
                setStatus(option);
              }}
            >
              {statusLabel(option)}
            </button>
          ))}
          <span className="analytics-status-unavailable" title={ENGAGEMENT_NOTE}>Opens are a hint. Clicks and watches are confirmed.</span>
        </div>

        <div className="analytics-table-scroll">
          <table className="analytics-people-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Company</th>
                <th scope="col">Channel</th>
                <th scope="col">Observed</th>
              </tr>
            </thead>
            <tbody aria-busy={loading}>
              {loading && !data
                ? Array.from({ length: 5 }, (_, index) => (
                    /* Row skeletons mirror the loaded table (same idiom as the
                       channel matrix above) so nothing jumps when people land. */
                    <tr key={index} className="analytics-skeleton-row">
                      <td><span className="analytics-skel-person" /></td>
                      <td><span /></td>
                      <td><span /></td>
                      <td><span /></td>
                    </tr>
                  ))
                : null}
              {visiblePeople.map((person, index) => {
                const rowKey = `${person.leadId ?? "unmatched"}-${person.channel}-${index}`;
                const replyBody = person.replyText ? formatReplyBody(person.replyText) : "";
                return (
                  <Fragment key={rowKey}>
                    <tr className={replyBody ? "analytics-has-reply" : undefined}>
                      <td>
                        <strong>{person.name ?? "Removed lead"}</strong>
                        <span>{person.title ?? person.email ?? "Details unavailable"}</span>
                      </td>
                      <td>{person.companyName ?? "—"}</td>
                      <td>
                        <span className={`analytics-channel-tag is-${person.channel ?? "unknown"}`}>{channelLabel(person.channel)}</span>
                        {person.replyIsAutomatic ? (
                          <span
                            className="analytics-auto-tag"
                            title={person.replyAutoReason ?? "Automatic response"}
                          >
                            Auto-reply
                          </span>
                        ) : null}
                      </td>
                      <td>{formatObservedAt(person.occurredAt)}</td>
                    </tr>
                    {replyBody ? (
                      <tr className="analytics-reply-row">
                        <td colSpan={4}>
                          <ReplyContent
                            subject={person.replySubject}
                            body={replyBody}
                            expanded={expandedReplies.has(rowKey)}
                            onToggle={() => toggleReply(rowKey)}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {!loading && data && visiblePeople.length === 0 ? (
          <div className="analytics-empty">
            <TrendIcon size={22} />
            <strong>
              {data.people.length > 0
                ? replyKind === "automatic"
                  ? "No automatic responses in this view"
                  : "Only automatic responses in this view"
                : `No ${statusLabel(status).toLowerCase()} prospects in this view`}
            </strong>
            <p>
              {data.people.length > 0
                ? "Switch the reply filter back to all replies."
                : "Try a broader date range or another channel."}
            </p>
          </div>
        ) : null}

        <div className="analytics-table-footer">
          <span>
            {data
              ? `Showing ${visiblePeople.length} of ${data.peopleTotal} ${data.peopleTotal === 1 ? "person" : "people"}${
                  status === "replied" && replyKind !== "all" && data.people.length !== visiblePeople.length
                    ? ` · ${data.people.length - visiblePeople.length} ${replyKind === "human" ? "automatic" : "human"} hidden`
                    : ""
                }`
              : error
                ? "People unavailable for this view"
              : "Loading people…"}
          </span>
          {dataIssues > 0 ? (
            <span title="Unmatched replies and bookings without a prior send are not assigned to a channel.">
              {dataIssues} signals need attribution
            </span>
          ) : (
            <span>All observed outcomes attributed</span>
          )}
        </div>
        {data && data.people.length < data.peopleTotal ? (
          <button
            className="analytics-load-more"
            type="button"
            onClick={() => {
              setLoadingMore(true);
              setOffset(data.offset + data.limit);
            }}
            disabled={loadingMore}
          >
            {loadingMore ? "Loading more…" : `Load more people · ${data.peopleTotal - data.people.length} remaining`}
          </button>
        ) : null}
      </section>

      <aside className="analytics-method" aria-label="Metric definitions">
        <InfoIcon />
        <p>{ENGAGEMENT_NOTE}</p>
      </aside>
    </section>
  );
}
