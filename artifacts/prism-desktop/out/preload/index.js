"use strict";
const electron = require("electron");
const bridge = {
  listReleases: () => electron.ipcRenderer.invoke("prism:releases:list"),
  markReleaseOpened: (releaseId) => electron.ipcRenderer.invoke("prism:releases:opened", releaseId),
  getSession: (sessionId) => electron.ipcRenderer.invoke("prism:sessions:get", sessionId),
  getRelease: (releaseId) => electron.ipcRenderer.invoke("prism:releases:get", releaseId),
  createRelease: (input) => electron.ipcRenderer.invoke("prism:releases:create", input),
  updateRelease: (releaseId, input) => electron.ipcRenderer.invoke("prism:releases:update", releaseId, input),
  duplicateRelease: (releaseId) => electron.ipcRenderer.invoke("prism:releases:duplicate", releaseId),
  deleteRelease: (releaseId) => electron.ipcRenderer.invoke("prism:releases:delete", releaseId),
  addSong: (input) => electron.ipcRenderer.invoke("prism:songs:add", input),
  updateSongTitle: (sessionId, title) => electron.ipcRenderer.invoke("prism:songs:rename", sessionId, title),
  duplicateSong: (sessionId) => electron.ipcRenderer.invoke("prism:songs:duplicate", sessionId),
  deleteSong: (sessionId) => electron.ipcRenderer.invoke("prism:songs:delete", sessionId),
  reorderSongs: (releaseId, songIds) => electron.ipcRenderer.invoke("prism:songs:reorder", releaseId, songIds),
  saveSession: (session) => electron.ipcRenderer.invoke("prism:sessions:save", session),
  chooseArtwork: (releaseId) => electron.ipcRenderer.invoke("prism:artwork:choose", releaseId),
  selectArtwork: () => electron.ipcRenderer.invoke("prism:artwork:select"),
  importAudio: (sessionId) => electron.ipcRenderer.invoke("prism:audio:import", sessionId),
  assetUrl: (assetId) => `prism-media://local/${encodeURIComponent(assetId)}`,
  openDataFolder: () => electron.ipcRenderer.invoke("prism:app:open-data-folder"),
  onCloseRequested: (callback) => {
    const listener = () => callback();
    electron.ipcRenderer.on("prism:app:close-request", listener);
    return () => electron.ipcRenderer.removeListener("prism:app:close-request", listener);
  },
  finishClose: () => electron.ipcRenderer.invoke("prism:app:close-ready")
};
electron.contextBridge.exposeInMainWorld("prism", bridge);
