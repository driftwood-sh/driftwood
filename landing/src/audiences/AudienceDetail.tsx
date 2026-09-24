import { Fragment, useMemo, useState, type ReactNode } from "react";
import {
  csvFilename,
  FOUND_BY_LABELS,
  filterMembers,
  formatAudienceDate,
  foundByCounts,
  memberFoundBy,
  membersCsv,
  providerLabel,
  stageLabel,
  type Audience,
  type AudienceMember,
  type MemberFilter,
} from "./model";
import { BackIcon, SearchIcon } from "./icons";

/* One audience, full width: who is in it, where each person came from, and
   everything we hold on them one click away. The list is the page; the
   controls around it are the few things a reader does with a list. */

function outreachLabel(member: AudienceMember): string {
  if (!member.contactable) return "Unavailable";
  if (!member.outreachEligible) return "Needs qualification";
  return "Ready";
}

function downloadCsv(audience: Audience, members: AudienceMember[]) {
  const blob = new Blob([membersCsv(members, audience)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = csvFilename(audience.name);
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export default function AudienceDetail({
  audience,
  onBack,
  title,
  actions,
  tags,
  notices,
}: {
  audience: Audience;
  onBack: () => void;
  /* The heading, which the page owns because renaming lives there. */
  title: ReactNode;
  /* Write controls (find similar, delete), absent for a read-only seat. */
  actions?: ReactNode;
  tags?: ReactNode;
  notices?: ReactNode;
}) {
  const [filter, setFilter] = useState<MemberFilter>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const chips = useMemo(() => foundByCounts(audience.members, audience), [audience]);
  const shown = useMemo(
    () => filterMembers(audience.members, audience, filter, query),
    [audience, filter, query],
  );
  const narrowed = filter !== "all" || query.trim() !== "";

  return (
    <section className="audience-detail-page" aria-labelledby="audience-detail-heading">
      <button type="button" className="audience-back" onClick={onBack}>
        <BackIcon size={15} /> Audiences
      </button>

      <header className="audience-detail-page-head">
        <div>
          <span className="audience-detail-source">{providerLabel(audience.sourceProvider)}</span>
          {title}
          {audience.description && <p>{audience.description}</p>}
          <p className="audience-detail-meta">
            {audience.memberCount.toLocaleString()} {audience.memberCount === 1 ? "person" : "people"} · Updated{" "}
            {formatAudienceDate(audience.updatedAt)}
          </p>
        </div>
        <div className="audience-detail-actions">
          <button
            type="button"
            className="audience-secondary"
            onClick={() => downloadCsv(audience, shown)}
            disabled={shown.length === 0}
            title={shown.length === 0 ? "No one to export in this view" : undefined}
          >
            {narrowed ? `Export ${shown.length.toLocaleString()} shown` : "Export CSV"}
          </button>
          {actions}
        </div>
      </header>

      {tags}
      {notices}

      <div className="audience-member-tools">
        {chips.length > 2 && (
          <div className="audience-found-chips" role="group" aria-label="Found by">
            {chips.map((chip) => (
              <button
                key={chip.id}
                type="button"
                aria-pressed={filter === chip.id}
                onClick={() => {
                  setFilter(chip.id);
                  setOpen(null);
                }}
              >
                {chip.label}
                <span>{chip.count.toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
        <label className="audience-library-search audience-member-search">
          <SearchIcon size={15} />
          <span className="audience-visually-hidden">Search people in this audience</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search name, title, company, or email"
          />
        </label>
      </div>

      {narrowed && (
        <p className="audience-member-count" role="status">
          {shown.length.toLocaleString()} of {audience.members.length.toLocaleString()} people
        </p>
      )}

      {audience.members.length === 0 ? (
        <div className="audience-state">
          <h2>No one in this audience yet</h2>
          <p>Find similar people or upload a CSV to fill it.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="audience-state">
          <h2>No one matches</h2>
          <p>Clear the search or choose All.</p>
        </div>
      ) : (
        <div className="audience-table-wrap audience-members-table">
          <table className="audience-table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Company</th>
                <th scope="col">Email</th>
                <th scope="col">Found by</th>
                <th scope="col">Outreach</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((member) => {
                const found = memberFoundBy(member, audience);
                const isOpen = open === member.leadId;
                const ready = member.contactable && member.outreachEligible;
                return (
                  <Fragment key={member.leadId}>
                    <tr className={isOpen ? "is-open" : undefined}>
                      <td>
                        <button
                          type="button"
                          className="audience-member-name"
                          aria-expanded={isOpen}
                          onClick={() => setOpen(isOpen ? null : member.leadId)}
                        >
                          <strong>{member.name}</strong>
                          <span>{member.title}</span>
                        </button>
                      </td>
                      <td>{member.company}</td>
                      <td className="audience-cell-muted">{member.email}</td>
                      <td>
                        {found ? (
                          <span className={`audience-found is-${found}`}>{FOUND_BY_LABELS[found]}</span>
                        ) : (
                          <span className="audience-cell-muted">—</span>
                        )}
                      </td>
                      <td className={ready ? undefined : "audience-cell-muted"}>{outreachLabel(member)}</td>
                    </tr>
                    {isOpen && (
                      <tr className="audience-member-more">
                        <td colSpan={5}>
                          <dl>
                            <div><dt>Title</dt><dd>{member.title}</dd></div>
                            <div><dt>Company</dt><dd>{member.company}</dd></div>
                            <div><dt>Email</dt><dd>{member.email}</dd></div>
                            <div>
                              <dt>LinkedIn</dt>
                              <dd>
                                {member.linkedinUrl ? (
                                  <a href={member.linkedinUrl} target="_blank" rel="noopener noreferrer">
                                    View profile
                                  </a>
                                ) : (
                                  "Not on file"
                                )}
                              </dd>
                            </div>
                            <div><dt>Stage</dt><dd>{stageLabel(member.stage)}</dd></div>
                            <div><dt>Found by</dt><dd>{found ? FOUND_BY_LABELS[found] : "Not recorded"}</dd></div>
                            {member.addedAt && (
                              <div><dt>Added</dt><dd>{formatAudienceDate(member.addedAt)}</dd></div>
                            )}
                            <div><dt>Outreach</dt><dd>{outreachLabel(member)}</dd></div>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
