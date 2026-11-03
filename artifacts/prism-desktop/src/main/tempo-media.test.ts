import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { migrateProjectLibrary } from "../shared/migrations";
import { encodePcm16Wav } from "../renderer/audio/wav";
import { storeTempoMedia } from "./tempo-media";
import { saveProjectFile, importProjectFile } from "./project-file";

test("tempo media failures roll back all new files and preserve original bytes and session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prism-tempo-"));
  try {
    const storageName = `${randomUUID()}.wav`;
    const original = encodePcm16Wav([new Float32Array(8000)], 8000);
    await writeFile(join(directory, storageName), original);
    const library = migrateProjectLibrary({ version: 7, releases: [], sessions: [], assets: [{ id: "source", fileName: "original.wav", mimeType: "audio/wav", storageName }] });
    await assert.rejects(storeTempoMedia(library, directory, [{ id: randomUUID(), originalAssetId: "source", audioData: original }],
      async () => { throw new Error("disk failure"); }), /disk failure/);
    assert.equal(library.assets.length, 1);
    assert.deepEqual(await readFile(join(directory, storageName)), Buffer.from(original));
    assert.equal((await readdir(directory)).length, 1);
    const derivative = randomUUID();
    await storeTempoMedia(library, directory, [{ id: derivative, originalAssetId: "source", audioData: original }], async () => {});
    assert.equal(library.assets.length, 2);
    await assert.rejects(storeTempoMedia(library, directory, [{ id: derivative, originalAssetId: "source", audioData: original }], async () => {}), /reference/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test("portable tempo projects carry original and derivative audio and remap both identities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "prism-tempo-portable-"));
  try {
    const original = encodePcm16Wav([new Float32Array(8000)], 8000);
    const first = `${randomUUID()}.wav`, second = `${randomUUID()}.wav`;
    await writeFile(join(directory, first), original); await writeFile(join(directory, second), original);
    const library = migrateProjectLibrary({ version: 8,
      releases: [{ id: "release", title: "Tempo", releaseType: "Single", songIds: ["song"] }],
      sessions: [{ id: "song", releaseId: "release", title: "Tempo", tracks: [{ id: "audio", type: "audio", clips: [{
        id: "clip", assetId: "derivative", name: "Stretched", durationSeconds: 1, sourceDurationSeconds: 1,
        tempoAdaptation: { algorithm: "prism-wsola-v1", originalAssetId: "source", originalTempo: 120, lengthRatio: 1.5 },
      }] }] }],
      assets: [{ id: "source", fileName: "original.wav", mimeType: "audio/wav", storageName: first },
        { id: "derivative", fileName: "derivative.wav", mimeType: "audio/wav", storageName: second }],
    });
    const path = join(directory, "tempo.prism");
    await saveProjectFile(path, library, library.sessions[0], directory);
    const result = await importProjectFile(path, directory);
    const clip = result.library.sessions[0].tracks[0].clips[0];
    assert.equal(result.library.assets.length, 2);
    assert.notEqual(clip.assetId, clip.tempoAdaptation?.originalAssetId);
    assert.ok(result.library.assets.some(asset => asset.id === clip.tempoAdaptation?.originalAssetId));
    for (const path of result.createdFiles) assert.deepEqual(await readFile(path), Buffer.from(original));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
