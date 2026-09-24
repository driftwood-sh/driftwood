import SectionTabs from "../dashboard/SectionTabs";
import AudienceDetail from "./AudienceDetail";
import { saveAudienceTags } from "./api";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import {
  createAudience,
  deleteAudience,
  discoverAudienceLeads,
  getDiscoveryStatus,
  getAudience,
  listAudiences,
  uploadLeadList,
  renameAudience,
  findSimilarPeople,
  growAudience,
} from "./api";
import {
  EMPTY_FILTERS,
  filterAudiences,
  formatAudienceDate,
  providerLabel,
  summarizeLeadImport,
  stageLabel,
  toggleLead,
  type Audience,
  type AudienceFilters,
  type AudienceSummary,
  type DiscoveryResult,
  type DiscoveryProvider,
  type LeadImportNotice,
} from "./model";
import {
  ArrowIcon,
  AudienceIcon,
  BackIcon,
  CheckIcon,
  PlusIcon,
  SearchIcon,
  TrashIcon,
  UploadIcon,
} from "./icons";
import { useWorkspacePermissions } from "../dashboard/workspace-permissions-context";
import { withMockMode } from "../mock-mode";
import "./audiences.css";

type View = "library" | "builder";
type BuilderTab = "search" | "details";

export default function Audiences() {
  const { canWrite } = useWorkspacePermissions();
  const [view, setView] = useState<View>("library");
  const [audiences, setAudiences] = useState<AudienceSummary[]>([]);
  const [selectedAudience, setSelectedAudience] = useState<Audience | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const [tagsBusy, setTagsBusy] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  /* Errors render next to the control that failed (ux-principles rule 7), so
     each surface gets its own slot instead of one page-wide message. */
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailFailedId, setDetailFailedId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [filters, setFilters] = useState<AudienceFilters>(EMPTY_FILTERS);
  const [results, setResults] = useState<DiscoveryResult | null>(null);
  const [builderTab, setBuilderTab] = useState<BuilderTab>("search");
  const [resultQuery, setResultQuery] = useState("");
  const [providerStatuses, setProviderStatuses] = useState<DiscoveryProvider[]>([]);
  const [providerStatusLoading, setProviderStatusLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importName, setImportName] = useState("");
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [growTarget, setGrowTarget] = useState<Audience | null>(null);
  const [findingSimilar, setFindingSimilar] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [importNotice, setImportNotice] = useState<LeadImportNotice | null>(null);
  const [selectedRecords, setSelectedRecords] = useState<Set<string>>(new Set());
  const [discovering, setDiscovering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  /* Enter submits the rename AND blurs the input (disabling it), so the blur
     handler re-enters submitRename before the `renaming` state commits — a
     ref is the only reliable same-tick double-submit guard. */
  const renamingRef = useRef(false);

  useEffect(() => {
    let current = true;
    listAudiences()
      .then((rows) => {
        if (current) setAudiences(rows);
      })
      .catch(() => {
        if (current) setLoadFailed(true);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    getDiscoveryStatus()
      .then((status) => {
        if (!current) return;
        setProviderStatuses(status.providers);
      })
      .catch(() => {
        if (!current) return;
        setProviderStatuses([
          { provider: "orange_slice", label: "Orange Slice", configured: false },
          { provider: "workspace", label: "Workspace leads", configured: true },
        ]);
      })
      .finally(() => {
        if (current) setProviderStatusLoading(false);
      });
    return () => {
      current = false;
    };
  }, []);

  /* An armed delete disarms itself after a beat — no stale confirm button
     waiting to be fat-fingered later (the review-queue idiom). */
  useEffect(() => {
    if (!confirmDelete) return;
    const t = window.setTimeout(() => setConfirmDelete(false), 5000);
    return () => window.clearTimeout(t);
  }, [confirmDelete]);

  const filteredAudiences = useMemo(
    () => filterAudiences(audiences, "").filter((a) => `${a.name} ${a.description} ${(a.tags ?? []).join(" ")}`.toLowerCase().includes(query.trim().toLowerCase())),
    [audiences, query],
  );

  function startBuilder() {
    setView("builder");
    setName("");
    setDescription("");
    setFilters(EMPTY_FILTERS);
    setResults(null);
    setBuilderTab("search");
    setResultQuery("");
    setImportNotice(null);
    setSelectedRecords(new Set());
    setSearchError(null);
    setSaveError(null);
  }

  const activeProvider = providerStatuses.find(
    (provider) => provider.provider === "orange_slice",
  );
  const visibleCandidates = useMemo(() => {
    if (!results) return [];
    const normalized = resultQuery.trim().toLowerCase();
    if (!normalized) return results.candidates;
    return results.candidates.filter((candidate) =>
      [candidate.name, candidate.title, candidate.company]
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [resultQuery, results]);

  const audienceRequest = useRef(0);
  /* The open audience lives in the URL (?audience=<id>), so Back returns to
     the list and a refresh or a shared link reopens the same people. */
  function writeAudienceParam(id: string | null) {
    const params = new URLSearchParams(window.location.search);
    if (params.get("audience") === id || (id === null && !params.has("audience"))) return;
    if (id) params.set("audience", id);
    else params.delete("audience");
    const search = params.toString();
    window.history.pushState(null, "", `${window.location.pathname}${search ? `?${search}` : ""}`);
  }

  function closeAudience() {
    ++audienceRequest.current;
    setSelectedAudience(null);
    setDetailLoading(false);
    setDetailFailedId(null);
    setDetailError(null);
    setRenameDraft(null);
    setConfirmDelete(false);
    setTagsOpen(false);
    writeAudienceParam(null);
  }

  useEffect(() => {
    const fromUrl = () => {
      const id = new URLSearchParams(window.location.search).get("audience");
      if (id) void openAudience(id, false);
      else {
        ++audienceRequest.current;
        setSelectedAudience(null);
        setDetailLoading(false);
        setDetailFailedId(null);
      }
    };
    fromUrl();
    window.addEventListener("popstate", fromUrl);
    return () => window.removeEventListener("popstate", fromUrl);
    // openAudience is re-created each render; the listener only needs the
    // latest request counter, which lives in a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openAudience(id: string, record = true) {
    if (record) writeAudienceParam(id);
    const request = ++audienceRequest.current;
    setDetailLoading(true);
    setDetailError(null);
    setDetailFailedId(null);
    setConfirmDelete(false);
    try {
      const audience = await getAudience(id);
      if (request !== audienceRequest.current) return;
      setSelectedAudience(audience);
      setTagDraft((audience.tags ?? []).join(", "));
    } catch (reason) {
      if (request === audienceRequest.current) {
      setDetailError(reason instanceof Error ? reason.message : "This audience could not load.");
      setDetailFailedId(id);
      }
    } finally {
      if (request === audienceRequest.current) setDetailLoading(false);
    }
  }

  async function runDiscovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (discovering) return;
    setDiscovering(true);
    setSearchError(null);
    try {
      const nextResults = await discoverAudienceLeads(filters, "orange_slice");
      setResults(nextResults);
      const available = new Set(nextResults.candidates.map((candidate) => candidate.providerRecordId));
      setSelectedRecords((current) => new Set([...current].filter((id) => available.has(id))));
    } catch (reason) {
      setSearchError(reason instanceof Error ? reason.message : "Lead discovery could not run.");
    } finally {
      setDiscovering(false);
    }
  }

  async function findSimilar(audience: Audience) {
    if (findingSimilar) return;
    setFindingSimilar(true);
    setDetailError(null);
    try {
      const similar = await findSimilarPeople(audience.id);
      setGrowTarget(audience);
      setName(audience.name);
      setResults(similar);
      setSelectedRecords(new Set());
      setSearchError(null);
      setSaveError(null);
      setView("builder");
      setBuilderTab("search");
    } catch (reason) {
      setDetailError(
        reason instanceof Error ? reason.message : "Similar-people search failed.",
      );
    } finally {
      setFindingSimilar(false);
    }
  }

  async function submitRename(audience: Audience) {
    if (renamingRef.current) return;
    const name = (renameDraft ?? "").trim();
    if (!name || name === audience.name) {
      setRenameDraft(null);
      return;
    }
    renamingRef.current = true;
    setRenaming(true);
    setDetailError(null);
    try {
      const updated = await renameAudience(audience.id, name);
      setSelectedAudience(updated);
      setRenameDraft(null);
      setAudiences(await listAudiences());
    } catch (reason) {
      setRenameDraft(null);
      setDetailError(reason instanceof Error ? reason.message : "The rename failed.");
    } finally {
      renamingRef.current = false;
      setRenaming(false);
    }
  }

  function handleLeadUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importLeadFile(file);
  }

  /* Drag-and-drop: any .csv dropped anywhere on the builder workbench runs
     the same import as the upload card. */
  function handleBuilderDrop(event: React.DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = [...(event.dataTransfer?.files ?? [])].find((f) =>
      f.name.toLowerCase().endsWith(".csv"),
    );
    if (file) void importLeadFile(file);
    else setImportNotice({ kind: "error", message: "Drop a .csv file." });
  }

  async function importLeadFile(file: File) {
    if (importing) return;
    setImporting(true);
    setImportNotice(null);
    try {
      const result = await uploadLeadList(file, importName);
      setImportNotice(summarizeLeadImport(result));
      const audience = result.audience;
      if (audience) {
        // The upload created or refreshed an audience: land the reader on the
        // library with that audience open, so the import visibly changes the
        // page it happened on.
        setView("library");
        void openAudience(audience.id);
        try {
          setAudiences(await listAudiences());
        } catch {
          // The import itself succeeded; a failed library refresh must not
          // repaint the outcome as an error.
        }
      }
    } catch (reason) {
      setImportNotice({
        kind: "error",
        message: reason instanceof Error ? reason.message : "The CSV could not be imported.",
      });
    } finally {
      setImporting(false);
    }
  }

  async function saveAudience() {
    if (selectedRecords.size === 0 || !results) return;
    if (!growTarget && !name.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const selected = results.candidates.filter((candidate) =>
        selectedRecords.has(candidate.providerRecordId),
      );
      if (growTarget) {
        // Growing an existing audience: additive save, back to its detail.
        const grown = await growAudience(growTarget.id, {
          providerRecordIds: selected
            .filter((candidate) => candidate.leadId === null)
            .map((candidate) => candidate.providerRecordId),
          leadIds: selected.flatMap((candidate) =>
            candidate.leadId ? [candidate.leadId] : [],
          ),
        });
        setAudiences(await listAudiences());
        setSelectedAudience(grown);
        setGrowTarget(null);
        setResults(null);
        setSelectedRecords(new Set());
        setView("library");
        return;
      }
      const created = await createAudience({
        name: name.trim(),
        description: description.trim(),
        sourceProvider: results.provider,
        discoveryFilters: filters,
        leadIds: selected.flatMap((candidate) => candidate.leadId ? [candidate.leadId] : []),
        providerRecordIds: selected
          .filter((candidate) => candidate.leadId === null)
          .map((candidate) => candidate.providerRecordId),
      });
      setAudiences((current) => [created, ...current]);
      setSelectedAudience(created);
      writeAudienceParam(created.id);
      setView("library");
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : "The audience could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  /* Arm-then-confirm (ux-principles rule 9): the first press turns the icon
     into a labeled confirm, the second deletes; the armed state self-disarms. */
  async function removeAudience() {
    if (!selectedAudience || deleting) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setConfirmDelete(false);
    setDeleting(true);
    setDetailError(null);
    try {
      await deleteAudience(selectedAudience.id);
      setAudiences((current) => current.filter((item) => item.id !== selectedAudience.id));
      closeAudience();
    } catch (reason) {
      setDetailError(reason instanceof Error ? reason.message : "The audience could not be deleted.");
    } finally {
      setDeleting(false);
    }
  }

  if (view === "builder") {
    const hasSearchFilter = Object.values(filters).some((value) => value.trim());
    const providerReady = !providerStatusLoading && activeProvider?.configured === true;
    const searchDisabledReason = providerStatusLoading
      ? "Checking the lead search connection"
      : !activeProvider?.configured
        ? "Lead search isn't set up for this workspace yet. Upload a CSV instead"
        : !hasSearchFilter
          ? "Describe who you're looking for first"
          : null;
    const saveDisabledReason =
      !results || results.candidates.length === 0
        ? "Run a search or upload a CSV first"
        : selectedRecords.size === 0
          ? "Select people in the results first"
          : !growTarget && !name.trim()
            ? "Name the audience in the Details tab first"
            : null;
    const needsNameOnly =
      selectedRecords.size > 0 && !growTarget && !name.trim();
    const allVisibleSelected =
      visibleCandidates.length > 0 &&
      visibleCandidates.every((candidate) => selectedRecords.has(candidate.providerRecordId));
    return (
      <section
        className={`audience-builder-workbench ${dragActive ? "is-dropping" : ""}`}
        aria-labelledby="audience-builder-heading"
        onDragOver={(e) => {
          if ([...(e.dataTransfer?.items ?? [])].some((i) => i.kind === "file")) {
            e.preventDefault();
            setDragActive(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragActive(false);
        }}
        onDrop={handleBuilderDrop}
      >
        {dragActive && (
          <div className="audience-dropzone-overlay" aria-hidden="true">
            Drop CSV to import leads
          </div>
        )}
        <input ref={uploadInputRef} hidden type="file" accept=".csv,text/csv" onChange={handleLeadUpload} disabled={importing} />
        <div className="audience-builder-canvas">
          <header className="audience-builder-bar">
            <button className="audience-builder-back" type="button" onClick={() => { setGrowTarget(null); setView("library"); }} aria-label="Back to audiences">
              <BackIcon size={16} />
            </button>
            <div>
              <h1 id="audience-builder-heading">{name.trim() || "Untitled audience"}</h1>
              {/* Honest counts (rule 13): while the table filter narrows the
                  view, the line reads shown-of-total, never a bare total. */}
              <span>
                {results
                  ? resultQuery.trim()
                    ? `${visibleCandidates.length.toLocaleString()} of ${results.candidates.length.toLocaleString()} results`
                    : `${results.candidates.length.toLocaleString()} results`
                  : "New audience"}
              </span>
            </div>
            <label className="audience-result-search">
              <SearchIcon size={15} />
              <span className="audience-visually-hidden">Search results</span>
              <input
                type="search"
                value={resultQuery}
                onChange={(event) => setResultQuery(event.target.value)}
                placeholder="Search by name, title, or company"
                disabled={!results}
                title={results ? undefined : "Filters the results once a search has run"}
              />
            </label>
            {selectedRecords.size > 0 && <span className="audience-selection-count">{selectedRecords.size.toLocaleString()} selected</span>}
          </header>

          <div className="audience-results audience-results-canvas" aria-live="polite" aria-busy={discovering}>
            {importNotice && <ImportNoticeCard notice={importNotice} banner />}
            {discovering ? (
              <>
                <DiscoveryNarration />
                <div className="audience-table-loading" aria-hidden="true">
                  <span className="is-head" />
                  {Array.from({ length: 8 }, (_, index) => <span key={index} />)}
                </div>
              </>
            ) : !results ? (
              /* Two co-equal ways to start an audience, in the canvas itself:
                 describe the people you want, or bring your own CSV. */
              <div className="audience-start">
                <div className="audience-start-lede">
                  <h2>Two ways to fill this audience</h2>
                  <p>Run a people search, or upload a list you already have.</p>
                </div>
                <div className="audience-start-grid">
                  <form className="audience-start-card" onSubmit={runDiscovery}>
                    <span className="audience-start-icon" aria-hidden="true"><SearchIcon size={19} /></span>
                    <h3>Describe who you're looking for</h3>
                    <p>
                      {providerReady || providerStatusLoading
                        ? "Lead search turns a plain description into a list of people to review."
                        : "Lead search isn't set up for this workspace yet. Upload a CSV instead."}
                    </p>
                    <div className="audience-start-search">
                      <input
                        aria-label="Describe who you're looking for"
                        value={filters.prompt}
                        onChange={(event) => setFilters({ ...filters, prompt: event.target.value })}
                        placeholder="Founders at seed-stage B2B SaaS companies"
                        disabled={providerStatusLoading || !activeProvider?.configured}
                      />
                      <button
                        type="submit"
                        disabled={discovering || searchDisabledReason !== null}
                        title={searchDisabledReason ?? undefined}
                      >
                        Find leads
                      </button>
                    </div>
                    {searchError && <div className="audience-error audience-start-error" role="alert">{searchError}</div>}
                  </form>
                  <div className="audience-start-card">
                    <span className="audience-start-icon" aria-hidden="true"><UploadIcon size={19} /></span>
                    <h3>Upload a CSV</h3>
                    <p>Every row needs a company; name, title, and email help. The audience is named after the file.</p>
                    <button
                      className="audience-upload-target"
                      type="button"
                      onClick={() => uploadInputRef.current?.click()}
                      disabled={importing}
                      title={importing ? "Import in progress" : undefined}
                    >
                      <UploadIcon size={15} /> {importing ? "Importing…" : "Choose a CSV file"}
                      <small>or drag and drop it anywhere on this page</small>
                    </button>
                    <input
                      className="audience-upload-name"
                      type="text"
                      value={importName}
                      onChange={(e) => setImportName(e.target.value)}
                      placeholder="Audience name (optional)"
                      aria-label="Audience name for CSV upload"
                      disabled={importing}
                    />
                  </div>
                </div>
              </div>
            ) : results.candidates.length === 0 ? (
              <div className="audience-state audience-builder-empty"><AudienceIcon size={24} /><h2>No matching leads</h2><p>Adjust a criterion and search again.</p></div>
            ) : visibleCandidates.length === 0 ? (
              <div className="audience-state audience-builder-empty"><SearchIcon size={23} /><h2>No results match</h2><p>Clear the table search to see all discovered people.</p></div>
            ) : (
              <div className="audience-table-wrap">
                <table className="audience-table">
                  <thead><tr><th scope="col"><label className="audience-check"><input type="checkbox" checked={allVisibleSelected} onChange={() => setSelectedRecords((current) => {
                    const next = new Set(current);
                    for (const candidate of visibleCandidates) {
                      if (allVisibleSelected) next.delete(candidate.providerRecordId);
                      else next.add(candidate.providerRecordId);
                    }
                    return next;
                  })} aria-label="Select all visible leads" /><span aria-hidden="true">{allVisibleSelected && <CheckIcon size={14} />}</span></label></th><th scope="col">Name</th><th scope="col">Company</th><th scope="col">Job title</th><th scope="col">Contact</th><th scope="col">Stage</th></tr></thead>
                  <tbody>
                    {visibleCandidates.map((candidate) => {
                      const selected = selectedRecords.has(candidate.providerRecordId);
                      return (
                        <tr key={`${candidate.providerRecordId}-${candidate.leadId}`} className={selected ? "is-selected" : ""}>
                          <td><label className="audience-check"><input type="checkbox" checked={selected} onChange={() => setSelectedRecords((current) => toggleLead(current, candidate.providerRecordId))} /><span aria-hidden="true">{selected && <CheckIcon size={14} />}</span><span className="audience-visually-hidden">Select {candidate.name}</span></label></td>
                          <td><strong>{candidate.name}</strong></td>
                          <td>{candidate.company}</td>
                          <td>{candidate.title}</td>
                          <td><span>{candidate.email}</span>{candidate.linkedinUrl && <a href={candidate.linkedinUrl} target="_blank" rel="noreferrer">LinkedIn</a>}</td>
                          <td><span className="audience-stage">{stageLabel(candidate.stage)}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <aside className="audience-search-panel" aria-label="Audience builder">
          <div className="audience-panel-tabs" role="tablist" aria-label="Audience controls">
            <button id="audience-search-tab" type="button" role="tab" aria-controls="audience-search-panel" aria-selected={builderTab === "search"} className={builderTab === "search" ? "is-active" : ""} onClick={() => setBuilderTab("search")}>Search</button>
            <button id="audience-details-tab" type="button" role="tab" aria-controls="audience-details-panel" aria-selected={builderTab === "details"} className={builderTab === "details" ? "is-active" : ""} onClick={() => setBuilderTab("details")}>Details</button>
          </div>

          {builderTab === "search" ? (
            <form id="audience-search-panel" className="audience-search-form" role="tabpanel" aria-labelledby="audience-search-tab" onSubmit={runDiscovery}>
              <div className="audience-search-panel-head">
                <div className="audience-search-title">
                  <AudienceIcon size={18} />
                  <h2>Find people</h2>
                </div>
              </div>

              {/* A healthy search needs no status chip; only the absence of
                  the capability is worth a line (ux-principles rule 18). */}
              {!providerStatusLoading && activeProvider?.configured === false && (
                <p className="audience-search-offline">
                  Lead search isn't set up for this workspace yet. Upload a CSV instead.
                </p>
              )}

              <div className="audience-query-box">
                <SearchIcon size={17} />
                <input aria-label="Describe who you're looking for" value={filters.prompt} onChange={(event) => setFilters({ ...filters, prompt: event.target.value })} placeholder="Describe who you're looking for" />
                <button
                  type="submit"
                  aria-label="Run lead search"
                  disabled={discovering || searchDisabledReason !== null}
                  title={searchDisabledReason ?? undefined}
                >
                  <ArrowIcon size={15} />
                </button>
              </div>

              {/* With no results the start card owns the search entry and its
                  error; once results exist the rail is where retries happen. */}
              {searchError && results && <div className="audience-error audience-panel-error" role="alert">{searchError}</div>}

              <div className="audience-search-examples" aria-label="Example searches">
                <button type="button" onClick={() => setFilters({ ...EMPTY_FILTERS, prompt: "Founders at seed-stage B2B SaaS companies in the US" })}><SearchIcon size={13} /> Founders at seed-stage B2B SaaS companies in the US</button>
                <button type="button" onClick={() => setFilters({ ...EMPTY_FILTERS, prompt: "QA leaders at Series A consumer software companies" })}><SearchIcon size={13} /> QA leaders at Series A consumer software companies</button>
              </div>

              <div className="audience-panel-search-action">
                <button
                  className="audience-secondary"
                  type="submit"
                  disabled={discovering || searchDisabledReason !== null}
                  title={searchDisabledReason ?? undefined}
                >
                  {discovering ? "Searching…" : results ? "Update search" : "Find leads"}
                </button>
              </div>
            </form>
          ) : (
            <div id="audience-details-panel" className="audience-list-details-panel" role="tabpanel" aria-labelledby="audience-details-tab">
              <h2>Audience details</h2>
              <label><span>Audience name</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Qualified founders" maxLength={255} /></label>
              <label><span>Description <small>Optional</small></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Who belongs in this audience" maxLength={20000} rows={4} /></label>
              <dl><div><dt>Source</dt><dd>{results ? providerLabel(results.provider) : "Lead search"}</dd></div><div><dt>Selected</dt><dd>{selectedRecords.size.toLocaleString()}</dd></div><div><dt>Results</dt><dd>{(results?.candidates.length ?? 0).toLocaleString()}</dd></div></dl>
            </div>
          )}

          <footer className="audience-panel-footer">
            {saveError && <div className="audience-error audience-footer-error" role="alert">{saveError}</div>}
            {needsNameOnly && builderTab === "search" && (
              <p className="audience-footer-hint">
                Name it in the{" "}
                <button type="button" onClick={() => setBuilderTab("details")}>Details tab</button>
                {" "}to save.
              </p>
            )}
            <button
              className="audience-primary"
              type="button"
              onClick={saveAudience}
              disabled={saving || saveDisabledReason !== null}
              title={saving ? undefined : saveDisabledReason ?? undefined}
            >
              <CheckIcon size={16} /> {saving ? "Saving…" : selectedRecords.size > 0 ? `Save ${selectedRecords.size.toLocaleString()} to audience` : "Save to audience"}
            </button>
          </footer>
        </aside>
      </section>
    );
  }

  /* Tags ride under the heading as chips; editing them is one quiet control
     away rather than a form that is always open. */
  const tagEditor = selectedAudience && ((selectedAudience.tags?.length ?? 0) > 0 || canWrite) && (
    <div className="audience-tag-line">
      {selectedAudience.tags?.map((tag) => <small key={tag}>{tag}</small>)}
      {canWrite && !tagsOpen && (
        <button type="button" className="audience-quiet" onClick={() => { setTagDraft((selectedAudience.tags ?? []).join(", ")); setTagsOpen(true); }}>
          {(selectedAudience.tags?.length ?? 0) > 0 ? "Edit tags" : "Add tags"}
        </button>
      )}
      {canWrite && tagsOpen && <form key={selectedAudience.id} onSubmit={async (event) => {
        event.preventDefault(); if (tagsBusy) return; setTagsBusy(true); setSaveError(null);
        const tags = [...new Set(tagDraft.split(',').map((t) => t.trim()).filter(Boolean))];
        try { const saved = await saveAudienceTags(selectedAudience.id, tags); setSelectedAudience(saved); setAudiences((rows) => rows.map((a) => a.id === saved.id ? saved : a)); setTagsOpen(false); }
        catch (reason) { setSaveError(reason instanceof Error ? reason.message : "Could not save tags."); }
        finally { setTagsBusy(false); }
      }}><input aria-label="Audience tags" autoFocus placeholder="Tags, separated by commas" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setTagsOpen(false); }} /><button className="audience-secondary" disabled={tagsBusy} title={tagsBusy ? "Saving tags" : undefined}>{tagsBusy ? "Saving…" : "Save"}</button><button type="button" className="audience-quiet" onClick={() => setTagsOpen(false)} disabled={tagsBusy}>Cancel</button></form>}
    </div>
  );

  if (detailLoading || detailFailedId || selectedAudience) {
    return (
      <div className="audience-page">
        {detailLoading ? (
          /* Mirrors the loaded detail: back link, head block, table rows. */
          <div className="audience-detail-skeleton" role="status" aria-label="Loading audience">
            <span className="audience-skeleton-head" aria-hidden="true"><span /><span /><span /></span>
            <span className="audience-skeleton-strip" aria-hidden="true" />
            {Array.from({ length: 6 }, (_, index) => (
              <span key={index} className="audience-skeleton-member" aria-hidden="true">
                <span className="audience-skeleton-dot" />
                <span className="audience-skeleton-copy"><span /><span /></span>
              </span>
            ))}
          </div>
        ) : detailFailedId ? (
          <div className="audience-state" role="alert">
            <AudienceIcon size={24} />
            <h2>This audience could not load</h2>
            <p>{detailError}</p>
            <div className="audience-state-actions">
              <button className="audience-secondary" type="button" onClick={() => void openAudience(detailFailedId)}>Try again</button>
              <button className="audience-secondary" type="button" onClick={closeAudience}>Back to audiences</button>
            </div>
          </div>
        ) : selectedAudience ? (
          <AudienceDetail
            audience={selectedAudience}
            onBack={closeAudience}
            title={canWrite && renameDraft !== null ? (
              <input
                className="audience-rename-input"
                value={renameDraft}
                autoFocus
                aria-label="Audience name"
                disabled={renaming}
                onChange={(e) => setRenameDraft(e.target.value)}
                onBlur={() => void submitRename(selectedAudience)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitRename(selectedAudience);
                  if (e.key === "Escape") setRenameDraft(null);
                }}
              />
            ) : (
              <h1 id="audience-detail-heading">
                {selectedAudience.name}
                {canWrite && (
                  <button
                    className="audience-rename-button"
                    type="button"
                    aria-label={`Rename ${selectedAudience.name}`}
                    disabled={renaming}
                    title={renaming ? "Renaming now" : undefined}
                    onClick={() => setRenameDraft(selectedAudience.name)}
                  >
                    {renaming ? "Renaming…" : "Rename"}
                  </button>
                )}
              </h1>
            )}
            actions={canWrite ? (
              <>
                <button className="audience-secondary" type="button" onClick={() => void findSimilar(selectedAudience)} disabled={findingSimilar} title={findingSimilar ? "Searching for similar people" : undefined} data-testid="find-similar-people">
                  {findingSimilar ? "Searching…" : "Find similar"}
                </button>
                {confirmDelete ? (
                  <button
                    className="audience-danger-confirm"
                    type="button"
                    onClick={() => void removeAudience()}
                    onBlur={() => setConfirmDelete(false)}
                  >
                    Delete audience? Confirm
                  </button>
                ) : (
                  <button
                    className="audience-icon-button"
                    type="button"
                    onClick={() => void removeAudience()}
                    disabled={deleting}
                    aria-label={`Delete ${selectedAudience.name}`}
                    title={deleting ? "Deleting…" : "Delete this audience (its leads stay)"}
                  >
                    <TrashIcon size={17} />
                  </button>
                )}
              </>
            ) : undefined}
            tags={tagEditor}
            notices={(detailError || saveError) && (
              <div className="audience-error audience-detail-error" role="alert">{detailError ?? saveError}</div>
            )}
          />
        ) : null}
      </div>
    );
  }

  return (
    <section className="audience-page" aria-labelledby="audiences-heading">
      <header className="audience-heading">
        <h1 id="audiences-heading">Audiences</h1>
        {canWrite ? (
          <div className="audience-heading-actions">
            <button className="audience-secondary" type="button" onClick={() => uploadInputRef.current?.click()} disabled={importing} title={importing ? "Import in progress" : undefined}>
              <UploadIcon size={15} /> {importing ? "Importing…" : "Upload CSV"}
            </button>
            <button className="audience-primary" type="button" onClick={startBuilder} data-testid="new-audience"><PlusIcon size={17} /> New audience</button>
          </div>
        ) : (
          <span className="audience-read-only">Read-only access</span>
        )}
      </header>
      <input ref={uploadInputRef} hidden type="file" accept=".csv,text/csv" onChange={handleLeadUpload} />

      <SectionTabs section="audiences" active="Lists" />

      {importNotice && <ImportNoticeCard notice={importNotice} banner />}

      <div className="audience-library">
        {audiences.length > 3 && (
          <label className="audience-library-search"><SearchIcon size={16} /><span className="audience-visually-hidden">Search audiences</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search audiences or tags" /></label>
        )}
        <div className="audience-list" aria-busy={loading} aria-live="polite">
          {loading ? (
            /* Skeleton rows mirror the loaded list (rule 2) so nothing
               jumps when the audiences land. */
            <div className="audience-list-skeleton" role="status" aria-label="Loading audiences">
              {Array.from({ length: 3 }, (_, index) => (
                <span key={index} className="audience-skeleton-row" aria-hidden="true">
                  <span className="audience-skeleton-dot" />
                  <span className="audience-skeleton-copy"><span /><span /></span>
                  <span className="audience-skeleton-cell" />
                  <span className="audience-skeleton-cell" />
                </span>
              ))}
            </div>
          ) : loadFailed ? (
            <div className="audience-state" role="alert"><AudienceIcon size={24} /><h2>Audiences are unavailable</h2><p>We could not load this workspace. Try again before creating or changing an audience.</p><button className="audience-secondary" type="button" onClick={() => window.location.reload()}>Try again</button></div>
          ) : filteredAudiences.length === 0 ? (
            <div className="audience-state">
              <AudienceIcon size={24} />
              <h2>{audiences.length === 0 ? "No audiences yet" : "No audiences match"}</h2>
              <p>
                {audiences.length === 0
                  ? canWrite
                    ? "Describe who you want to reach, or upload a CSV you already have."
                    : "An owner or admin can create the first audience."
                  : "Try a broader search."}
              </p>
              {audiences.length === 0 && canWrite && (
                <div className="audience-state-actions">
                  <button className="audience-secondary" type="button" onClick={startBuilder}>Build the first audience</button>
                  <button
                    className="audience-secondary"
                    type="button"
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={importing}
                    title={importing ? "Import in progress" : undefined}
                  >
                    <UploadIcon size={14} /> {importing ? "Importing…" : "Upload a CSV"}
                  </button>
                </div>
              )}
            </div>
          ) : filteredAudiences.map((audience) => (
            <button key={audience.id} className="audience-list-row" type="button" onClick={() => void openAudience(audience.id)}>
              <span className="audience-list-icon"><AudienceIcon size={18} /></span>
              <span className="audience-list-copy"><strong>{audience.name}</strong><span>{audience.description || "No description"}</span>{(audience.tags?.length ?? 0) > 0 && <span className="audience-tags">{audience.tags?.map((tag) => <small key={tag}>{tag}</small>)}</span>}</span>
              <span className="audience-list-meta"><strong>{audience.memberCount.toLocaleString()}</strong><small>{audience.memberCount === 1 ? "person" : "people"}</small></span>
              <span className="audience-list-meta audience-source"><strong>{providerLabel(audience.sourceProvider)}</strong><small>source</small></span>
              <span className="audience-list-date"><small>Updated</small><span>{formatAudienceDate(audience.updatedAt)}</span></span>
              <ArrowIcon size={16} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/* The long search narrates in place (ux-principles rule 4): what it is doing
   now, staged by elapsed time, plus the honest caveat that the search runs
   with the page. Lives in its own component so the timer mounts with it. */
function DiscoveryNarration() {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const t = window.setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(t);
  }, []);
  const stage =
    elapsed < 4
      ? "Reading your description…"
      : elapsed < 14
        ? "Searching for matching people…"
        : elapsed < 35
          ? "Scoring and ranking the matches…"
          : "Still working. Big searches can take about a minute…";
  return (
    <p className="audience-searching" role="status">
      <span className="audience-spinner" aria-hidden="true" />
      <strong>{stage}</strong>
      <span>Keep this tab open. Leaving the page cancels the search.</span>
    </p>
  );
}

function ImportNoticeCard({
  notice,
  banner = false,
}: {
  notice: LeadImportNotice;
  banner?: boolean;
}) {
  return (
    <div
      className={`audience-import-notice${banner ? " audience-import-banner" : ""} is-${notice.kind}`}
      role={notice.kind === "error" ? "alert" : "status"}
    >
      <div className="audience-import-copy">
        <span>{notice.message}</span>
        {notice.details && notice.details.length > 0 && (
          <ul>
            {notice.details.map((detail, index) => (
              <li key={index}>{detail}</li>
            ))}
          </ul>
        )}
        {notice.hint && <small>{notice.hint}</small>}
      </div>
      {notice.kind === "success" && <a href={withMockMode("/dashboard/leads")}>View leads</a>}
    </div>
  );
}
