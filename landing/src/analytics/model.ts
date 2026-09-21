export type AnalyticsChannel = "linkedin" | "email" | "x";

export type AnalyticsStatus =
  | "contacted"
  | "opened"
  | "clicked"
  | "watched"
  | "replied"
  | "demos_booked";

export type MetricValue = {
  count: number | null;
  available: boolean;
};

export type ChannelMetric = {
  channel: AnalyticsChannel;
  contacted: MetricValue;
  opened: MetricValue;
  clicked: MetricValue;
  /* Leads whose best watch of the demo reached 50% or more. */
  watched: MetricValue;
  replied: MetricValue;
  demosBooked: MetricValue;
};

export type MetricDefinition = {
  id: AnalyticsStatus;
  label: string;
  available: boolean;
  definition: string;
  note: string | null;
};

export type MetricPerson = {
  leadId: string | null;
  name: string | null;
  title: string | null;
  email: string | null;
  companyName: string | null;
  channel: AnalyticsChannel | null;
  status: AnalyticsStatus;
  occurredAt: string;
  source: string;
  replySubject: string | null;
  replyText: string | null;
  /* True when the backend's classifier flagged the reply as an automatic
     response (out-of-office, autoresponder, departure notice); the reason
     is its short human-readable why. Counts are unaffected — this only
     lets the drilldown tell people from machines. */
  replyIsAutomatic: boolean;
  replyAutoReason: string | null;
};

export type ChannelAnalytics = {
  window: { start: string; end: string };
  channels: ChannelMetric[];
  definitions: MetricDefinition[];
  people: MetricPerson[];
  peopleStatus: AnalyticsStatus;
  peopleChannel: AnalyticsChannel | null;
  peopleTotal: number;
  limit: number;
  offset: number;
  unmatchedReplies: Record<AnalyticsChannel, number>;
  unattributedDemosBooked: number;
};

export const CHANNELS: AnalyticsChannel[] = ["linkedin", "email", "x"];

/* The drilldown's tabs, in funnel order. Opened, clicked and watched came
   with the tracked demo GIF: the email carries the demo, and the player page
   it links to reports the click and the watch. */
export const AVAILABLE_STATUSES: AnalyticsStatus[] = [
  "contacted",
  "opened",
  "clicked",
  "watched",
  "replied",
  "demos_booked",
];

export function channelLabel(channel: AnalyticsChannel | null): string {
  if (channel === "linkedin") return "LinkedIn";
  if (channel === "email") return "Email";
  if (channel === "x") return "X";
  return "Unattributed";
}

export function statusLabel(status: AnalyticsStatus): string {
  if (status === "demos_booked") return "Demos booked";
  return status[0].toUpperCase() + status.slice(1);
}

export function formatMetric(metric: MetricValue): string {
  if (!metric.available || metric.count === null) return "—";
  return new Intl.NumberFormat("en-US").format(metric.count);
}

export function formatObservedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/* Reply bodies arrive with \r\n line endings and auto-replies pad with runs
   of blank lines; normalize so `white-space: pre-line` renders them sanely. */
export type ReplyKindFilter = "all" | "human" | "automatic";

/* The drilldown's client-side reply-kind filter, applied over the loaded
   rows. Only meaningful on the replied view — every other status has no
   reply to classify, so "all" is the only honest value there. */
export function filterByReplyKind(
  people: MetricPerson[],
  filter: ReplyKindFilter,
): MetricPerson[] {
  if (filter === "all") return people;
  if (filter === "automatic")
    return people.filter((person) => person.replyIsAutomatic);
  return people.filter((person) => !person.replyIsAutomatic);
}

export function countAutomatic(people: MetricPerson[]): number {
  return people.filter((person) => person.replyIsAutomatic).length;
}

export function formatReplyBody(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function analyticsWindow(days: number, now = new Date()) {
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - days);
  return { start: start.toISOString(), end: end.toISOString() };
}

export function appendAnalyticsPage(
  current: ChannelAnalytics,
  next: ChannelAnalytics,
): ChannelAnalytics {
  const people = new Map(
    current.people.map((person) => [
      [person.leadId, person.channel, person.status, person.occurredAt, person.source].join("|"),
      person,
    ]),
  );
  next.people.forEach((person) => {
    people.set(
      [person.leadId, person.channel, person.status, person.occurredAt, person.source].join("|"),
      person,
    );
  });
  return { ...next, people: [...people.values()] };
}

export function analyticsDataAfterFailure(
  current: ChannelAnalytics | null,
  failedOffset: number,
): ChannelAnalytics | null {
  return failedOffset > 0 ? current : null;
}
