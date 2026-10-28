"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const promises = require("node:fs/promises");
const node_path = require("node:path");
const node_url = require("node:url");
const node_crypto = require("node:crypto");
electron.protocol.registerSchemesAsPrivileged([
  {
    scheme: "prism-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);
const productFolder = "PRISM";
let mainWindow = null;
let libraryFile = "";
let assetDirectory = "";
let library = null;
let writeQueue = Promise.resolve();
let closeApproved = false;
function emptyLibrary() {
  return { version: 1, releases: [], sessions: [], assets: [] };
}
async function persistLibrary() {
  if (!library || !libraryFile) throw new Error("The project library is not ready.");
  const snapshot = JSON.stringify(library, null, 2);
  const operation = writeQueue.then(async () => {
    const tempFile = `${libraryFile}.tmp`;
    await promises.writeFile(tempFile, snapshot, "utf8");
    await promises.rename(tempFile, libraryFile);
  });
  writeQueue = operation.catch(() => {
    writeQueue = Promise.resolve();
  });
  await operation;
}
async function readLibrary() {
  try {
    const contents = await promises.readFile(libraryFile, "utf8");
    const parsed = JSON.parse(contents);
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed) || parsed.version !== 1 || !("releases" in parsed) || !Array.isArray(parsed.releases) || !("sessions" in parsed) || !Array.isArray(parsed.sessions) || !("assets" in parsed) || !Array.isArray(parsed.assets)) {
      throw new Error("The PRISM project library has an unsupported or damaged format.");
    }
    return parsed;
  } catch (error) {
    if (error.code === "ENOENT") {
      const initial = emptyLibrary();
      library = initial;
      await persistLibrary();
      return initial;
    }
    throw error;
  }
}
function getLibrary() {
  if (!library) throw new Error("The project library is not ready.");
  return library;
}
function getRelease(releaseId) {
  const release = getLibrary().releases.find((entry) => entry.id === releaseId);
  if (!release) throw new Error("This release no longer exists.");
  return release;
}
function getSession(sessionId) {
  const session = getLibrary().sessions.find((entry) => entry.id === sessionId);
  if (!session) throw new Error("This song session no longer exists.");
  return session;
}
function freshTrack(name = "Audio 1") {
  return {
    id: node_crypto.randomUUID(),
    name,
    volume: 0.85,
    pan: 0,
    muted: false,
    solo: false,
    clips: []
  };
}
function freshSession(releaseId, title) {
  return {
    id: node_crypto.randomUUID(),
    releaseId,
    title,
    tempo: 120,
    timeSignature: "4/4",
    tracks: [freshTrack()],
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function cleanTitle(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Enter a title before continuing.");
  }
  return value.trim().slice(0, 120);
}
function allowedSender(senderId) {
  if (!mainWindow || senderId !== mainWindow.webContents.id) {
    throw new Error("This request did not come from the PRISM window.");
  }
}
function registerIpcHandlers() {
  const handle = (channel, listener) => {
    electron.ipcMain.handle(channel, async (event, ...args) => {
      allowedSender(event.sender.id);
      return listener(event, ...args);
    });
  };
  handle(
    "prism:releases:list",
    async () => [...getLibrary().releases].sort(
      (a, b) => (b.lastOpenedAt ?? b.updatedAt).localeCompare(a.lastOpenedAt ?? a.updatedAt)
    )
  );
  handle(
    "prism:releases:get",
    async (_event, releaseId) => getLibrary().releases.find((entry) => entry.id === releaseId) ?? null
  );
  handle("prism:releases:opened", async (_event, releaseId) => {
    const release = getRelease(releaseId);
    release.lastOpenedAt = (/* @__PURE__ */ new Date()).toISOString();
    await persistLibrary();
  });
  handle(
    "prism:sessions:get",
    async (_event, sessionId) => getLibrary().sessions.find((entry) => entry.id === sessionId) ?? null
  );
  handle("prism:releases:create", async (_event, input) => {
    const title = cleanTitle(input.title);
    if (!["Single", "EP", "Album", "LP", "Other"].includes(input.releaseType)) {
      throw new Error("Choose a valid release type.");
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const release = {
      id: node_crypto.randomUUID(),
      title,
      artistName: input.artistName.trim().slice(0, 120),
      releaseType: input.releaseType,
      customReleaseType: input.releaseType === "Other" ? input.customReleaseType?.trim().slice(0, 60) ?? "" : "",
      description: input.description.trim().slice(0, 2e3),
      artworkAssetId: null,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      songIds: []
    };
    getLibrary().releases.unshift(release);
    let session = null;
    if (release.releaseType === "Single") {
      session = freshSession(release.id, release.title);
      release.songIds.push(session.id);
      getLibrary().sessions.push(session);
    }
    await persistLibrary();
    return { release, session };
  });
  handle(
    "prism:releases:update",
    async (_event, releaseId, input) => {
      const release = getRelease(releaseId);
      if (input.title !== void 0) release.title = cleanTitle(input.title);
      if (input.artistName !== void 0) release.artistName = input.artistName.trim().slice(0, 120);
      if (input.description !== void 0) release.description = input.description.trim().slice(0, 2e3);
      if (input.artworkAssetId !== void 0) {
        if (input.artworkAssetId !== null && !getLibrary().assets.some((asset) => asset.id === input.artworkAssetId)) {
          throw new Error("The selected artwork could not be found.");
        }
        release.artworkAssetId = input.artworkAssetId;
      }
      release.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await persistLibrary();
      return release;
    }
  );
  handle("prism:releases:duplicate", async (_event, releaseId) => {
    const source = getRelease(releaseId);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const copy = {
      ...structuredClone(source),
      id: node_crypto.randomUUID(),
      title: `${source.title} Copy`,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      songIds: []
    };
    const copiedSessions = source.songIds.map((id) => {
      const session = getSession(id);
      const duplicate = structuredClone(session);
      duplicate.id = node_crypto.randomUUID();
      duplicate.releaseId = copy.id;
      duplicate.updatedAt = now;
      copy.songIds.push(duplicate.id);
      return duplicate;
    });
    getLibrary().releases.unshift(copy);
    getLibrary().sessions.push(...copiedSessions);
    await persistLibrary();
    return copy;
  });
  handle("prism:releases:delete", async (_event, releaseId) => {
    const release = getRelease(releaseId);
    getLibrary().releases = getLibrary().releases.filter((entry) => entry.id !== releaseId);
    const songIds = new Set(release.songIds);
    getLibrary().sessions = getLibrary().sessions.filter((session) => !songIds.has(session.id));
    await persistLibrary();
  });
  handle("prism:songs:add", async (_event, input) => {
    const release = getRelease(input.releaseId);
    if (release.releaseType === "Single") throw new Error("Singles have one song session.");
    const session = freshSession(release.id, input.title.trim() || "Untitled Track");
    release.songIds.push(session.id);
    release.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    getLibrary().sessions.push(session);
    await persistLibrary();
    return session;
  });
  handle("prism:songs:rename", async (_event, sessionId, title) => {
    const session = getSession(sessionId);
    session.title = cleanTitle(title);
    session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await persistLibrary();
    return session;
  });
  handle("prism:songs:duplicate", async (_event, sessionId) => {
    const source = getSession(sessionId);
    const release = getRelease(source.releaseId);
    const duplicate = structuredClone(source);
    duplicate.id = node_crypto.randomUUID();
    duplicate.title = `${source.title} Copy`;
    duplicate.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    duplicate.tracks = duplicate.tracks.map((track) => ({
      ...track,
      id: node_crypto.randomUUID(),
      clips: track.clips.map((clip) => ({ ...clip, id: node_crypto.randomUUID() }))
    }));
    release.songIds.splice(release.songIds.indexOf(source.id) + 1, 0, duplicate.id);
    getLibrary().sessions.push(duplicate);
    await persistLibrary();
    return duplicate;
  });
  handle("prism:songs:delete", async (_event, sessionId) => {
    const session = getSession(sessionId);
    const release = getRelease(session.releaseId);
    if (release.releaseType === "Single") throw new Error("A Single's only song cannot be removed.");
    release.songIds = release.songIds.filter((id) => id !== sessionId);
    release.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    getLibrary().sessions = getLibrary().sessions.filter((entry) => entry.id !== sessionId);
    await persistLibrary();
  });
  handle(
    "prism:songs:reorder",
    async (_event, releaseId, songIds) => {
      const release = getRelease(releaseId);
      if (songIds.length !== release.songIds.length || new Set(songIds).size !== songIds.length || songIds.some((id) => !release.songIds.includes(id))) {
        throw new Error("The track order could not be saved.");
      }
      release.songIds = songIds;
      release.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
      await persistLibrary();
      return release;
    }
  );
  handle("prism:sessions:save", async (_event, updated) => {
    const current = getSession(updated.id);
    if (updated.releaseId !== current.releaseId) throw new Error("A song cannot be moved to another release.");
    if (!Array.isArray(updated.tracks)) throw new Error("The session data is invalid.");
    for (const track of updated.tracks) {
      if (!Array.isArray(track.clips) || track.clips.some(
        (clip) => !getLibrary().assets.some((asset) => asset.id === clip.assetId) || !Number.isFinite(clip.startSeconds) || clip.startSeconds < 0
      )) {
        throw new Error("A clip refers to missing audio or an invalid timeline position.");
      }
    }
    const saved = {
      ...updated,
      title: cleanTitle(updated.title),
      tempo: Math.min(300, Math.max(20, Math.round(updated.tempo))),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    const index = getLibrary().sessions.findIndex((session) => session.id === saved.id);
    getLibrary().sessions[index] = saved;
    getRelease(saved.releaseId).updatedAt = saved.updatedAt;
    await persistLibrary();
    return saved;
  });
  handle("prism:artwork:choose", async (_event, releaseId) => {
    const release = getRelease(releaseId);
    const result = await electron.dialog.showOpenDialog(mainWindow, {
      title: "Choose release artwork",
      properties: ["openFile"],
      filters: [{ name: "Artwork", extensions: ["png", "jpg", "jpeg", "webp"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const sourcePath = result.filePaths[0];
    const asset = await storeArtworkFile(sourcePath);
    release.artworkAssetId = asset.id;
    release.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await persistLibrary();
    return release;
  });
  handle("prism:artwork:select", async () => {
    const result = await electron.dialog.showOpenDialog(mainWindow, {
      title: "Choose release artwork",
      properties: ["openFile"],
      filters: [{ name: "Artwork", extensions: ["png", "jpg", "jpeg", "webp"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const asset = await storeArtworkFile(result.filePaths[0]);
    await persistLibrary();
    return { id: asset.id, fileName: asset.fileName, mimeType: asset.mimeType };
  });
  handle("prism:audio:import", async (_event, sessionId) => {
    const session = getSession(sessionId);
    const result = await electron.dialog.showOpenDialog(mainWindow, {
      title: "Import audio",
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "ogg", "m4a", "flac"] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const sourcePath = result.filePaths[0];
    const extension = node_path.extname(sourcePath).toLowerCase();
    const info = await (await import("node:fs/promises")).stat(sourcePath);
    if (info.size > 500 * 1024 * 1024) throw new Error("Audio files must be smaller than 500 MB.");
    const id = node_crypto.randomUUID();
    const storageName = `${id}${extension}`;
    await promises.copyFile(sourcePath, node_path.join(assetDirectory, storageName));
    const asset = {
      id,
      storageName,
      fileName: sourcePath.split(/[\\/]/).pop() ?? "audio",
      mimeType: extension === ".wav" ? "audio/wav" : extension === ".ogg" ? "audio/ogg" : extension === ".m4a" ? "audio/mp4" : extension === ".flac" ? "audio/flac" : "audio/mpeg"
    };
    getLibrary().assets.push(asset);
    if (session.tracks.length === 0) session.tracks.push(freshTrack());
    const clip = {
      id: node_crypto.randomUUID(),
      assetId: id,
      name: asset.fileName,
      durationSeconds: 0,
      startSeconds: 0,
      gain: 1,
      waveform: []
    };
    session.tracks[0].clips.push(clip);
    session.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await persistLibrary();
    return { clip, assetUrl: `prism-media://local/${id}` };
  });
  handle("prism:app:open-data-folder", async () => {
    const error = await electron.shell.openPath(node_path.join(electron.app.getPath("userData"), productFolder));
    if (error) throw new Error(error);
  });
  handle("prism:app:close-ready", async () => {
    closeApproved = true;
    mainWindow?.close();
  });
}
async function storeArtworkFile(sourcePath) {
  const extension = node_path.extname(sourcePath).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  const info = await (await import("node:fs/promises")).stat(sourcePath);
  if (info.size > 20 * 1024 * 1024) throw new Error("Artwork must be smaller than 20 MB.");
  const id = node_crypto.randomUUID();
  const storageName = `${id}${extension}`;
  await promises.copyFile(sourcePath, node_path.join(assetDirectory, storageName));
  const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  const asset = {
    id,
    storageName,
    fileName: sourcePath.split(/[\\/]/).pop() ?? "artwork",
    mimeType
  };
  getLibrary().assets.push(asset);
  return asset;
}
async function handleMediaRequest(request) {
  const assetId = new URL(request.url).pathname.replace(/^\/+/, "");
  if (!/^[\da-f-]{36}$/i.test(assetId) || !library) {
    return new Response("Asset not found", { status: 404 });
  }
  const asset = library.assets.find((entry) => entry.id === assetId);
  if (!asset) return new Response("Asset not found", { status: 404 });
  return electron.net.fetch(node_url.pathToFileURL(node_path.join(assetDirectory, asset.storageName)).toString());
}
function createApplicationMenu() {
  const menu = electron.Menu.buildFromTemplate([
    {
      label: "PRISM",
      submenu: [
        { role: "about", label: "About PRISM" },
        { type: "separator" },
        { role: "quit", label: "Quit PRISM" }
      ]
    },
    {
      label: "File",
      submenu: [
        { label: "Open PRISM data folder", click: () => void electron.shell.openPath(node_path.join(electron.app.getPath("userData"), productFolder)) },
        { type: "separator" },
        { role: "close", label: "Close window" }
      ]
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" }
      ]
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "togglefullscreen" }
      ]
    }
  ]);
  electron.Menu.setApplicationMenu(menu);
}
function createWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "PRISM",
    backgroundColor: "#101011",
    show: false,
    icon: node_path.join(__dirname, "../../build/prism-512.png"),
    webPreferences: {
      preload: node_path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    const trusted = devUrl ? url.startsWith(new URL(devUrl).origin) : url.startsWith("file://");
    if (!trusted) event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    if (closeApproved) {
      closeApproved = false;
      return;
    }
    event.preventDefault();
    mainWindow?.webContents.send("prism:app:close-request");
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(node_path.join(__dirname, "../renderer/index.html"));
  }
}
electron.app.whenReady().then(async () => {
  const dataDirectory = node_path.join(electron.app.getPath("userData"), productFolder);
  assetDirectory = node_path.join(dataDirectory, "assets");
  libraryFile = node_path.join(dataDirectory, "library.json");
  await promises.mkdir(assetDirectory, { recursive: true });
  library = await readLibrary();
  await electron.protocol.handle("prism-media", handleMediaRequest);
  registerIpcHandlers();
  createApplicationMenu();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") electron.app.quit();
});
electron.app.on("before-quit", () => {
  if (library) void persistLibrary();
});
