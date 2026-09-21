import type {
  AnalyticsChannel,
  AnalyticsStatus,
  ChannelAnalytics,
  ChannelMetric,
  MetricDefinition,
  MetricPerson,
} from "./model";

type RawMetricValue = { count: number | null; available: boolean };

type RawChannelMetric = {
  channel: AnalyticsChannel;
  contacted: RawMetricValue;
  opened: RawMetricValue;
  clicked: RawMetricValue;
  /* Optional so the UI tolerates a backend that predates watch tracking. */
  watched?: RawMetricValue;
  replied: RawMetricValue;
  demos_booked: RawMetricValue;
};

type RawMetricDefinition = Omit<MetricDefinition, "note"> & {
  note?: string | null;
};

type RawMetricPerson = {
  lead_id: string | null;
  name: string | null;
  title: string | null;
  email: string | null;
  company_name: string | null;
  channel: AnalyticsChannel | null;
  status: AnalyticsStatus;
  occurred_at: string;
  source: string;
  /* Optional so the UI tolerates a backend that predates reply content. */
  reply_subject?: string | null;
  reply_text?: string | null;
  /* Optional too: automatic-response classification (OOO, autoresponder). */
  reply_is_automatic?: boolean;
  reply_auto_reason?: string | null;
};

type RawChannelAnalytics = {
  window: { start: string; end: string };
  channels: RawChannelMetric[];
  definitions: RawMetricDefinition[];
  people: RawMetricPerson[];
  people_status: AnalyticsStatus;
  people_channel: AnalyticsChannel | null;
  people_total: number;
  limit: number;
  offset: number;
  unmatched_replies: Record<AnalyticsChannel, number>;
  unattributed_demos_booked: number;
};

export class AnalyticsApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function mapChannel(row: RawChannelMetric): ChannelMetric {
  return {
    channel: row.channel,
    contacted: row.contacted,
    opened: row.opened,
    clicked: row.clicked,
    watched: row.watched ?? { count: null, available: false },
    replied: row.replied,
    demosBooked: row.demos_booked,
  };
}

function mapPerson(row: RawMetricPerson): MetricPerson {
  return {
    leadId: row.lead_id,
    name: row.name,
    title: row.title,
    email: row.email,
    companyName: row.company_name,
    channel: row.channel,
    status: row.status,
    occurredAt: row.occurred_at,
    source: row.source,
    replySubject: row.reply_subject ?? null,
    replyText: row.reply_text ?? null,
    replyIsAutomatic: row.reply_is_automatic ?? false,
    replyAutoReason: row.reply_auto_reason ?? null,
  };
}

export function mapChannelAnalytics(raw: RawChannelAnalytics): ChannelAnalytics {
  return {
    window: raw.window,
    channels: raw.channels.map(mapChannel),
    definitions: raw.definitions.map((definition) => ({
      ...definition,
      note: definition.note ?? null,
    })),
    people: raw.people.map(mapPerson),
    peopleStatus: raw.people_status,
    peopleChannel: raw.people_channel,
    peopleTotal: raw.people_total,
    limit: raw.limit,
    offset: raw.offset,
    unmatchedReplies: raw.unmatched_replies,
    unattributedDemosBooked: raw.unattributed_demos_booked,
  };
}

export async function getChannelAnalytics(options: {
  start: string;
  end: string;
  status: AnalyticsStatus;
  channel: AnalyticsChannel | null;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<ChannelAnalytics> {
  const query = new URLSearchParams({
    start: options.start,
    end: options.end,
    status: options.status,
    limit: String(options.limit ?? 100),
    offset: String(options.offset ?? 0),
  });
  if (options.channel) query.set("channel", options.channel);
  const response = await fetch(`/api/v1/dashboard/channel-metrics?${query}`, {
    credentials: "include",
    signal: options.signal,
  });
  if (!response.ok) {
    let message = `Analytics could not load (${response.status})`;
    try {
      const body = (await response.json()) as {
        detail?: string;
        error?: { detail?: string };
      };
      message = body.error?.detail ?? body.detail ?? message;
    } catch {
      // A reverse proxy can return HTML; keep the status-based message.
    }
    throw new AnalyticsApiError(message, response.status);
  }
  return mapChannelAnalytics((await response.json()) as RawChannelAnalytics);
}
