/**
 * Isolated renderer integration harness, NOT an installed Electron substitute.
 * Storage/theme/project-file implementations are real; file pickers and IPC are
 * replaced with HTTP against a temporary directory. Never opens user projects.
 */
import { createServer } from "node:http";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { ThemeStore } from "../src/main/theme-store";
import { migrateProjectLibrary, migrateSongSession } from "../src/shared/migrations";
import { writeAtomicText } from "../src/main/atomic-write";
import { saveProjectFile, importProjectFile } from "../src/main/project-file";
import type { CreateReleaseInput, SongSession } from "../src/shared/types";

async function main() {
  const root = resolve("out/renderer");
  const directory = await mkdtemp(join(tmpdir(), "prism-workstation-ui-"));
  const assets = join(directory, "assets");
  await mkdir(assets);
  let theme = new ThemeStore(directory);
  await theme.initialize();
  const mediaId = randomUUID();
  const mediaName = `${mediaId}.wav`;
  const wav = Buffer.alloc(44 + 48000 * 2 * 4);
  wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36);
  wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 0; i < (wav.length - 44) / 2; i++) wav.writeInt16LE(Math.round(Math.sin(i * 440 * 2 * Math.PI / 48000) * 9000), 44 + i * 2);
  await writeFile(join(assets, mediaName), wav);
  let library = migrateProjectLibrary({
    version: 5,
    releases: [{ id: "test-release", title: "Redesign verification", releaseType: "Single", songIds: ["test-song"] }],
    sessions: [{
      id: "test-song", releaseId: "test-release", title: "Redesign verification", tempo: 120,
      tracks: [{
        id: "audio-loud", type: "audio", name: "Loud tone", volume: .8,
        clips: [{ id: "tone-clip", assetId: mediaId, name: "Actual 440 Hz tone", durationSeconds: 4, sourceDurationSeconds: 4, startSeconds: 0 }],
      }, {
        id: "audio-soft", type: "audio", name: "Quiet tone", volume: .1,
        clips: [{ id: "quiet-clip", assetId: mediaId, name: "Quiet 440 Hz tone", durationSeconds: 4, sourceDurationSeconds: 4, startSeconds: 0 }],
      }, {
        id: "synth", type: "instrument", name: "MIDI lead",
        instrument: { waveform: "sine", attack: .01, decay: .1, sustain: .7, release: .1 },
        notes: [{ id: "initial-note", pitch: 60, startBeat: 1, durationBeats: 2, velocity: 90 }],
      }],
    }],
    assets: [{ id: mediaId, storageName: mediaName, fileName: "tone.wav", mimeType: "audio/wav" }],
    effectPresets: [],
  });
  const persist = () => writeAtomicText(join(directory, "library.json"), JSON.stringify(library));
  await persist();
  const bridge = `
const call = async (method,...args) => {
  const res = await fetch('/__desktop-test/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(args)});
  const body = await res.json(); if(!res.ok) throw new Error(body.error); return body;
};
window.prism = Object.fromEntries(${JSON.stringify([
  "getThemeState", "claimTheme", "applyTheme", "repairTheme", "listReleases",
  "getSession", "getRelease", "createRelease", "saveSession", "markReleaseOpened",
  "listAudioAssets", "listEffectPresets", "getAppVersion", "saveProjectAs", "openProject",
  "requestExit", "openDataFolder", "backupLibrary", "restoreLibrary",
])}.map(method => [method,(...args)=>call(method,...args)]));
window.prism.assetUrl = id => '/__media/'+encodeURIComponent(id);
window.prism.onCloseRequested = () => () => {};
`;
  const mime: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
  const server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url!, "http://localhost").pathname;
      if (path === "/__bridge.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bridge); return; }
      if (path.startsWith("/__media/")) {
        const asset = library.assets.find((item) => item.id === decodeURIComponent(path.slice(9)));
        if (!asset) throw new Error("Missing test asset");
        response.setHeader("Content-Type", asset.mimeType);
        response.end(await readFile(join(assets, asset.storageName))); return;
      }
      if (path.startsWith("/__desktop-test/")) {
        let body = "";
        for await (const chunk of request) { body += chunk; if (body.length > 4_000_000) throw new Error("Request too large"); }
        const args = JSON.parse(body || "[]");
        let value: unknown = null;
        switch (path.split("/").pop()) {
          case "getThemeState": value = await theme.getState(); break;
          case "claimTheme": value = await theme.claim(args[0]); break;
          case "applyTheme": value = await theme.apply(args[0]); break;
          case "repairTheme": value = await theme.repair(args[0]); break;
          case "listReleases": value = library.releases; break;
          case "getSession": value = library.sessions.find((item) => item.id === args[0]) ?? null; break;
          case "getRelease": value = library.releases.find((item) => item.id === args[0]) ?? null; break;
          case "getAppVersion": value = "0.1.0-test-harness"; break;
          case "listAudioAssets": value = library.assets; break;
          case "listEffectPresets": value = []; break;
          case "saveSession": {
            if (failSave) throw new Error("Injected test save failure; edits must remain open.");
            const session = migrateSongSession(args[0]);
            library.sessions = library.sessions.map((item) => item.id === session.id ? session : item);
            await persist(); value = session; break;
          }
          case "createRelease": {
            const input = args[0] as CreateReleaseInput;
            const id = randomUUID();
            const session: SongSession = migrateSongSession({ id: randomUUID(), releaseId: id, title: input.title, tracks: [] });
            const release = { ...library.releases[0]!, id, title: input.title, releaseType: "Single" as const, songIds: [session.id] };
            library.releases.push(release); library.sessions.push(session);
            await persist(); value = { release, session }; break;
          }
          case "saveProjectAs": {
            const session = library.sessions.find((item) => item.id === args[0].id)!;
            await saveProjectFile(join(directory, "portable.prism"), library, session, assets);
            value = join(directory, "portable.prism"); break;
          }
          case "openProject": {
            const imported = await importProjectFile(join(directory, "portable.prism"), assets);
            library.releases.push(...imported.library.releases);
            library.sessions.push(...imported.library.sessions);
            library.assets.push(...imported.library.assets);
            await persist(); value = { release: imported.library.releases[0], session: imported.library.sessions[0] }; break;
          }
          case "state": value = library; break;
          case "restart": library = migrateProjectLibrary(JSON.parse(await readFile(join(directory, "library.json"), "utf8"))); theme = new ThemeStore(directory); await theme.initialize(); value = true; break;
          case "failSave": failSave = Boolean(args[0]); value = true; break;
          case "markReleaseOpened": break;
          default: throw new Error("Unsupported test bridge command.");
        }
        response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(value)); return;
      }
      const file = resolve(root, `.${path === "/" ? "/index.html" : decodeURIComponent(path)}`);
      if (!file.startsWith(root + "/")) throw new Error("Invalid path");
      let content: string | Buffer = await readFile(file);
      if (file.endsWith(".html")) content = content.toString().replace('<script type="module"', '<script src="/__bridge.js"></script><script type="module"');
      response.setHeader("Content-Type", mime[extname(file)] ?? "application/octet-stream"); response.end(content);
    } catch (error) {
      response.statusCode = 400; response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  let failSave = false;
  server.listen(5194, "0.0.0.0", () => console.log("Isolated PRISM workstation harness http://localhost:5194"));
  const cleanup = async () => { server.close(); await rm(directory, { recursive: true, force: true }); process.exit(); };
  process.on("SIGINT", cleanup); process.on("SIGTERM", cleanup);
}
void main();
