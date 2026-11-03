import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  Copy,
  Disc3,
  FolderOpen,
  Headphones,
  MoreHorizontal,
  Music2,
  Plus,
  Search,
  Settings2,
  ShoppingBag,
  X,
} from "lucide-react";
import type {
  CreateReleaseInput,
  ProjectAsset,
  Release,
  ReleaseType,
  SongSession,
  UpdateReleaseInput,
} from "@shared/types";
import prismLogo from "../assets/prism-logo.png";
import { ThemeShop } from "./ThemeShop";
import { AppearanceSettings } from "./AppearanceSettings";

type Tab = "projects" | "shop";

type LibraryProps = {
  releases: Release[];
  currentTab: Tab;
  onTabChange: (tab: Tab) => void;
  onCreateRelease: (input: CreateReleaseInput, artworkId: string | null) => Promise<Release>;
  onUpdateRelease: (releaseId: string, input: UpdateReleaseInput) => Promise<void>;
  onDeleteRelease: (releaseId: string) => Promise<void>;
  onDuplicateRelease: (releaseId: string) => Promise<void>;
  onOpenRelease: (release: Release) => void;
  onOpenSong: (session: SongSession) => void;
  onRefresh: () => Promise<void>;
  onSettings: () => void;
  releaseDetail?: { release: Release; songs: SongSession[] } | null;
  onBackToLibrary?: () => void;
  onAddSong?: (releaseId: string, title: string) => Promise<void>;
  onRenameSong?: (sessionId: string, title: string) => Promise<void>;
  onDuplicateSong?: (sessionId: string) => Promise<void>;
  onDeleteSong?: (sessionId: string) => Promise<void>;
  onReorderSongs?: (releaseId: string, songIds: string[]) => Promise<void>;
  busyAction?: boolean;
};

const releaseTypes: ReleaseType[] = ["Single", "EP", "Album", "LP", "Other"];

export function LibraryScreen(props: LibraryProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All releases");
  const [sort, setSort] = useState("recent");
  const [createOpen, setCreateOpen] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return [...props.releases]
      .filter((release) => {
        const matchesQuery =
          !query ||
          release.title.toLocaleLowerCase().includes(query) ||
          release.artistName.toLocaleLowerCase().includes(query);
        return matchesQuery && (filter === "All releases" || release.releaseType === filter);
      })
      .sort((a, b) => {
        if (sort === "alphabetical") return a.title.localeCompare(b.title);
        if (sort === "created") return b.createdAt.localeCompare(a.createdAt);
        return (b.lastOpenedAt ?? b.updatedAt).localeCompare(a.lastOpenedAt ?? a.updatedAt);
      });
  }, [props.releases, search, filter, sort]);

  const createRelease = async (input: CreateReleaseInput, artworkId: string | null) => {
    setError("");
    try {
      const release = await props.onCreateRelease(input, artworkId);
      setCreateOpen(false);
      if (release.releaseType !== "Single") props.onOpenRelease(release);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The release could not be created.");
      throw cause;
    }
  };

  const deleteRelease = async (release: Release) => {
    setOpenMenuId(null);
    if (!window.confirm(`Delete “${release.title}” and all of its song sessions? This cannot be undone.`)) return;
    try {
      await props.onDeleteRelease(release.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The release could not be deleted.");
    }
  };

  if (props.releaseDetail && props.onBackToLibrary) {
    return (
      <ReleaseOverview
        release={props.releaseDetail.release}
        songs={props.releaseDetail.songs}
        onBack={props.onBackToLibrary}
        onOpenSong={props.onOpenSong}
        onAddSong={props.onAddSong ?? (async () => {})}
        onRenameSong={props.onRenameSong ?? (async () => {})}
        onDuplicateSong={props.onDuplicateSong ?? (async () => {})}
        onDeleteSong={props.onDeleteSong ?? (async () => {})}
        onReorderSongs={props.onReorderSongs ?? (async () => {})}
        onUpdateRelease={props.onUpdateRelease}
        onSettings={props.onSettings}
        busy={props.busyAction ?? false}
      />
    );
  }

  const shop = props.currentTab === "shop";
  return (
    <main className="library-page">
      <header className="app-header">
        <div className="brand-lockup" aria-label="PRISM">
          <img className="prism-logo" src={prismLogo} alt="" />
          <span className="brand-word">PRISM</span>
        </div>
        <nav className="primary-nav" aria-label="Main navigation">
          <button className={!shop ? "nav-item active" : "nav-item"} onClick={() => props.onTabChange("projects")}>
            <FolderOpen size={16} /> Projects
          </button>
          <button className={shop ? "nav-item active" : "nav-item"} onClick={() => props.onTabChange("shop")}>
            <ShoppingBag size={16} /> Shop
          </button>
        </nav>
        <div className="header-actions">
          <button className="icon-button" aria-label="Settings" title="Settings" onClick={props.onSettings}>
            <Settings2 size={18} />
          </button>
          {!shop && <button className="button button-primary header-new" onClick={() => setCreateOpen(true)}><Plus size={16} /> New Project</button>}
        </div>
      </header>

      {shop ? (
        <ThemeShop />
      ) : (
        <section className="library-content">
          <div className="library-heading">
            <div>
              <span className="eyebrow">Your studio</span>
              <h1>Your Projects</h1>
              <p>Pick up where you left off.</p>
            </div>
            <button className="button button-primary mobile-new" onClick={() => setCreateOpen(true)}><Plus size={16} /> New Project</button>
          </div>

          <div className="library-toolbar">
            <label className="search-field">
              <Search size={16} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search projects or artists" />
              {search && <button className="clear-search" aria-label="Clear search" onClick={() => setSearch("")}><X size={14} /></button>}
            </label>
            <div className="filter-controls">
              <label className="select-wrap">
                <select value={filter} onChange={(event) => setFilter(event.target.value)}>
                  <option>All releases</option>
                  {releaseTypes.map((type) => <option key={type}>{type}</option>)}
                </select><ChevronDown size={14} />
              </label>
              <label className="select-wrap">
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  <option value="recent">Recently opened</option>
                  <option value="created">Recently created</option>
                  <option value="alphabetical">Alphabetical</option>
                </select><ChevronDown size={14} />
              </label>
            </div>
          </div>

          {error && <div className="inline-error" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss"><X size={14} /></button></div>}

          {filtered.length > 0 ? (
            <div className="project-grid">
              {filtered.map((release) => (
                <article
                  key={release.id}
                  className="project-item"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${release.title}, ${release.releaseType}`}
                  onClick={() => props.onOpenRelease(release)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      props.onOpenRelease(release);
                    }
                  }}
                >
                  <ProjectArtwork release={release} />
                  <div className="project-caption">
                    <div className="project-title-row">
                      <h2 title={release.title}>{release.title}</h2>
                      <button
                        className="project-menu-button"
                        title={`Actions for ${release.title}`}
                        aria-label={`Actions for ${release.title}`}
                        aria-expanded={openMenuId === release.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenMenuId(openMenuId === release.id ? null : release.id);
                        }}
                      ><MoreHorizontal size={19} /></button>
                      {openMenuId === release.id && (
                        <div className="context-menu" onClick={(event) => event.stopPropagation()}>
                          <button onClick={() => {
                            setOpenMenuId(null);
                            const title = window.prompt("Rename release", release.title);
                            if (title?.trim()) void props.onUpdateRelease(release.id, { title: title.trim() }).catch((cause) => setError(String(cause)));
                          }}>Rename</button>
                          <button onClick={() => {
                            setOpenMenuId(null);
                            void window.prism.chooseArtwork(release.id).then(props.onRefresh).catch((cause) => setError(String(cause)));
                          }}>Change artwork</button>
                          <button onClick={() => {
                            setOpenMenuId(null);
                            void props.onDuplicateRelease(release.id).catch((cause) => setError(String(cause)));
                          }}>Duplicate project</button>
                          <button className="danger-menu-item" onClick={() => void deleteRelease(release)}>Delete project</button>
                        </div>
                      )}
                    </div>
                    <p>{release.releaseType === "Other" ? release.customReleaseType || "Other" : release.releaseType}{release.releaseType !== "Single" ? ` · ${release.songIds.length} ${release.songIds.length === 1 ? "song" : "songs"}` : ""}</p>
                    {release.artistName && <span className="project-artist">{release.artistName}</span>}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-library">
              <div className="empty-icon"><Disc3 size={25} /></div>
              <h2>{props.releases.length === 0 ? "Your next idea starts here." : "No projects found."}</h2>
              <p>{props.releases.length === 0 ? "Create a release to give your music a home." : "Try another title or adjust your filters."}</p>
              {props.releases.length === 0 ? <button className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={16} /> Create your first project</button> : <button className="button button-quiet" onClick={() => { setSearch(""); setFilter("All releases"); }}>Clear filters</button>}
            </div>
          )}
        </section>
      )}

      {createOpen && <CreateReleaseDialog onClose={() => setCreateOpen(false)} onCreate={createRelease} />}
    </main>
  );
}

function ProjectArtwork({ release }: { release: Release }) {
  const imageUrl = release.artworkAssetId ? window.prism.assetUrl(release.artworkAssetId) : "";
  return (
    <div className={`project-artwork ${imageUrl ? "has-artwork" : ""}`}>
      {imageUrl ? <img src={imageUrl} alt={`${release.title} cover artwork`} /> : (
        <div className="artwork-placeholder" aria-hidden="true">
          <div className="placeholder-orbit orbit-one" /><div className="placeholder-orbit orbit-two" />
          <Music2 size={28} strokeWidth={1.25} />
        </div>
      )}
      <span className="artwork-open-hint"><Headphones size={15} /> Open project</span>
    </div>
  );
}

function CreateReleaseDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: CreateReleaseInput, artworkId: string | null) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [artistName, setArtistName] = useState("");
  const [releaseType, setReleaseType] = useState<ReleaseType>("Single");
  const [customReleaseType, setCustomReleaseType] = useState("");
  const [description, setDescription] = useState("");
  const [artwork, setArtwork] = useState<ProjectAsset | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setError("Add a working title for this release.");
    if (releaseType === "Other" && !customReleaseType.trim()) return setError("Enter the custom release type.");
    setPending(true);
    setError("");
    try {
      await onCreate({ title, artistName, releaseType, customReleaseType, description }, artwork?.id ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The release could not be created.");
    } finally {
      setPending(false);
    }
  };

  const chooseArtwork = async () => {
    setError("");
    try {
      setArtwork(await window.prism.selectArtwork());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Artwork could not be loaded.");
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !pending && onClose()}>
      <section className="modal-panel create-modal" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <div className="modal-heading">
          <div><span className="eyebrow">Start something new</span><h2 id="create-title">New Project</h2></div>
          <button className="icon-button" onClick={onClose} disabled={pending} aria-label="Close"><X size={18} /></button>
        </div>
        <form onSubmit={(event) => void submit(event)}>
          <div className="cover-picker-row">
            <button type="button" className="cover-picker" onClick={() => void chooseArtwork()} aria-label="Choose project artwork">
              {artwork ? <img src={window.prism.assetUrl(artwork.id)} alt="Selected project cover" /> : <div className="cover-picker-empty"><Plus size={18} /><span>Add cover</span></div>}
            </button>
            <div><strong>Release artwork</strong><p>Square PNG, JPEG, or WebP · up to 20 MB</p><button type="button" className="text-button" onClick={() => void chooseArtwork()}>{artwork ? "Replace artwork" : "Choose image"}</button></div>
          </div>
          <label className="form-field"><span>Working title <b>*</b></span><input autoFocus maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Give this release a name" required /></label>
          <label className="form-field"><span>Artist or band <small>Optional</small></span><input maxLength={120} value={artistName} onChange={(event) => setArtistName(event.target.value)} placeholder="Artist name" /></label>
          <div className="form-row">
            <label className="form-field"><span>Release type <b>*</b></span><select value={releaseType} onChange={(event) => setReleaseType(event.target.value as ReleaseType)}>{releaseTypes.map((type) => <option key={type}>{type}</option>)}</select></label>
            {releaseType === "Other" && <label className="form-field"><span>Custom type <b>*</b></span><input value={customReleaseType} onChange={(event) => setCustomReleaseType(event.target.value)} placeholder="e.g. Demo" required /></label>}
          </div>
          <label className="form-field"><span>Description <small>Optional</small></span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={2} placeholder="A note about this release" /></label>
          {error && <div className="inline-error" role="alert">{error}</div>}
          <div className="modal-actions"><button className="button button-quiet" type="button" onClick={onClose} disabled={pending}>Cancel</button><button className="button button-primary" type="submit" disabled={pending}>{pending ? "Creating…" : "Create Project"}</button></div>
        </form>
      </section>
    </div>
  );
}

function ReleaseOverview({
  release,
  songs,
  onBack,
  onOpenSong,
  onAddSong,
  onRenameSong,
  onDuplicateSong,
  onDeleteSong,
  onReorderSongs,
  onUpdateRelease,
  onSettings,
  busy,
}: {
  release: Release;
  songs: SongSession[];
  onBack: () => void;
  onOpenSong: (session: SongSession) => void;
  onAddSong: (releaseId: string, title: string) => Promise<void>;
  onRenameSong: (sessionId: string, title: string) => Promise<void>;
  onDuplicateSong: (sessionId: string) => Promise<void>;
  onDeleteSong: (sessionId: string) => Promise<void>;
  onReorderSongs: (releaseId: string, ids: string[]) => Promise<void>;
  onUpdateRelease: (releaseId: string, input: UpdateReleaseInput) => Promise<void>;
  onSettings: () => void;
  busy: boolean;
}) {
  const [error, setError] = useState("");
  const [addSongOpen, setAddSongOpen] = useState(false);
  const [newSongTitle, setNewSongTitle] = useState("");
  const [addingSong, setAddingSong] = useState(false);
  const orderedSongs = release.songIds.map((id) => songs.find((song) => song.id === id)).filter((song): song is SongSession => !!song);
  const openAddSong = () => {
    setError("");
    setNewSongTitle("");
    setAddSongOpen(true);
  };
  const submitSong = async (event: FormEvent) => {
    event.preventDefault();
    if (!newSongTitle.trim()) {
      setError("Enter a song title.");
      return;
    }
    setAddingSong(true);
    setError("");
    try {
      await onAddSong(release.id, newSongTitle.trim());
      setAddSongOpen(false);
      setNewSongTitle("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The song could not be added.");
    } finally {
      setAddingSong(false);
    }
  };
  const moveSong = async (index: number, direction: -1 | 1) => {
    const ids = [...release.songIds];
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try { await onReorderSongs(release.id, ids); } catch (cause) { setError(String(cause)); }
  };
  const changeArtwork = async () => {
    try {
      const updated = await window.prism.chooseArtwork(release.id);
      if (updated) await onUpdateRelease(release.id, { artworkAssetId: updated.artworkAssetId });
    } catch (cause) { setError(String(cause)); }
  };

  return (
    <main className="release-page">
      <header className="app-header">
        <div className="brand-lockup"><img className="prism-logo" src={prismLogo} alt="" /><span className="brand-word">PRISM</span></div>
        <div className="release-header-path"><button className="text-button" onClick={onBack}>Projects</button><span>/</span><span>{release.title}</span></div>
        <div className="header-actions"><button className="icon-button" title="Settings" aria-label="Settings" onClick={onSettings}><Settings2 size={18} /></button></div>
      </header>
      <section className="release-content">
        <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> All projects</button>
        <div className="release-hero">
          <button className="release-cover" onClick={() => void changeArtwork()} title="Change artwork">
            {release.artworkAssetId ? <img src={window.prism.assetUrl(release.artworkAssetId)} alt={`${release.title} cover artwork`} /> : <div className="artwork-placeholder"><div className="placeholder-orbit orbit-one" /><div className="placeholder-orbit orbit-two" /><Music2 size={32} /></div>}
            <span>Change artwork</span>
          </button>
          <div className="release-details">
            <span className="eyebrow">{release.releaseType === "Other" ? release.customReleaseType || "Other" : release.releaseType} release</span>
            <h1>{release.title}</h1>
            <p className="release-artist">{release.artistName || "Artist not set"}</p>
            {release.description && <p className="release-description">{release.description}</p>}
            <div className="release-meta">{orderedSongs.length} {orderedSongs.length === 1 ? "song" : "songs"}<span />Saved on this device</div>
            <div className="release-actions">
              <button className="button button-primary" data-testid="button-add-song" onClick={openAddSong} disabled={busy}><Plus size={16} /> Add Song</button>
              <button className="button button-quiet" onClick={() => {
                const title = window.prompt("Rename release", release.title);
                if (title?.trim()) void onUpdateRelease(release.id, { title: title.trim() }).catch((cause) => setError(String(cause)));
              }}>Edit details</button>
            </div>
          </div>
        </div>
        <div className="tracklist-heading"><div><span className="eyebrow">Release contents</span><h2>Songs</h2></div><button className="text-button" onClick={openAddSong}><Plus size={15} /> Add song</button></div>
        {error && <div className="inline-error" role="alert">{error}<button onClick={() => setError("")}><X size={14} /></button></div>}
        {orderedSongs.length ? (
          <div className="release-track-list">
            {orderedSongs.map((song, index) => (
              <div className="release-track-row" key={song.id}>
                <span className="track-number">{String(index + 1).padStart(2, "0")}</span>
                <div className="track-title-cell"><button className="track-open" onClick={() => onOpenSong(song)}><Music2 size={16} /><span>{song.title}</span></button><small>{song.tracks.some((track) => track.clips.length) ? "Session has audio" : "Empty session"}</small></div>
                <span className="track-duration">{formatDuration(song.tracks.flatMap((track) => track.clips).reduce((max, clip) => Math.max(max, clip.startSeconds + clip.durationSeconds), 0))}</span>
                <div className="track-row-actions">
                  <button className="icon-button compact" aria-label={`Move ${song.title} up`} disabled={index === 0} onClick={() => void moveSong(index, -1)}><ArrowUp size={15} /></button>
                  <button className="icon-button compact" aria-label={`Move ${song.title} down`} disabled={index === orderedSongs.length - 1} onClick={() => void moveSong(index, 1)}><ArrowDown size={15} /></button>
                  <button className="icon-button compact" aria-label={`Rename ${song.title}`} onClick={() => {
                    const title = window.prompt("Rename song", song.title);
                    if (title?.trim()) void onRenameSong(song.id, title.trim()).catch((cause) => setError(String(cause)));
                  }}><MoreHorizontal size={16} /></button>
                  <button className="icon-button compact" aria-label={`Duplicate ${song.title}`} onClick={() => void onDuplicateSong(song.id).catch((cause) => setError(String(cause)))}><Copy size={14} /></button>
                  <button className="icon-button compact danger-hover" aria-label={`Remove ${song.title}`} onClick={() => {
                    if (window.confirm(`Remove “${song.title}” and its arrangement from this release? Its original audio files will remain in PRISM's local data folder.`)) void onDeleteSong(song.id).catch((cause) => setError(String(cause)));
                  }} title="Remove song from release"><X size={15} /></button>
                  <button className="button button-open-track" onClick={() => onOpenSong(song)}>Open <ArrowLeft className="open-arrow" size={13} /></button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-tracks"><Disc3 size={24} /><strong>This release is ready for its first song.</strong><span>Add a song to create an independent session.</span><button className="button button-quiet" onClick={openAddSong}><Plus size={15} /> Add Song</button></div>
        )}
      </section>
      {addSongOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !addingSong && setAddSongOpen(false)}>
        <section className="modal-panel create-modal" role="dialog" aria-modal="true" aria-labelledby="add-song-title">
          <div className="modal-heading">
            <div><span className="eyebrow">Add to {release.title}</span><h2 id="add-song-title">New Song</h2></div>
            <button className="icon-button" onClick={() => setAddSongOpen(false)} disabled={addingSong} aria-label="Close"><X size={18} /></button>
          </div>
          <form onSubmit={(event) => void submitSong(event)}>
            <label className="form-field"><span>Song title <b>*</b></span><input autoFocus maxLength={120} value={newSongTitle} onChange={(event) => setNewSongTitle(event.target.value)} placeholder="Name this song" required /></label>
            {error && <div className="inline-error" role="alert">{error}</div>}
            <div className="modal-actions">
              <button className="button button-quiet" type="button" onClick={() => setAddSongOpen(false)} disabled={addingSong}>Cancel</button>
              <button className="button button-primary" type="submit" disabled={addingSong}>{addingSong ? "Adding…" : "Add Song"}</button>
            </div>
          </form>
        </section>
      </div>}
    </main>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const minutes = Math.floor(seconds / 60);
  const remaining = Math.floor(seconds % 60);
  return `${minutes}:${String(remaining).padStart(2, "0")}`;
}

export function SettingsDialog({ onClose, onKeyboardShortcuts }: { onClose: () => void; onKeyboardShortcuts?: () => void }) {
  const [error, setError] = useState("");
  const [section, setSection] = useState<"general" | "appearance" | "shortcuts">("general");
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); }
      if (event.key === "Tab") {
        const items = focusable();
        if (!items.length) return;
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
        else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, []);
  const [status, setStatus] = useState("");
  const createBackup = async () => {
    setError("");
    setStatus("");
    try {
      const path = await window.prism.backupLibrary();
      if (path) setStatus(`Backup saved to ${path}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The PRISM backup could not be created.");
    }
  };
  const restoreBackup = async () => {
    if (!window.confirm("Restore replaces your current PRISM projects and media. PRISM first saves a safety backup of the current data. Continue?")) return;
    setError("");
    setStatus("");
    try {
      if (await window.prism.restoreLibrary()) window.location.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The PRISM backup could not be restored.");
    }
  };
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="modal-panel settings-modal" data-testid="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1}>
        <div className="modal-heading"><div><span className="eyebrow">On this computer</span><h2 id="settings-title">Settings</h2></div><button className="icon-button" data-testid="settings-close" onClick={onClose} aria-label="Close"><X size={18} /></button></div>
        <div className="settings-tabs" role="tablist" aria-label="Settings sections">
          <button role="tab" aria-selected={section === "general"} className={section === "general" ? "active" : ""} onClick={() => setSection("general")}>General</button>
          <button role="tab" data-testid="settings-tab-appearance" aria-selected={section === "appearance"} className={section === "appearance" ? "active" : ""} onClick={() => setSection("appearance")}>Appearance</button>
          <button role="tab" aria-selected={section === "shortcuts"} className={section === "shortcuts" ? "active" : ""} onClick={() => setSection("shortcuts")}>Shortcuts</button>
        </div>
        {section === "appearance" ? <AppearanceSettings /> : <>
          {section === "shortcuts" ? <>
            <p className="settings-copy">Rebind workstation commands, inspect editor context, and check conflicting keys. Shortcut profiles stay on this computer.</p>
            <button className="button button-quiet folder-button" onClick={onKeyboardShortcuts}>Open keyboard shortcuts</button>
          </> : <>
          <p className="settings-copy">PRISM keeps your project library and imported media in your local application data folder. Your music stays on this device.</p>
          <button className="button button-quiet folder-button" onClick={() => void window.prism.openDataFolder().catch((cause) => setError(cause instanceof Error ? cause.message : "The data folder could not be opened."))}><FolderOpen size={16} /> Open PRISM data folder</button>
          <button className="button button-quiet folder-button" onClick={() => void createBackup()}>Back up PRISM library</button>
          <button className="button button-quiet folder-button" onClick={() => void restoreBackup()}>Restore from backup</button>
          {error && <div className="inline-error" role="alert">{error}</div>}
          {status && <div className="settings-copy" role="status">{status}</div>}
          <div className="settings-note"><span className="status-dot" /> Offline project library enabled</div>
          </>}
        </>}
      </section>
    </div>
  );
}
