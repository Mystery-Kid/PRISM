import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  net,
  ipcMain,
  protocol,
  session as electronSession,
  shell,
} from "electron";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  stat,
  truncate,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { basename, extname, isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  isSafeAssetStorageName,
  migrateProjectLibrary,
  type ProjectLibrary,
  type StoredAsset,
} from "../shared/migrations";
import { createLibraryBackup, restoreLibraryBackup } from "./project-backup";
import { writeAtomicText } from "./atomic-write";
import { ThemeStore } from "./theme-store";
import { importProjectFile, saveProjectFile } from "./project-file";
import { runDesktopSmoke } from "./desktop-smoke";
import {
  createEffectPresetFile,
  maxEffectPresetBytes,
  normalizeStoredEffectPreset,
  parseEffectPresetFile,
  upsertEffectPreset,
  visibleEffectPresets,
} from "../shared/effect-presets";
import { normalizeEffectChain } from "../shared/effect-definitions";
import { validateInstrumentTrackState } from "../shared/instrument-tracks";
import { validateAudioRouting } from "../shared/audio-routing";
import { validateMidiArrangement } from "../shared/midi-arrangement";
import type {
  AudioClip,
  CreateReleaseInput,
  CreateSongInput,
  EffectChainPreset,
  EffectChainPresetFile,
  EffectState,
  ExportWavInput,
  ProjectAsset,
  RecordingFinish,
  RecordingStart,
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

type ActiveRecording = {
  sessionId: string;
  trackId: string;
  sampleRate: number;
  channels: 1 | 2;
  startSeconds: number;
  rawPath: string;
  manifestPath: string;
  fileHandle: Awaited<ReturnType<typeof open>>;
  framesWritten: number;
};
type RecordingManifest = RecordingStart & { id: string; version: 1 };

const productFolder = "PRISM";
const smokeDirectory = process.argv.find((argument) => argument.startsWith("--prism-smoke-test="))?.split("=").slice(1).join("=");
if (smokeDirectory) {
  if (!isAbsolute(smokeDirectory) || !basename(smokeDirectory).startsWith("prism-smoke-")) {
    throw new Error("Smoke checks require an absolute, isolated prism-smoke-* directory.");
  }
  mkdirSync(join(smokeDirectory, "userdata"), { recursive: true });
  app.setPath("userData", join(smokeDirectory, "userdata"));
}
let mainWindow: BrowserWindow | null = null;
let dataDirectory = "";
let libraryFile = "";
let assetDirectory = "";
let library: ProjectLibrary | null = null;
let writeQueue = Promise.resolve();
let closeApproved = false;
const activeRecordings = new Map<string, ActiveRecording>();

function emptyLibrary(): ProjectLibrary {
  return { version: 5, releases: [], sessions: [], assets: [], effectPresets: [] };
}

async function persistLibrary(): Promise<void> {
  if (!library || !libraryFile) throw new Error("The project library is not ready.");
  const snapshot = JSON.stringify(library, null, 2);
  const operation = writeQueue.then(async () => {
    await writeAtomicText(libraryFile, snapshot);
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
    const normalized = migrateProjectLibrary(parsed);
    if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
      await createLibraryBackup(dataDirectory, join(dataDirectory, "Backups"), {
        internal: true,
        label: "Before Migration",
      });
      library = normalized;
      await persistLibrary();
    }
    return normalized;
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

function freshTrack(name = "Audio 1", type: Track["type"] = "audio"): Track {
  return {
    id: randomUUID(),
    name,
    type,
    color: "#f47b54",
    volume: 0.85,
    pan: 0,
    muted: false,
    solo: false,
    recordArmed: false,
    clips: [],
    notes: [],
    instrument: type === "instrument"
      ? { waveform: "sawtooth", attack: 0.01, decay: 0.12, sustain: 0.65, release: 0.18 }
      : null,
    sampler: null,
    drumKit: null,
    instrumentRecovery: null,
    effects: [],
    outputBusId: null,
    sends: [],
  };
}

function freshSession(releaseId: string, title: string): SongSession {
  return {
    id: randomUUID(),
    releaseId,
    title,
    tempo: 120,
    timeSignature: "4/4",
    loopRange: null,
    metronomeEnabled: false,
    masterVolume: 1,
    masterEffects: [],
    buses: [],
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

async function discardRecording(recordingId: string): Promise<void> {
  const recording = activeRecordings.get(recordingId);
  if (!recording) return;
  activeRecordings.delete(recordingId);
  await recording.fileHandle.close().catch(() => undefined);
  await unlink(recording.rawPath).catch(() => undefined);
  await unlink(recording.manifestPath).catch(() => undefined);
}

function pcmWavHeader(sampleRate: number, channels: 1 | 2, frames: number): Buffer {
  const dataBytes = frames * channels * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataBytes, 40);
  return header;
}

async function convertFloatRecordingToWav(
  rawPath: string,
  outputPath: string,
  sampleRate: number,
  channels: 1 | 2,
  frames: number,
): Promise<void> {
  const dataBytes = frames * channels * 2;
  if (dataBytes > 0xffff_ffff - 36) {
    throw new Error("This recording exceeds the standard WAV size limit.");
  }
  const output = createWriteStream(outputPath, { flags: "wx" });
  output.write(pcmWavHeader(sampleRate, channels, frames));
  let carry: Buffer = Buffer.alloc(0);
  const converter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const alignedBytes = data.length - (data.length % 4);
      const converted = Buffer.allocUnsafe(alignedBytes / 2);
      for (let sourceOffset = 0, targetOffset = 0; sourceOffset < alignedBytes; sourceOffset += 4, targetOffset += 2) {
        const sample = Math.max(-1, Math.min(1, data.readFloatLE(sourceOffset)));
        converted.writeInt16LE(
          sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff),
          targetOffset,
        );
      }
      carry = Buffer.from(data.subarray(alignedBytes));
      callback(null, converted);
    },
    flush(callback) {
      callback(carry.length ? new Error("The recording PCM stream ended mid-sample.") : undefined);
    },
  });
  await pipeline(createReadStream(rawPath, { highWaterMark: 64 * 1024 }), converter, output);
  const info = await stat(outputPath);
  if (info.size !== 44 + dataBytes) {
    throw new Error("The completed WAV file did not match its expected size.");
  }
}

async function readWavFrameCount(
  wavPath: string,
  expectedChannels: 1 | 2,
  expectedSampleRate: number,
): Promise<number | null> {
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    const info = await stat(wavPath);
    if (info.size < 44) return null;
    handle = await open(wavPath, "r");
    const header = Buffer.alloc(44);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (
      bytesRead !== 44 ||
      header.toString("ascii", 0, 4) !== "RIFF" ||
      header.toString("ascii", 8, 12) !== "WAVE" ||
      header.toString("ascii", 36, 40) !== "data" ||
      header.readUInt16LE(20) !== 1 ||
      header.readUInt16LE(22) !== expectedChannels ||
      header.readUInt32LE(24) !== expectedSampleRate ||
      header.readUInt16LE(34) !== 16 ||
      header.readUInt32LE(40) + 44 !== info.size ||
      info.size !== 44 + header.readUInt32LE(40)
    ) return null;
    const dataBytes = header.readUInt32LE(40);
    return dataBytes % (expectedChannels * 2) === 0
      ? dataBytes / (expectedChannels * 2)
      : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function recoverInterruptedRecordings(): Promise<void> {
  const files = await readdir(assetDirectory);
  for (const fileName of files.filter((name) => name.endsWith(".recording.json"))) {
    const manifestPath = join(assetDirectory, fileName);
    let manifest: RecordingManifest;
    try {
      const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
      if (typeof parsed !== "object" || parsed === null) continue;
      const value = parsed as Partial<RecordingManifest>;
      if (
        value.version !== 1 ||
        typeof value.id !== "string" ||
        !/^[\da-f-]{36}$/i.test(value.id) ||
        typeof value.sessionId !== "string" ||
        typeof value.trackId !== "string" ||
        !Number.isInteger(value.sampleRate) ||
        ![1, 2].includes(Number(value.channels)) ||
        !Number.isFinite(value.startSeconds) ||
        Number(value.startSeconds) < 0
      ) continue;
      manifest = value as RecordingManifest;
    } catch {
      continue;
    }

    const session = library?.sessions.find((item) => item.id === manifest.sessionId);
    const track = session?.tracks.find((item) => item.id === manifest.trackId && item.type === "audio");
    if (!session || !track || !library) continue;

    const existingClip = track.clips.find((clip) => clip.assetId === manifest.id);
    const existingAsset = library.assets.find((asset) => asset.id === manifest.id);
    if (existingClip && existingAsset) {
      await unlink(join(assetDirectory, `.${manifest.id}.recording.pcm`)).catch(() => undefined);
      await unlink(manifestPath).catch(() => undefined);
      continue;
    }

    const rawPath = join(assetDirectory, `.${manifest.id}.recording.pcm`);
    const wavPath = join(assetDirectory, `${manifest.id}.wav`);
    const temporaryPath = `${wavPath}.tmp`;
    let frames = 0;
    try {
      const rawInfo = await stat(rawPath);
      const frameBytes = manifest.channels * 4;
      const completeBytes = rawInfo.size - (rawInfo.size % frameBytes);
      if (completeBytes > 0) {
        frames = completeBytes / frameBytes;
        if (completeBytes !== rawInfo.size) await truncate(rawPath, completeBytes);
      }
    } catch {
      frames = await readWavFrameCount(wavPath, manifest.channels, manifest.sampleRate) ?? 0;
    }
    if (frames <= 0) continue;

    const existingWavFrames = await readWavFrameCount(wavPath, manifest.channels, manifest.sampleRate);
    if (existingWavFrames !== frames) {
      await unlink(wavPath).catch(() => undefined);
      await unlink(temporaryPath).catch(() => undefined);
      try {
        await convertFloatRecordingToWav(
          rawPath,
          temporaryPath,
          manifest.sampleRate,
          manifest.channels,
          frames,
        );
        await rename(temporaryPath, wavPath);
      } catch {
        await unlink(temporaryPath).catch(() => undefined);
        continue;
      }
    }

    const now = new Date().toISOString();
    const asset: StoredAsset = existingAsset ?? {
      id: manifest.id,
      storageName: `${manifest.id}.wav`,
      fileName: `Recovered Recording ${now.replace(/[:.]/g, "-")}.wav`,
      mimeType: "audio/wav",
    };
    const clip: AudioClip = {
      id: randomUUID(),
      assetId: manifest.id,
      name: asset.fileName,
      durationSeconds: frames / manifest.sampleRate,
      sourceDurationSeconds: frames / manifest.sampleRate,
      startSeconds: manifest.startSeconds,
      sourceStartSeconds: 0,
      gain: 1,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
      waveform: [],
    };
    const previousSessionTime = session.updatedAt;
    const release = library.releases.find((item) => item.id === session.releaseId);
    const previousReleaseTime = release?.updatedAt;
    if (!existingAsset) library.assets.push(asset);
    if (!existingClip) track.clips.push(clip);
    session.updatedAt = now;
    if (release) release.updatedAt = now;
    try {
      await persistLibrary();
      await unlink(rawPath).catch(() => undefined);
      await unlink(manifestPath).catch(() => undefined);
    } catch {
      if (!existingAsset) library.assets = library.assets.filter((item) => item.id !== asset.id);
      if (!existingClip) track.clips = track.clips.filter((item) => item.id !== clip.id);
      session.updatedAt = previousSessionTime;
      if (release && previousReleaseTime) release.updatedAt = previousReleaseTime;
    }
  }
}

function allowedSender(senderId: number): void {
  if (!mainWindow || senderId !== mainWindow.webContents.id) {
    throw new Error("This request did not come from the PRISM window.");
  }
}

let themeStore: ThemeStore;

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

  handle("prism:themes:get", () => themeStore.getState());
  handle("prism:app:version", () => app.getVersion());
  handle("prism:app:exit", () => { mainWindow?.close(); });
  handle("prism:project:save-as", async (_event, input: SongSession) => {
    // Export only validated, persisted data; the renderer flushes before invoking.
    const current = getSession(input.id);
    if (current.releaseId !== input.releaseId) throw new Error("The project identity is invalid.");
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Save Project As",
      defaultPath: `${current.title.replace(/[<>:"/\\|?*]/g, "_")}.prism`,
      filters: [{ name: "PRISM portable project", extensions: ["prism"] }],
    });
    if (result.canceled || !result.filePath) return null;
    await saveProjectFile(result.filePath, getLibrary(), current, assetDirectory);
    return result.filePath;
  });
  handle("prism:project:open", async () => {
    if (activeRecordings.size) throw new Error("Stop recording before opening another project.");
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Open PRISM Project",
      properties: ["openFile"],
      filters: [{ name: "PRISM portable project", extensions: ["prism"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const imported = await importProjectFile(result.filePaths[0], assetDirectory);
    const previous = getLibrary();
    library = {
      ...previous,
      releases: [...imported.library.releases, ...previous.releases],
      sessions: [...previous.sessions, ...imported.library.sessions],
      assets: [...previous.assets, ...imported.library.assets],
      effectPresets: [...previous.effectPresets, ...imported.library.effectPresets],
    };
    try {
      await persistLibrary();
    } catch (error) {
      library = previous;
      await Promise.all(imported.createdFiles.map((path) => unlink(path).catch(() => undefined)));
      throw error;
    }
    return { release: imported.library.releases[0]!, session: imported.library.sessions[0]! };
  });
  handle("prism:themes:claim", (_event, id) => themeStore.claim(id));
  handle("prism:themes:apply", (_event, id) => themeStore.apply(id));
  handle("prism:themes:repair", (_event, id) => themeStore.repair(id));
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
    const session = freshSession(release.id, cleanTitle(input.title));
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
    if (!Array.isArray(updated.tracks) || updated.tracks.length > 64) {
      throw new Error("The session data is invalid.");
    }
    if (
      !Number.isFinite(updated.tempo) ||
      !Number.isFinite(updated.masterVolume) ||
      !Array.isArray(updated.masterEffects) ||
      updated.masterEffects.length > 64 ||
      new Set(updated.tracks.map((track) => track.id)).size !== updated.tracks.length
    ) throw new Error("The session contains invalid transport or track settings.");
    const masterEffects = normalizeEffectChain(updated.masterEffects);
    if (!Array.isArray(updated.buses)) {
      if (updated.buses !== undefined || current.buses.length > 0) {
        throw new Error("The session is missing its saved audio buses.");
      }
    }
    const busesWithValidatedEffects = (updated.buses ?? []).map((bus) => ({
      ...bus,
      name: bus.name.trim(),
      sends: bus.sends ?? [],
      outputBusId: bus.outputBusId ?? null,
      effects: normalizeEffectChain(bus.effects),
    }));
    const tracksWithValidatedEffects = updated.tracks.map((track) => ({
      ...track,
      outputBusId: track.outputBusId ?? null,
      sends: track.sends ?? [],
      effects: normalizeEffectChain(track.effects),
    }));
    for (const track of updated.tracks) {
      const previous = current.tracks.find((entry) => entry.id === track.id);
      if (
        (track.outputBusId === undefined && previous?.outputBusId) ||
        (track.sends === undefined && previous?.sends.length)
      ) {
        throw new Error(`The saved routing for "${track.name}" is incomplete.`);
      }
    }
    for (const bus of updated.buses ?? []) {
      const previous = current.buses.find((entry) => entry.id === bus.id);
      if (
        (bus.outputBusId === undefined && previous?.outputBusId) ||
        (bus.sends === undefined && previous?.sends.length)
      ) {
        throw new Error(`The saved routing for "${bus.name}" is incomplete.`);
      }
    }
    validateAudioRouting(tracksWithValidatedEffects, busesWithValidatedEffects);
    if (
      updated.loopRange?.enabled &&
      (!Number.isFinite(updated.loopRange.startSeconds) ||
        !Number.isFinite(updated.loopRange.endSeconds) ||
        updated.loopRange.startSeconds < 0 ||
        updated.loopRange.endSeconds <= updated.loopRange.startSeconds)
    ) throw new Error("The loop range is invalid.");
    for (const track of tracksWithValidatedEffects) {
      validateMidiArrangement(track);
      const previousTrack = current.tracks.find((entry) => entry.id === track.id);
      if (previousTrack?.midiClips?.length && track.midiClips === undefined) {
        throw new Error(`The MIDI arrangement for "${track.name}" is missing. The saved project was not changed.`);
      }
      const instrumentValidation = validateInstrumentTrackState(track);
      if (instrumentValidation) throw new Error(instrumentValidation);
      if (
        !Array.isArray(track.effects) ||
        !Array.isArray(track.clips) ||
        track.clips.length > 10_000 ||
        !Array.isArray(track.notes) ||
        track.notes.length > 100_000 ||
        !Number.isFinite(track.volume) ||
        !Number.isFinite(track.pan) ||
        track.clips.some(
          (clip: AudioClip) =>
            !getLibrary().assets.some((asset) => asset.id === clip.assetId) ||
            !Number.isFinite(clip.startSeconds) ||
            clip.startSeconds < 0 ||
            !Number.isFinite(clip.durationSeconds) ||
            clip.durationSeconds < 0 ||
            !Number.isFinite(clip.sourceDurationSeconds) ||
            clip.sourceDurationSeconds < 0 ||
            !Number.isFinite(clip.sourceStartSeconds) ||
            clip.sourceStartSeconds < 0 ||
            clip.sourceStartSeconds + clip.durationSeconds > clip.sourceDurationSeconds + 0.02 ||
            !Number.isFinite(clip.gain) ||
            clip.gain < 0 ||
            !Array.isArray(clip.waveform),
        )
      ) {
        throw new Error("A clip refers to missing audio or an invalid timeline position.");
      }
      if (track.notes.some((note) =>
        !Number.isInteger(note.pitch) ||
        note.pitch < 0 ||
        note.pitch > 127 ||
        !Number.isFinite(note.startBeat) ||
        note.startBeat < 0 ||
        !Number.isFinite(note.durationBeats) ||
        note.durationBeats <= 0 ||
        !Number.isFinite(note.velocity) ||
        note.velocity < 1 ||
        note.velocity > 127,
      )) throw new Error("A MIDI note contains invalid timing or velocity.");
    }
    const saved = {
      ...updated,
      tracks: tracksWithValidatedEffects,
      buses: busesWithValidatedEffects,
      masterEffects,
      title: cleanTitle(updated.title),
      tempo: Math.min(300, Math.max(20, Math.round(updated.tempo))),
      masterVolume: Math.min(1.5, Math.max(0, updated.masterVolume)),
      updatedAt: new Date().toISOString(),
    };
    const index = getLibrary().sessions.findIndex((session) => session.id === saved.id);
    getLibrary().sessions[index] = saved;
    getRelease(saved.releaseId).updatedAt = saved.updatedAt;
    await persistLibrary();
    return saved;
  });
  handle("prism:effects:presets:list", async (_event, projectId: string) => {
    getRelease(projectId);
    return visibleEffectPresets(getLibrary().effectPresets, projectId);
  });
  handle("prism:effects:presets:save", async (_event, input: Omit<EffectChainPreset, "createdAt" | "updatedAt">) => {
    const preset = normalizeStoredEffectPreset({
      ...input,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    if (preset.scope === "project") getRelease(preset.projectId!);
    const previous = getLibrary().effectPresets;
    getLibrary().effectPresets = upsertEffectPreset(previous, input);
    try {
      await persistLibrary();
      return getLibrary().effectPresets.find((item) => item.id === preset.id)!;
    } catch (error) {
      getLibrary().effectPresets = previous;
      throw error;
    }
  });
  handle("prism:effects:presets:delete", async (_event, presetId: string, projectId: string) => {
    getRelease(projectId);
    const previous = getLibrary().effectPresets;
    const existing = previous.find((preset) => preset.id === presetId);
    if (!existing) return;
    if (existing.scope === "project" && existing.projectId !== projectId) {
      throw new Error("This preset belongs to another project.");
    }
    getLibrary().effectPresets = previous.filter((preset) => preset.id !== presetId);
    try {
      await persistLibrary();
    } catch (error) {
      getLibrary().effectPresets = previous;
      throw error;
    }
  });
  handle("prism:effects:presets:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Import PRISM effect preset",
      properties: ["openFile"],
      filters: [{ name: "PRISM Effect Preset", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const path = result.filePaths[0];
    const info = await stat(path);
    if (info.size > maxEffectPresetBytes) throw new Error("Effect preset files are limited to 1 MiB.");
    const contents = await readFile(path, "utf8");
    if (Buffer.byteLength(contents, "utf8") > maxEffectPresetBytes) {
      throw new Error("Effect preset files are limited to 1 MiB.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch {
      throw new Error("The selected file is not valid JSON.");
    }
    return parseEffectPresetFile(parsed);
  });
  handle("prism:effects:presets:export", async (_event, input: EffectChainPresetFile) => {
    const preset = parseEffectPresetFile(input);
    const safeName = preset.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim() || "Effects";
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Export PRISM effect preset",
      defaultPath: `${safeName}.prismeffects.json`,
      filters: [{ name: "PRISM Effect Preset", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) return false;
    const contents = `${JSON.stringify(createEffectPresetFile(preset.name, preset.effects), null, 2)}\n`;
    await writeAtomicText(result.filePath, contents);
    return true;
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
  handle("prism:audio:import", async (_event, sessionId: string, requestedTrackId?: string) => {
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
    let targetTrack = requestedTrackId
      ? session.tracks.find((track) => track.id === requestedTrackId && track.type === "audio")
      : session.tracks.find((track) => track.type === "audio");
    if (requestedTrackId && !targetTrack) {
      throw new Error("Choose an existing audio track before importing audio.");
    }
    if (!targetTrack) {
      targetTrack = freshTrack(`Audio ${session.tracks.length + 1}`);
      session.tracks.push(targetTrack);
    }
    const clip: AudioClip = {
      id: randomUUID(),
      assetId: id,
      name: asset.fileName,
      durationSeconds: 0,
      sourceDurationSeconds: 0,
      startSeconds: 0,
      sourceStartSeconds: 0,
      gain: 1,
      fadeInSeconds: 0,
      fadeOutSeconds: 0,
      waveform: [],
    };
    targetTrack.clips.push(clip);
    session.updatedAt = new Date().toISOString();
    await persistLibrary();
    return { clip, assetUrl: `prism-media://local/${id}` };
  });
  handle("prism:audio:assets:list", async () =>
    getLibrary().assets
      .filter((asset) => asset.mimeType.startsWith("audio/"))
      .map(({ id, fileName, mimeType }) => ({ id, fileName, mimeType } satisfies ProjectAsset)),
  );
  handle("prism:audio:sample:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Import sampler audio",
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: ["wav", "mp3", "ogg", "m4a", "flac"] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const sourcePath = result.filePaths[0];
    const extension = extname(sourcePath).toLowerCase();
    if (![".wav", ".mp3", ".ogg", ".m4a", ".flac"].includes(extension)) {
      throw new Error("Choose a WAV, MP3, OGG, M4A, or FLAC sample.");
    }
    const info = await stat(sourcePath);
    if (info.size <= 0 || info.size > 500 * 1024 * 1024) {
      throw new Error("Audio samples must be non-empty and smaller than 500 MB.");
    }
    const id = randomUUID();
    const storageName = `${id}${extension}`;
    const assetPath = join(assetDirectory, storageName);
    await copyFile(sourcePath, assetPath);
    const asset: StoredAsset = {
      id,
      storageName,
      fileName: sourcePath.split(/[\\/]/).pop() ?? "audio sample",
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
    const previousAssets = getLibrary().assets;
    getLibrary().assets = [...previousAssets, asset];
    try {
      await persistLibrary();
    } catch (error) {
      getLibrary().assets = previousAssets;
      await unlink(assetPath).catch(() => undefined);
      throw error;
    }
    return { id: asset.id, fileName: asset.fileName, mimeType: asset.mimeType } satisfies ProjectAsset;
  });
  handle("prism:audio:recording:start", async (_event, input: RecordingStart) => {
    if (
      !Number.isInteger(input.sampleRate) ||
      input.sampleRate < 8_000 ||
      input.sampleRate > 192_000 ||
      ![1, 2].includes(input.channels) ||
      !Number.isFinite(input.startSeconds) ||
      input.startSeconds < 0
    ) throw new Error("The selected recording format is not supported.");
    const session = getSession(input.sessionId);
    const track = session.tracks.find((item) => item.id === input.trackId);
    if (!track || track.type !== "audio" || !track.recordArmed) {
      throw new Error("Arm an audio track before starting a recording.");
    }
    const id = randomUUID();
    const rawPath = join(assetDirectory, `.${id}.recording.pcm`);
    const manifestPath = join(assetDirectory, `.${id}.recording.json`);
    const manifestTempPath = `${manifestPath}.tmp`;
    try {
      await writeFile(manifestTempPath, JSON.stringify({
        id,
        version: 1,
        sessionId: session.id,
        trackId: track.id,
        sampleRate: input.sampleRate,
        channels: input.channels,
        startSeconds: input.startSeconds,
      } satisfies RecordingManifest), "utf8");
      await rename(manifestTempPath, manifestPath);
    } catch (error) {
      await unlink(manifestTempPath).catch(() => undefined);
      throw error;
    }
    let fileHandle: Awaited<ReturnType<typeof open>>;
    try {
      fileHandle = await open(rawPath, "wx");
    } catch (error) {
      await unlink(manifestPath).catch(() => undefined);
      throw error;
    }
    activeRecordings.set(id, {
      sessionId: session.id,
      trackId: track.id,
      sampleRate: input.sampleRate,
      channels: input.channels,
      startSeconds: input.startSeconds,
      rawPath,
      manifestPath,
      fileHandle,
      framesWritten: 0,
    });
    return id;
  });
  handle("prism:audio:recording:append", async (_event, recordingId: string, samples: Float32Array) => {
    const recording = activeRecordings.get(recordingId);
    if (!recording) throw new Error("This recording is no longer active.");
    if (
      !(samples instanceof Float32Array) ||
      samples.length === 0 ||
      samples.length > 256 * 1024 ||
      samples.length % recording.channels !== 0
    ) throw new Error("The incoming recording chunk has an invalid format.");
    const maxFrames = recording.sampleRate * 60 * 60 * 4;
    if (recording.framesWritten + samples.length / recording.channels > maxFrames) {
      throw new Error("Recordings are limited to four hours.");
    }
    const data = Buffer.allocUnsafe(samples.length * 4);
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      if (!Number.isFinite(sample)) throw new Error("The microphone produced invalid audio data.");
      data.writeFloatLE(Math.max(-1, Math.min(1, sample)), index * 4);
    }
    await recording.fileHandle.writeFile(data);
    recording.framesWritten += samples.length / recording.channels;
  });
  handle("prism:audio:recording:finish", async (_event, input: RecordingFinish) => {
    const recording = activeRecordings.get(input.recordingId);
    if (!recording) throw new Error("This recording is no longer active.");
    if (
      !Array.isArray(input.waveform) ||
      input.waveform.length > 2048 ||
      input.waveform.some((peak) => !Number.isFinite(peak) || peak < 0 || peak > 1)
    ) throw new Error("The recording waveform data is invalid.");
    if (recording.framesWritten === 0) {
      await discardRecording(input.recordingId);
      throw new Error("No microphone audio was captured.");
    }

    const session = getSession(recording.sessionId);
    const track = session.tracks.find((item) => item.id === recording.trackId);
    if (!track || track.type !== "audio") {
      await discardRecording(input.recordingId);
      throw new Error("The recording track no longer exists.");
    }
    const id = input.recordingId;
    const storageName = `${id}.wav`;
    const outputPath = join(assetDirectory, storageName);
    const temporaryWavPath = `${outputPath}.tmp`;
    try {
      await recording.fileHandle.close();
      await convertFloatRecordingToWav(
        recording.rawPath,
        temporaryWavPath,
        recording.sampleRate,
        recording.channels,
        recording.framesWritten,
      );
      await rename(temporaryWavPath, outputPath);
      const now = new Date().toISOString();
      const asset: StoredAsset = {
        id,
        storageName,
        fileName: `PRISM Recording ${now.replace(/[:.]/g, "-")}.wav`,
        mimeType: "audio/wav",
      };
      const clip: AudioClip = {
        id: randomUUID(),
        assetId: id,
        name: asset.fileName,
        durationSeconds: recording.framesWritten / recording.sampleRate,
        sourceDurationSeconds: recording.framesWritten / recording.sampleRate,
        startSeconds: recording.startSeconds,
        sourceStartSeconds: 0,
        gain: 1,
        fadeInSeconds: 0,
        fadeOutSeconds: 0,
        waveform: input.waveform,
      };
      const priorSessionTime = session.updatedAt;
      const release = getRelease(session.releaseId);
      const priorReleaseTime = release.updatedAt;
      getLibrary().assets.push(asset);
      track.clips.push(clip);
      session.updatedAt = now;
      release.updatedAt = now;
      try {
        await persistLibrary();
      } catch (error) {
        getLibrary().assets = getLibrary().assets.filter((item) => item.id !== id);
        track.clips = track.clips.filter((item) => item.id !== clip.id);
        session.updatedAt = priorSessionTime;
        release.updatedAt = priorReleaseTime;
        throw error;
      }
      activeRecordings.delete(input.recordingId);
      await unlink(recording.rawPath).catch(() => undefined);
      await unlink(recording.manifestPath).catch(() => undefined);
      return { clip, assetUrl: `prism-media://local/${id}`, trackId: recording.trackId };
    } catch (error) {
      await unlink(temporaryWavPath).catch(() => undefined);
      await unlink(outputPath).catch(() => undefined);
      await recording.fileHandle.close().catch(() => undefined);
      activeRecordings.delete(input.recordingId);
      throw new Error(
        `The take could not be added to the project. Its temporary recording is preserved for recovery after restarting PRISM. ${error instanceof Error ? error.message : ""}`.trim(),
      );
    }
  });
  handle("prism:audio:recording:cancel", async (_event, recordingId: string) => {
    await discardRecording(recordingId);
  });
  handle("prism:audio:recording:preserve", async (_event, recordingId: string) => {
    const recording = activeRecordings.get(recordingId);
    if (!recording) return;
    await recording.fileHandle.close();
    activeRecordings.delete(recordingId);
  });
  handle("prism:audio:export-wav", async (_event, input: ExportWavInput) => {
    if (
      !(input.audioData instanceof Uint8Array) ||
      typeof input.fileName !== "string" ||
      input.audioData.byteLength < 44 ||
      input.audioData.byteLength > 2_000_000_000
    ) throw new Error("The WAV export data is invalid or too large.");
    const data = Buffer.from(input.audioData);
    if (
      data.toString("ascii", 0, 4) !== "RIFF" ||
      data.toString("ascii", 8, 12) !== "WAVE" ||
      data.readUInt32LE(4) + 8 !== data.length ||
      data.toString("ascii", 12, 16) !== "fmt " ||
      data.readUInt32LE(16) < 16 ||
      data.readUInt16LE(20) !== 1 ||
      ![1, 2].includes(data.readUInt16LE(22)) ||
      data.readUInt16LE(34) !== 16 ||
      data.toString("ascii", 36, 40) !== "data" ||
      data.readUInt32LE(40) + 44 !== data.length
    ) throw new Error("The audio render is not a complete WAV file.");
    const safeName = input.fileName
      .replace(/[\\/:*?"<>|]/g, "_")
      .trim()
      .slice(0, 100) || "PRISM Export";
    const defaultPath = safeName.toLowerCase().endsWith(".wav")
      ? safeName
      : `${safeName}.wav`;
    const result = await dialog.showSaveDialog(mainWindow!, {
      title: "Export song as WAV",
      defaultPath,
      filters: [{ name: "WAV audio", extensions: ["wav"] }],
    });
    if (result.canceled || !result.filePath) return false;
    await writeFile(result.filePath, data);
    return true;
  });
  handle("prism:app:open-data-folder", async () => {
    const error = await shell.openPath(join(app.getPath("userData"), productFolder));
    if (error) throw new Error(error);
  });
  handle("prism:library:backup", async () => {
    if (activeRecordings.size > 0) {
      throw new Error("Stop recording before creating a project backup.");
    }
    await persistLibrary();
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose where to save the PRISM backup",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return createLibraryBackup(dataDirectory, result.filePaths[0]);
  });
  handle("prism:library:restore", async () => {
    if (activeRecordings.size > 0) {
      throw new Error("Stop recording before restoring a project backup.");
    }
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose a PRISM backup folder",
      properties: ["openDirectory"],
    });
    if (result.canceled || !result.filePaths[0]) return false;
    await persistLibrary();
    library = await restoreLibraryBackup(result.filePaths[0], dataDirectory);
    return true;
  });
  handle("prism:app:close-ready", async () => {
    if (activeRecordings.size > 0) {
      throw new Error("Stop or cancel the active recording before closing PRISM.");
    }
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
  if (!asset || !isSafeAssetStorageName(asset.storageName)) {
    return new Response("Asset not found", { status: 404 });
  }
  const assetPath = join(assetDirectory, asset.storageName);
  try {
    if (!(await stat(assetPath)).isFile()) {
      return new Response("The project media file is missing.", { status: 404 });
    }
  } catch {
    return new Response("The project media file is missing from PRISM's local data folder.", {
      status: 404,
    });
  }
  return net.fetch(pathToFileURL(assetPath).toString());
}

function createApplicationMenu(): void {
  // The themed, accessible renderer menus share the DAW command dispatcher.
  // Native Edit roles/accelerators would otherwise intercept or double-run it.
  Menu.setApplicationMenu(null);
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
    icon: join(__dirname, "../../build/prism-512.png"),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());
  if (smokeDirectory) {
    mainWindow.webContents.once("did-finish-load", () => {
      void runDesktopSmoke(mainWindow!, smokeDirectory, process.argv.includes("--prism-smoke-reopen"));
    });
  }
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
  electronSession.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      const mediaTypes = "mediaTypes" in details ? details.mediaTypes : undefined;
      const audioOnly =
        permission === "media" &&
        mediaTypes?.includes("audio") === true &&
        mediaTypes.includes("video") !== true;
      callback(webContents === mainWindow?.webContents && audioOnly);
    },
  );
  dataDirectory = join(app.getPath("userData"), productFolder);
  assetDirectory = join(dataDirectory, "assets");
  libraryFile = join(dataDirectory, "library.json");
  await mkdir(assetDirectory, { recursive: true });
  themeStore = new ThemeStore(dataDirectory);
  await themeStore.initialize().catch((error) => {
    // Appearance problems must not prevent users from opening their music.
    // Theme IPC retries initialization and exposes the error in Preferences.
    console.warn("PRISM appearance settings are unavailable:", error);
  });
  library = await readLibrary();
  await recoverInterruptedRecordings();
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
