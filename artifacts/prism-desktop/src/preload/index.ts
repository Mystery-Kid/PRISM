import { contextBridge, ipcRenderer } from "electron";
import type {
  AppBridge,
  CreateReleaseInput,
  CreateSongInput,
  SongSession,
  UpdateReleaseInput,
} from "@shared/types";

const bridge: AppBridge = {
  listReleases: () => ipcRenderer.invoke("prism:releases:list"),
  markReleaseOpened: (releaseId) => ipcRenderer.invoke("prism:releases:opened", releaseId),
  getSession: (sessionId) => ipcRenderer.invoke("prism:sessions:get", sessionId),
  getRelease: (releaseId) => ipcRenderer.invoke("prism:releases:get", releaseId),
  createRelease: (input: CreateReleaseInput) =>
    ipcRenderer.invoke("prism:releases:create", input),
  updateRelease: (releaseId, input: UpdateReleaseInput) =>
    ipcRenderer.invoke("prism:releases:update", releaseId, input),
  duplicateRelease: (releaseId) =>
    ipcRenderer.invoke("prism:releases:duplicate", releaseId),
  deleteRelease: (releaseId) =>
    ipcRenderer.invoke("prism:releases:delete", releaseId),
  addSong: (input: CreateSongInput) => ipcRenderer.invoke("prism:songs:add", input),
  updateSongTitle: (sessionId, title) =>
    ipcRenderer.invoke("prism:songs:rename", sessionId, title),
  duplicateSong: (sessionId) =>
    ipcRenderer.invoke("prism:songs:duplicate", sessionId),
  deleteSong: (sessionId) =>
    ipcRenderer.invoke("prism:songs:delete", sessionId),
  reorderSongs: (releaseId, songIds) =>
    ipcRenderer.invoke("prism:songs:reorder", releaseId, songIds),
  saveSession: (session: SongSession) =>
    ipcRenderer.invoke("prism:sessions:save", session),
  chooseArtwork: (releaseId) =>
    ipcRenderer.invoke("prism:artwork:choose", releaseId),
  selectArtwork: () => ipcRenderer.invoke("prism:artwork:select"),
  importAudio: (sessionId) =>
    ipcRenderer.invoke("prism:audio:import", sessionId),
  assetUrl: (assetId) => `prism-media://local/${encodeURIComponent(assetId)}`,
  openDataFolder: () => ipcRenderer.invoke("prism:app:open-data-folder"),
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("prism:app:close-request", listener);
    return () => ipcRenderer.removeListener("prism:app:close-request", listener);
  },
  finishClose: () => ipcRenderer.invoke("prism:app:close-ready"),
};

contextBridge.exposeInMainWorld("prism", bridge);
