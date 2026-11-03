import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrateProjectLibrary } from "../shared/migrations";
import { importProjectFile, parseProjectFile, saveProjectFile } from "./project-file";

function fixture() {
  return migrateProjectLibrary({
    version: 5,
    releases: [{ id: "release", title: "Source", releaseType: "Single", songIds: ["song"] }],
    sessions: [{
      id: "song", releaseId: "release", title: "Portable song", tempo: 110,
      songKey: { root: 7, scale: "major" }, midiView: { smartView: true, scaleSnap: false },
      tracks: [{
        id: "sampler", type: "sampler", name: "Sampler",
        sampler: { sampleAssetId: "media", rootNote: 48, gain: 0.8 },
        midiClips: [{ id: "midi-clip", name: "Sample phrase", startBeat: 2, durationBeats: 4 }],
        notes: [{ id: "note", midiClipId: "midi-clip", pitch: 48, startBeat: 2, durationBeats: 1, velocity: 75 }],
        outputBusId: "bus", sends: [], clips: [],
      }, {
        id: "audio", type: "audio", name: "Audio",
        clips: [{
          id: "clip", assetId: "media", name: "take", startSeconds: 2,
          sourceStartSeconds: 0.1, durationSeconds: 1, sourceDurationSeconds: 4,
          waveform: [0.1, 0.4],
        }],
      }],
      buses: [{ id: "bus", name: "Bus", level: 0.7, effects: [], sends: [] }],
    }],
    assets: [{ id: "media", fileName: "take.wav", mimeType: "audio/wav", storageName: "6f8ec2b4-b1ad-4491-a60f-b839558f2638.wav" }],
    effectPresets: [],
  });
}

test("portable save/open copies media and preserves independent MIDI, routing and clip offsets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prism-project-"));
  try {
    const source = fixture();
    const assets = join(directory, "assets");
    const importedAssets = join(directory, "imported");
    await mkdir(assets);
    await mkdir(importedAssets);
    const bytes = Buffer.from("RIFF test media bytes");
    await writeFile(join(assets, source.assets[0]!.storageName), bytes);
    const file = join(directory, "song.prism");
    await saveProjectFile(file, source, source.sessions[0]!, assets);
    const first = await importProjectFile(file, importedAssets);
    const second = await importProjectFile(file, importedAssets);
    assert.notEqual(first.library.sessions[0]!.id, source.sessions[0]!.id);
    assert.notEqual(first.library.sessions[0]!.id, second.library.sessions[0]!.id);
    assert.notEqual(first.library.releases[0]!.id, source.releases[0]!.id);
    const reopened = first.library.sessions[0]!;
    assert.deepEqual(reopened.tracks[0]!.notes, source.sessions[0]!.tracks[0]!.notes);
    assert.deepEqual(reopened.songKey, source.sessions[0]!.songKey);
    assert.deepEqual(reopened.midiView, source.sessions[0]!.midiView);
    assert.deepEqual(reopened.tracks[0]!.midiClips, source.sessions[0]!.tracks[0]!.midiClips);
    assert.deepEqual(reopened.buses, source.sessions[0]!.buses);
    assert.equal(reopened.tracks[0]!.outputBusId, "bus");
    assert.equal(reopened.tracks[0]!.sampler!.sampleAssetId, first.library.assets[0]!.id);
    assert.equal(reopened.tracks[1]!.clips[0]!.sourceStartSeconds, 0.1);
    assert.deepEqual(await readFile(first.createdFiles[0]!), bytes);
    assert.equal((await readdir(importedAssets)).length, 2);
    assert.equal(source.sessions[0]!.id, "song");
    assert.equal(source.assets[0]!.id, "media");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("missing media aborts Save As without replacing an existing destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prism-project-missing-"));
  try {
    const source = fixture();
    const file = join(directory, "previous.prism");
    await writeFile(file, "previous safe content");
    await assert.rejects(saveProjectFile(file, source, source.sessions[0]!, directory), /missing/);
    assert.equal(await readFile(file, "utf8"), "previous safe content");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("portable import rejects malformed, missing, duplicate and unsafe media", () => {
  const library = fixture();
  const file = { format: "prism-project", version: 1, library, media: [{ ...library.assets[0]!, data: "YWJj" }] };
  assert.equal(parseProjectFile(JSON.stringify(file)).media.size, 1);
  assert.throws(() => parseProjectFile(JSON.stringify({ ...file, media: [] })), /missing/);
  assert.throws(() => parseProjectFile(JSON.stringify({ ...file, media: [file.media[0], file.media[0]] })), /damaged/);
  assert.throws(() => parseProjectFile(JSON.stringify({ ...file, media: [{ ...file.media[0], data: "%%%" }] })), /damaged/);
  library.assets[0]!.storageName = "../../outside.wav";
  assert.throws(() => parseProjectFile(JSON.stringify(file)), /unsafe/);
});
