import { contextBridge, ipcRenderer } from "electron";
import type {
  AppBridge,
  CreateReleaseInput,
  CreateSongInput,
  EffectChainPreset,
  EffectChainPresetFile,
  SongSession,
  UpdateReleaseInput,
} from "@shared/types";

const bridge: AppBridge = {
  getThemeState: () => ipcRenderer.invoke("prism:themes:get"),
  claimTheme: (id) => ipcRenderer.invoke("prism:themes:claim", id),
  applyTheme: (id) => ipcRenderer.invoke("prism:themes:apply", id),
  repairTheme: (id) => ipcRenderer.invoke("prism:themes:repair", id),
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
  listEffectPresets: (projectId: string) =>
    ipcRenderer.invoke("prism:effects:presets:list", projectId),
  saveEffectPreset: (preset: Omit<EffectChainPreset, "createdAt" | "updatedAt">) =>
    ipcRenderer.invoke("prism:effects:presets:save", preset),
  deleteEffectPreset: (presetId: string, projectId: string) =>
    ipcRenderer.invoke("prism:effects:presets:delete", presetId, projectId),
  importEffectPreset: () =>
    ipcRenderer.invoke("prism:effects:presets:import"),
  exportEffectPreset: (preset: EffectChainPresetFile) =>
    ipcRenderer.invoke("prism:effects:presets:export", preset),
  chooseArtwork: (releaseId) =>
    ipcRenderer.invoke("prism:artwork:choose", releaseId),
  selectArtwork: () => ipcRenderer.invoke("prism:artwork:select"),
  importAudio: (sessionId, trackId) =>
    ipcRenderer.invoke("prism:audio:import", sessionId, trackId),
  listAudioAssets: () => ipcRenderer.invoke("prism:audio:assets:list"),
  importSample: () => ipcRenderer.invoke("prism:audio:sample:import"),
  startRecording: (input) => ipcRenderer.invoke("prism:audio:recording:start", input),
  appendRecordingChunk: (recordingId, samples) =>
    ipcRenderer.invoke("prism:audio:recording:append", recordingId, samples),
  finishRecording: (input) =>
    ipcRenderer.invoke("prism:audio:recording:finish", input),
  preserveRecording: (recordingId) =>
    ipcRenderer.invoke("prism:audio:recording:preserve", recordingId),
  cancelRecording: (recordingId) =>
    ipcRenderer.invoke("prism:audio:recording:cancel", recordingId),
  exportWav: (input) => ipcRenderer.invoke("prism:audio:export-wav", input),
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
