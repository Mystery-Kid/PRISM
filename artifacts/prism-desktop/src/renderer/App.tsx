import { useCallback, useEffect, useState } from "react";
import type {
  CreateReleaseInput,
  Release,
  SongSession,
  UpdateReleaseInput,
} from "@shared/types";
import { LibraryScreen, SettingsDialog } from "./components/Library";
import { Workstation } from "./components/Workstation";

type Destination =
  | { screen: "projects" | "shop" }
  | { screen: "release"; releaseId: string }
  | { screen: "workstation"; sessionId: string };

export default function App() {
  const [destination, setDestination] = useState<Destination>({ screen: "projects" });
  const [releases, setReleases] = useState<Release[]>([]);
  const [releaseDetail, setReleaseDetail] = useState<{ release: Release; songs: SongSession[] } | null>(null);
  const [session, setSession] = useState<SongSession | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pageError, setPageError] = useState("");
  const [loading, setLoading] = useState(true);

  const refreshReleases = useCallback(async () => {
    const result = await window.prism.listReleases();
    setReleases(result);
  }, []);

  useEffect(() => {
    let active = true;
    void window.prism.listReleases().then((result) => {
      if (active) setReleases(result);
    }).catch((cause: unknown) => {
      if (active) setPageError(cause instanceof Error ? cause.message : "The local project library could not be opened.");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (destination.screen === "workstation") return;
    return window.prism.onCloseRequested(() => {
      void window.prism.finishClose();
    });
  }, [destination.screen]);

  const openRelease = async (release: Release) => {
    try {
      setPageError("");
      await window.prism.markReleaseOpened(release.id);
      await refreshReleases();
      if (release.releaseType === "Single") {
        const singleSession = release.songIds[0] ? await window.prism.getSession(release.songIds[0]) : null;
        if (!singleSession) throw new Error("The Single session could not be found.");
        setSession(singleSession);
        setDestination({ screen: "workstation", sessionId: singleSession.id });
        return;
      }
      const currentRelease = await window.prism.getRelease(release.id);
      if (!currentRelease) throw new Error("The release could not be found.");
      const songs = (await Promise.all(currentRelease.songIds.map((id) => window.prism.getSession(id))))
        .filter((song): song is SongSession => song !== null);
      setReleaseDetail({ release: currentRelease, songs });
      setDestination({ screen: "release", releaseId: currentRelease.id });
    } catch (cause) {
      setPageError(cause instanceof Error ? cause.message : "The project could not be opened.");
    }
  };

  const openSong = (song: SongSession) => {
    setSession(song);
    setDestination({ screen: "workstation", sessionId: song.id });
  };

  const refreshReleaseDetail = async (releaseId: string) => {
    const release = await window.prism.getRelease(releaseId);
    if (!release) {
      setDestination({ screen: "projects" });
      setReleaseDetail(null);
      return;
    }
    const songs = (await Promise.all(release.songIds.map((id) => window.prism.getSession(id))))
      .filter((song): song is SongSession => song !== null);
    setReleaseDetail({ release, songs });
  };

  const createRelease = async (input: CreateReleaseInput, artworkId: string | null) => {
    const result = await window.prism.createRelease(input);
    let release = result.release;
    if (artworkId) {
      release = await window.prism.updateRelease(release.id, { artworkAssetId: artworkId });
    }
    await refreshReleases();
    if (result.session) await openSong(result.session);
    return release;
  };

  const updateRelease = async (releaseId: string, input: UpdateReleaseInput) => {
    await window.prism.updateRelease(releaseId, input);
    await refreshReleases();
    if (destination.screen === "release" && destination.releaseId === releaseId) {
      await refreshReleaseDetail(releaseId);
    }
  };

  const deleteRelease = async (releaseId: string) => {
    await window.prism.deleteRelease(releaseId);
    await refreshReleases();
    if (destination.screen === "release" && destination.releaseId === releaseId) {
      setReleaseDetail(null);
      setDestination({ screen: "projects" });
    }
  };

  const addSong = async (releaseId: string, title: string) => {
    await window.prism.addSong({ releaseId, title });
    await refreshReleaseDetail(releaseId);
  };

  const renameSong = async (sessionId: string, title: string) => {
    const updated = await window.prism.updateSongTitle(sessionId, title);
    await refreshReleaseDetail(updated.releaseId);
  };

  const duplicateSong = async (sessionId: string) => {
    const duplicate = await window.prism.duplicateSong(sessionId);
    await refreshReleaseDetail(duplicate.releaseId);
  };

  const deleteSong = async (sessionId: string) => {
    const song = releaseDetail?.songs.find((entry) => entry.id === sessionId);
    if (!song) throw new Error("This song session could not be found.");
    await window.prism.deleteSong(sessionId);
    await refreshReleaseDetail(song.releaseId);
  };

  const reorderSongs = async (releaseId: string, songIds: string[]) => {
    await window.prism.reorderSongs(releaseId, songIds);
    await refreshReleaseDetail(releaseId);
  };

  const navigateBackFromWorkstation = async () => {
    if (!session) {
      setDestination({ screen: "projects" });
      return;
    }
    const release = await window.prism.getRelease(session.releaseId);
    if (release?.releaseType !== "Single" && release) {
      await refreshReleaseDetail(release.id);
      setDestination({ screen: "release", releaseId: release.id });
    } else {
      await refreshReleases();
      setDestination({ screen: "projects" });
    }
  };

  if (loading) return <div className="app-loading"><span className="loading-ring" /><span>Opening your studio…</span></div>;
  if (destination.screen === "workstation" && session) {
    const releaseTitle = releases.find((release) => release.id === session.releaseId)?.title ?? "Project";
    return <><Workstation session={session} releaseTitle={releaseTitle} onBack={() => void navigateBackFromWorkstation()} onHome={() => { void refreshReleases(); setDestination({ screen: "projects" }); }} />{pageError && <div className="global-error" role="alert">{pageError}<button onClick={() => setPageError("")}>Dismiss</button></div>}</>;
  }

  return (
    <>
      <LibraryScreen
        releases={releases}
        currentTab={destination.screen === "shop" ? "shop" : "projects"}
        onTabChange={(tab) => {
          setPageError("");
          setDestination({ screen: tab });
          if (tab === "projects") setReleaseDetail(null);
        }}
        onCreateRelease={createRelease}
        onUpdateRelease={updateRelease}
        onDeleteRelease={deleteRelease}
        onDuplicateRelease={async (releaseId) => { await window.prism.duplicateRelease(releaseId); await refreshReleases(); }}
        onOpenRelease={(release) => void openRelease(release)}
        onOpenSong={openSong}
        onRefresh={refreshReleases}
        onSettings={() => setSettingsOpen(true)}
        releaseDetail={destination.screen === "release" ? releaseDetail : null}
        onBackToLibrary={() => { setReleaseDetail(null); setDestination({ screen: "projects" }); }}
        onAddSong={addSong}
        onRenameSong={renameSong}
        onDuplicateSong={duplicateSong}
        onDeleteSong={deleteSong}
        onReorderSongs={reorderSongs}
      />
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {pageError && <div className="global-error" role="alert">{pageError}<button onClick={() => setPageError("")}>Dismiss</button></div>}
    </>
  );
}
