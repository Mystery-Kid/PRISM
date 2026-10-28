import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  net,
  ipcMain,
  protocol,
  shell,
} from "electron";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import type {
  AudioClip,
  CreateReleaseInput,
  CreateSongInput,
  ProjectAsset,
  Release,
  SongSession,
  Track,
  UpdateReleaseInput,
} from "@shared/types";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "prism-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

type StoredAsset = ProjectAsset & { storageName: string };
type ProjectLibrary = {
  version: 1;
  releases: Release[];
  sessions: SongSession[];
  assets: StoredAsset[];
};

const productFolder = "PRISM";
let mainWindow: BrowserWindow | null = null;
let libraryFile = "";
let assetDirectory = "";
let library: ProjectLibrary | null = null;
let writeQueue = Promise.resolve();
let closeApproved = false;

function emptyLibrary(): ProjectLibrary {
  return { version: 1, releases: [], sessions: [], assets: [] };
}

async function persistLibrary(): Promise<void> {
  if (!library || !libraryFile) throw new Error("The project library is not ready.");
  const snapshot = JSON.stringify(library, null, 2);
  const operation = writeQueue.then(async () => {
    const tempFile = `${libraryFile}.tmp`;
    await writeFile(tempFile, snapshot, "utf8");
    await rename(tempFile, libraryFile);
  });
  writeQueue = operation.catch(() => {
    writeQueue = Promise.resolve();
  });
  await operation;
}

async function readLibrary(): Promise<ProjectLibrary> {
  try {
    const contents = await readFile(libraryFile, "utf8");
    const parsed: unknown = JSON.parse(contents);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("releases" in parsed) ||
      !Array.isArray(parsed.releases) ||
      !("sessions" in parsed) ||
      !Array.isArray(parsed.sessions) ||
      !("assets" in parsed) ||
      !Array.isArray(parsed.assets)
    ) {
      throw new Error("The PRISM project library has an unsupported or damaged format.");
    }
    return parsed as ProjectLibrary;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const initial = emptyLibrary();
      library = initial;
      await persistLibrary();
      return initial;
    }
    throw error;
  }
}

function getLibrary(): ProjectLibrary {
  if (!library) throw new Error("The project library is not ready.");
  return library;
}

function getRelease(releaseId: string): Release {
  const release = getLibrary().releases.find((entry) => entry.id === releaseId);
  if (!release) throw new Error("This release no longer exists.");
  return release;
}

function getSession(sessionId: string): SongSession {
  const session = getLibrary().sessions.find((entry) => entry.id === sessionId);
  if (!session) throw new Error("This song session no longer exists.");
  return session;
}

function freshTrack(name = "Audio 1"): Track {
  return {
    id: randomUUID(),
    name,
    volume: 0.85,
    pan: 0,
    muted: false,
    solo: false,
    clips: [],
  };
}

function freshSession(releaseId: string, title: string): SongSession {
  return {
    id: randomUUID(),
    releaseId,
    title,
    tempo: 120,
    timeSignature: "4/4",
    tracks: [freshTrack()],
    updatedAt: new Date().toISOString(),
  };
}

function cleanTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Enter a title before continuing.");
  }
  return value.trim().slice(0, 120);
}

function allowedSender(senderId: number): void {
  if (!mainWindow || senderId !== mainWindow.webContents.id) {
    throw new Error("This request did not come from the PRISM window.");
  }
}

function registerIpcHandlers(): void {
  const handle = (
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown,
  ) => {
    ipcMain.handle(channel, async (event, ...args) => {
      allowedSender(event.sender.id);
      return listener(event, ...(args as never[]));
    });
  };

  handle("prism:releases:list", async () =>
    [...getLibrary().releases].sort((a, b) =>
      (b.lastOpenedAt ?? b.updatedAt).localeCompare(a.lastOpenedAt ?? a.updatedAt),
    ),
  );
  handle("prism:releases:get", async (_event, releaseId) =>
    getLibrary().releases.find((entry) => entry.id === releaseId) ?? null,
  );
  handle("prism:releases:opened", async (_event, releaseId: string) => {
    const release = getRelease(releaseId);
    release.lastOpenedAt = new Date().toISOString();
    await persistLibrary();
  });
  handle("prism:sessions:get", async (_event, sessionId) =>
    getLibrary().sessions.find((entry) => entry.id === sessionId) ?? null,
  );
  handle("prism:releases:create", async (_event, input: CreateReleaseInput) => {
    const title = cleanTitle(input.title);
    if (!["Single", "EP", "Album", "LP", "Other"].includes(input.releaseType)) {
      throw new Error("Choose a valid release type.");
    }
    const now = new Date().toISOString();
    const release: Release = {
      id: randomUUID(),
      title,
      artistName: input.artistName.trim().slice(0, 120),
      releaseType: input.releaseType,
      customReleaseType:
        input.releaseType === "Other" ? input.customReleaseType?.trim().slice(0, 60) ?? "" : "",
      description: input.description.trim().slice(0, 2000),
      artworkAssetId: null,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      songIds: [],
    };
    getLibrary().releases.unshift(release);
    let session: SongSession | null = null;
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
    async (_event, releaseId: string, input: UpdateReleaseInput) => {
      const release = getRelease(releaseId);
      if (input.title !== undefined) release.title = cleanTitle(input.title);
      if (input.artistName !== undefined) release.artistName = input.artistName.trim().slice(0, 120);
      if (input.description !== undefined) release.description = input.description.trim().slice(0, 2000);
      if (input.artworkAssetId !== undefined) {
        if (
          input.artworkAssetId !== null &&
          !getLibrary().assets.some((asset) => asset.id === input.artworkAssetId)
        ) {
          throw new Error("The selected artwork could not be found.");
        }
        release.artworkAssetId = input.artworkAssetId;
      }
      release.updatedAt = new Date().toISOString();
      await persistLibrary();
      return release;
    },
  );
  handle("prism:releases:duplicate", async (_event, releaseId: string) => {
    const source = getRelease(releaseId);
    const now = new Date().toISOString();
    const copy: Release = {
      ...structuredClone(source),
      id: randomUUID(),
      title: `${source.title} Copy`,
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: null,
      songIds: [],
    };
    const copiedSessions = source.songIds.map((id) => {
      const session = getSession(id);
      const duplicate = structuredClone(session);
      duplicate.id = randomUUID();
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
  handle("prism:releases:delete", async (_event, releaseId: string) => {
    const release = getRelease(releaseId);
    getLibrary().releases = getLibrary().releases.filter((entry) => entry.id !== releaseId);
    const songIds = new Set(release.songIds);
    getLibrary().sessions = getLibrary().sessions.filter((session) => !songIds.has(session.id));
    await persistLibrary();
  });
  handle("prism:songs:add", async (_event, input: CreateSongInput) => {
    const release = getRelease(input.releaseId);
    if (release.releaseType === "Single") throw new Error("Singles have one song session.");
    const session = freshSession(release.id, input.title.trim() || "Untitled Track");
    release.songIds.push(session.id);
    release.updatedAt = new Date().toISOString();
    getLibrary().sessions.push(session);
    await persistLibrary();
    return session;
  });
  handle("prism:songs:rename", async (_event, sessionId: string, title: string) => {
    const session = getSession(sessionId);
    session.title = cleanTitle(title);
    session.updatedAt = new Date().toISOString();
    await persistLibrary();
    return session;
  });
  handle("prism:songs:duplicate", async (_event, sessionId: string) => {
    const source = getSession(sessionId);
    const release = getRelease(source.releaseId);
    const duplicate = structuredClone(source);
    duplicate.id = randomUUID();
    duplicate.title = `${source.title} Copy`;
    duplicate.updatedAt = new Date().toISOString();
    duplicate.tracks = duplicate.tracks.map((track) => ({
      ...track,
      id: randomUUID(),
      clips: track.clips.map((clip) => ({ ...clip, id: randomUUID() })),
    }));
    release.songIds.splice(release.songIds.indexOf(source.id) + 1, 0, duplicate.id);
    getLibrary().sessions.push(duplicate);
    await persistLibrary();
    return duplicate;
  });
  handle("prism:songs:delete", async (_event, sessionId: string) => {
    const session = getSession(sessionId);
    const release = getRelease(session.releaseId);
    if (release.releaseType === "Single") throw new Error("A Single's only song cannot be removed.");
    release.songIds = release.songIds.filter((id) => id !== sessionId);
    release.updatedAt = new Date().toISOString();
    getLibrary().sessions = getLibrary().sessions.filter((entry) => entry.id !== sessionId);
    await persistLibrary();
  });
  handle(
    "prism:songs:reorder",
    async (_event, releaseId: string, songIds: string[]) => {
      const release = getRelease(releaseId);
      if (
        songIds.length !== release.songIds.length ||
        new Set(songIds).size !== songIds.length ||
        songIds.some((id) => !release.songIds.includes(id))
      ) {
        throw new Error("The track order could not be saved.");
      }
      release.songIds = songIds;
      release.updatedAt = new Date().toISOString();
      await persistLibrary();
      return release;
    },
  );
  handle("prism:sessions:save", async (_event, updated: SongSession) => {
    const current = getSession(updated.id);
    if (updated.releaseId !== current.releaseId) throw new Error("A song cannot be moved to another release.");
    if (!Array.isArray(updated.tracks)) throw new Error("The session data is invalid.");
    for (const track of updated.tracks) {
      if (
        !Array.isArray(track.clips) ||
        track.clips.some(
          (clip: AudioClip) =>
            !getLibrary().assets.some((asset) => asset.id === clip.assetId) ||
            !Number.isFinite(clip.startSeconds) ||
            clip.startSeconds < 0,
        )
      ) {
        throw new Error("A clip refers to missing audio or an invalid timeline position.");
      }
    }
    const saved = {
      ...updated,
      title: cleanTitle(updated.title),
      tempo: Math.min(300, Math.max(20, Math.round(updated.tempo))),
      updatedAt: new Date().toISOString(),
    };
    const index = getLibrary().sessions.findIndex((session) => session.id === saved.id);
    getLibrary().sessions[index] = saved;
    getRelease(saved.releaseId).updatedAt = saved.updatedAt;
    await persistLibrary();
    return saved;
  });
  handle("prism:artwork:choose", async (_event, releaseId: string) => {
    const release = getRelease(releaseId);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose release artwork",
      properties: ["openFile"],
      filters: [{ name: "Artwork", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const sourcePath = result.filePaths[0];
    const asset = await storeArtworkFile(sourcePath);
    release.artworkAssetId = asset.id;
    release.updatedAt = new Date().toISOString();
    await persistLibrary();
    return release;
  });
  handle("prism:artwork:select", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose release artwork",
      properties: ["openFile"],
      filters: [{ name: "Artwork", extensions: ["png", "jpg", "jpeg", "webp"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const asset = await storeArtworkFile(result.filePaths[0]);
    await persistLibrary();
    return { id: asset.id, fileName: asset.fileName, mimeType: asset.mimeType };
  });
  handle("prism:audio:import", async (_event, sessionId: string) => {
    const session = getSession(sessionId);
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Import audio",
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "ogg", "m4a", "flac"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const sourcePath = result.filePaths[0];
    const extension = extname(sourcePath).toLowerCase();
    const info = await (await import("node:fs/promises")).stat(sourcePath);
    if (info.size > 500 * 1024 * 1024) throw new Error("Audio files must be smaller than 500 MB.");
    const id = randomUUID();
    const storageName = `${id}${extension}`;
    await copyFile(sourcePath, join(assetDirectory, storageName));
    const asset: StoredAsset = {
      id,
      storageName,
      fileName: sourcePath.split(/[\\/]/).pop() ?? "audio",
      mimeType:
        extension === ".wav"
          ? "audio/wav"
          : extension === ".ogg"
            ? "audio/ogg"
            : extension === ".m4a"
              ? "audio/mp4"
              : extension === ".flac"
                ? "audio/flac"
                : "audio/mpeg",
    };
    getLibrary().assets.push(asset);
    if (session.tracks.length === 0) session.tracks.push(freshTrack());
    const clip: AudioClip = {
      id: randomUUID(),
      assetId: id,
      name: asset.fileName,
      durationSeconds: 0,
      startSeconds: 0,
      gain: 1,
      waveform: [],
    };
    session.tracks[0].clips.push(clip);
    session.updatedAt = new Date().toISOString();
    await persistLibrary();
    return { clip, assetUrl: `prism-media://local/${id}` };
  });
  handle("prism:app:open-data-folder", async () => {
    const error = await shell.openPath(join(app.getPath("userData"), productFolder));
    if (error) throw new Error(error);
  });
  handle("prism:app:close-ready", async () => {
    closeApproved = true;
    mainWindow?.close();
  });
}

async function storeArtworkFile(sourcePath: string): Promise<StoredAsset> {
  const extension = extname(sourcePath).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(extension)) {
    throw new Error("Choose a PNG, JPEG, or WebP image.");
  }
  const info = await (await import("node:fs/promises")).stat(sourcePath);
  if (info.size > 20 * 1024 * 1024) throw new Error("Artwork must be smaller than 20 MB.");
  const id = randomUUID();
  const storageName = `${id}${extension}`;
  await copyFile(sourcePath, join(assetDirectory, storageName));
  const mimeType =
    extension === ".png"
      ? "image/png"
      : extension === ".webp"
        ? "image/webp"
        : "image/jpeg";
  const asset: StoredAsset = {
    id,
    storageName,
    fileName: sourcePath.split(/[\\/]/).pop() ?? "artwork",
    mimeType,
  };
  getLibrary().assets.push(asset);
  return asset;
}

async function handleMediaRequest(request: Request): Promise<Response> {
  const assetId = new URL(request.url).pathname.replace(/^\/+/, "");
  if (!/^[\da-f-]{36}$/i.test(assetId) || !library) {
    return new Response("Asset not found", { status: 404 });
  }
  const asset = library.assets.find((entry) => entry.id === assetId);
  if (!asset) return new Response("Asset not found", { status: 404 });
  return net.fetch(pathToFileURL(join(assetDirectory, asset.storageName)).toString());
}

function createApplicationMenu(): void {
  const menu = Menu.buildFromTemplate([
    {
      label: "PRISM",
      submenu: [
        { role: "about", label: "About PRISM" },
        { type: "separator" },
        { role: "quit", label: "Quit PRISM" },
      ],
    },
    {
      label: "File",
      submenu: [
        { label: "Open PRISM data folder", click: () => void shell.openPath(join(app.getPath("userData"), productFolder)) },
        { type: "separator" },
        { role: "close", label: "Close window" },
      ],
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
        { role: "selectAll" },
      ],
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
        { role: "togglefullscreen" },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: "PRISM",
    backgroundColor: "#101011",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    const trusted = devUrl
      ? url.startsWith(new URL(devUrl).origin)
      : url.startsWith("file://");
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
    void mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  const dataDirectory = join(app.getPath("userData"), productFolder);
  assetDirectory = join(dataDirectory, "assets");
  libraryFile = join(dataDirectory, "library.json");
  await mkdir(assetDirectory, { recursive: true });
  library = await readLibrary();
  await protocol.handle("prism-media", handleMediaRequest);
  registerIpcHandlers();
  createApplicationMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (library) void persistLibrary();
});
